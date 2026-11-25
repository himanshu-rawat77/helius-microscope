const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '..', 'node_modules', 'helius-laserstream');
const fallbackSource = path.join(targetDir, 'fallback.js');
const indexFile = path.join(targetDir, 'index.js');

if (!fs.existsSync(targetDir)) {
  process.exit(0);
}

// Ensure fallback.js exists
if (!fs.existsSync(fallbackSource)) {
  const fallbackCode = `const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const protobuf = require('protobufjs');
const path = require('path');
const { randomUUID } = require('crypto');

const activeStreamHandles = new Set();
let protoCache = null;

async function getProto() {
  if (protoCache) return protoCache;
  const protoDir = path.join(__dirname, 'proto');
  const geyserProtoPath = path.join(protoDir, 'geyser.proto');
  const solanaProtoPath = path.join(protoDir, 'solana-storage.proto');

  const protoRoot = await protobuf.load([geyserProtoPath, solanaProtoPath]);
  const SubscribeRequestType = protoRoot.lookupType('geyser.SubscribeRequest');
  const SubscribeUpdateType = protoRoot.lookupType('geyser.SubscribeUpdate');

  const packageDef = protoLoader.loadSync(geyserProtoPath, {
    includeDirs: [protoDir],
    keepCase: false,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });

  const grpcObj = grpc.loadPackageDefinition(packageDef);
  const GeyserService = grpcObj.geyser.Geyser;

  const customService = {
    ...GeyserService.service,
    Subscribe: {
      ...GeyserService.service.Subscribe,
      requestSerialize: (msg) => (Buffer.isBuffer(msg) ? msg : Buffer.from(SubscribeRequestType.encode(msg).finish())),
      responseDeserialize: (buffer) => buffer,
    },
  };

  const GeyserClientClass = grpc.makeGenericClientConstructor(customService, 'Geyser', {});

  protoCache = {
    protoRoot,
    SubscribeRequestType,
    SubscribeUpdateType,
    GeyserClientClass,
  };
  return protoCache;
}

function normalizeEndpoint(endpoint) {
  let ep = (endpoint || '').trim();
  if (ep.startsWith('https://')) {
    ep = ep.slice('https://'.length);
  } else if (ep.startsWith('http://')) {
    ep = ep.slice('http://'.length);
  }
  if (!ep.includes(':')) {
    ep += ':443';
  }
  return ep;
}

class LaserstreamClient {
  constructor(endpoint, apiKey, maxReconnectAttempts = 10, channelOptions = {}, replay = true, intraSlotUpdates = false) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.maxReconnectAttempts = maxReconnectAttempts ?? 10;
    this.channelOptions = channelOptions || {};
    this.replay = replay ?? true;
    this.intraSlotUpdates = intraSlotUpdates ?? false;
  }

  async subscribe(request, callback) {
    const { GeyserClientClass, SubscribeUpdateType } = await getProto();
    const target = normalizeEndpoint(this.endpoint);

    const sslCreds = grpc.credentials.createSsl();
    const grpcOptions = {
      'grpc.max_receive_message_length': 2 * 1024 * 1024 * 1024,
      'grpc.max_send_message_length': 64 * 1024 * 1024,
      'grpc.keepalive_time_ms': 15000,
      'grpc.keepalive_timeout_ms': 10000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.http2.min_time_between_pings_ms': 10000,
      'grpc.http2.max_pings_without_data': 0,
      ...this.channelOptions,
    };

    let client = new GeyserClientClass(target, sslCreds, grpcOptions);
    let activeCall = null;
    let isCanceled = false;
    let reconnectAttempts = 0;
    let lastSeenSlot = null;
    const currentRequest = { ...request };

    const handleId = randomUUID();

    const connect = () => {
      if (isCanceled) return;

      const meta = new grpc.Metadata();
      if (this.apiKey) {
        meta.set('x-token', this.apiKey);
      }

      activeCall = client.Subscribe(meta);

      activeCall.on('data', (updateBytes) => {
        reconnectAttempts = 0;
        try {
          if (this.replay) {
            const decoded = SubscribeUpdateType.decode(updateBytes);
            if (decoded.slot && decoded.slot.slot) {
              lastSeenSlot = Number(decoded.slot.slot);
            } else if (decoded.transaction && decoded.transaction.slot) {
              lastSeenSlot = Number(decoded.transaction.slot);
            } else if (decoded.account && decoded.account.slot) {
              lastSeenSlot = Number(decoded.account.slot);
            } else if (decoded.block && decoded.block.slot) {
              lastSeenSlot = Number(decoded.block.slot);
            }
          }
        } catch {
          // ignore parsing error for quick slot extraction
        }

        if (callback) {
          callback(null, updateBytes);
        }
      });

      activeCall.on('error', (err) => {
        if (isCanceled) return;

        // Handle OUT_OF_RANGE (gRPC code 11) when requested fromSlot was evicted from Helius buffer
        if (err.code === 11 || (err.message && err.message.includes('OUT_OF_RANGE'))) {
          const match = err.message.match(/oldest available slot (\\d+)/i);
          if (match && match[1]) {
            const minSlot = Number(match[1]);
            console.warn(\`[Laserstream] Requested replay slot was evicted. Clamping fromSlot forward to oldest available slot: \${minSlot}\`);
            lastSeenSlot = minSlot;
            currentRequest.fromSlot = minSlot;
          } else {
            console.warn(\`[Laserstream] Requested replay slot was evicted. Resuming from live slot.\`);
            delete currentRequest.fromSlot;
            lastSeenSlot = null;
          }
          reconnectAttempts = 0;
          setTimeout(() => {
            if (!isCanceled) {
              try { client.close(); } catch {}
              client = new GeyserClientClass(target, sslCreds, grpcOptions);
              connect();
            }
          }, 300);
          return;
        }

        if (err.code === grpc.status.UNAUTHENTICATED || err.code === grpc.status.INVALID_ARGUMENT) {
          if (callback) callback(err, null);
          return;
        }

        scheduleReconnect(err);
      });

      activeCall.on('end', () => {
        if (isCanceled) return;
        scheduleReconnect(new Error('Laserstream connection closed by server'));
      });

      if (this.replay && lastSeenSlot !== null) {
        currentRequest.fromSlot = lastSeenSlot;
      }
      activeCall.write(currentRequest);
    };

    const scheduleReconnect = (err) => {
      if (isCanceled) return;
      if (reconnectAttempts >= this.maxReconnectAttempts) {
        if (callback) {
          callback(new Error(\`Laserstream max reconnect attempts reached (\${this.maxReconnectAttempts}): \${err.message}\`), null);
        }
        return;
      }

      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 15000);
      setTimeout(() => {
        if (!isCanceled) {
          try {
            client.close();
          } catch {}
          client = new GeyserClientClass(target, sslCreds, grpcOptions);
          connect();
        }
      }, delay);
    };

    connect();

    const handle = {
      id: handleId,
      cancel: () => {
        isCanceled = true;
        if (activeCall) {
          try {
            activeCall.cancel();
          } catch {}
        }
        try {
          client.close();
        } catch {}
        activeStreamHandles.delete(handle);
      },
      write: async (req) => {
        Object.assign(currentRequest, req);
        if (activeCall && !isCanceled) {
          activeCall.write(req);
        }
      },
    };

    activeStreamHandles.add(handle);
    return handle;
  }
}

class UnaryClient {
  constructor(endpoint, apiKey, channelOptions, timeoutMs = 30000) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.channelOptions = channelOptions || {};
    this.timeoutMs = timeoutMs;
    this.client = null;
  }

  async _getClient() {
    if (!this.client) {
      const { GeyserClientClass } = await getProto();
      const target = normalizeEndpoint(this.endpoint);
      this.client = new GeyserClientClass(target, grpc.credentials.createSsl(), this.channelOptions);
    }
    return this.client;
  }

  _getMeta() {
    const meta = new grpc.Metadata();
    if (this.apiKey) {
      meta.set('x-token', this.apiKey);
    }
    return meta;
  }

  close() {
    if (this.client) {
      try {
        this.client.close();
      } catch {}
      this.client = null;
    }
  }

  async getSlot(commitment) {
    const client = await this._getClient();
    return new Promise((resolve, reject) => {
      client.GetSlot({ commitment }, this._getMeta(), { deadline: Date.now() + this.timeoutMs }, (err, resp) => {
        if (err) reject(err);
        else resolve({ slot: String(resp.slot) });
      });
    });
  }

  async getBlockHeight(commitment) {
    const client = await this._getClient();
    return new Promise((resolve, reject) => {
      client.GetBlockHeight({ commitment }, this._getMeta(), { deadline: Date.now() + this.timeoutMs }, (err, resp) => {
        if (err) reject(err);
        else resolve({ blockHeight: String(resp.blockHeight) });
      });
    });
  }

  async getLatestBlockhash(commitment) {
    const client = await this._getClient();
    return new Promise((resolve, reject) => {
      client.GetLatestBlockhash({ commitment }, this._getMeta(), { deadline: Date.now() + this.timeoutMs }, (err, resp) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
  }

  async isBlockhashValid(blockhash, commitment) {
    const client = await this._getClient();
    return new Promise((resolve, reject) => {
      client.IsBlockhashValid({ blockhash, commitment }, this._getMeta(), { deadline: Date.now() + this.timeoutMs }, (err, resp) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
  }

  async getVersion() {
    const client = await this._getClient();
    return new Promise((resolve, reject) => {
      client.GetVersion({}, this._getMeta(), { deadline: Date.now() + this.timeoutMs }, (err, resp) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
  }

  async ping(count = 1) {
    const client = await this._getClient();
    return new Promise((resolve, reject) => {
      client.Ping({ count }, this._getMeta(), { deadline: Date.now() + this.timeoutMs }, (err, resp) => {
        if (err) reject(err);
        else resolve({ count: resp.count });
      });
    });
  }

  async subscribeReplayInfo() {
    const client = await this._getClient();
    return new Promise((resolve, reject) => {
      client.SubscribeReplayInfo({}, this._getMeta(), { deadline: Date.now() + this.timeoutMs }, (err, resp) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
  }
}

function shutdownAllStreams() {
  for (const handle of activeStreamHandles) {
    try {
      handle.cancel();
    } catch {}
  }
  activeStreamHandles.clear();
}

function getActiveStreamCount() {
  return activeStreamHandles.size;
}

const CommitmentLevel = {
  PROCESSED: 0,
  CONFIRMED: 1,
  FINALIZED: 2,
};

module.exports = {
  LaserstreamClient,
  UnaryClient,
  CommitmentLevel,
  shutdownAllStreams,
  getActiveStreamCount,
};
`;
  fs.writeFileSync(fallbackSource, fallbackCode, 'utf8');
}

// Check index.js and patch if needed
if (fs.existsSync(indexFile)) {
  let indexContent = fs.readFileSync(indexFile, 'utf8');
  if (!indexContent.includes("require('./fallback')")) {
    indexContent = indexContent.replace(
      /if \(!nativeBinding\) \{[\s\S]*?throw new Error\(`Failed to load native binding`\)[\s\S]*?\}/,
      `if (!nativeBinding) {
  try {
    nativeBinding = require('./fallback');
  } catch (fallbackError) {
    if (loadError) {
      throw loadError;
    }
    throw new Error('Failed to load native binding');
  }
}`
    );
    fs.writeFileSync(indexFile, indexContent, 'utf8');
  }
}
