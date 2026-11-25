import {
  subscribe,
  LaserstreamClient,
  CommitmentLevel,
  LaserstreamConfig,
  SubscribeRequest,
  SubscribeUpdate,
  StreamHandle,
} from 'helius-laserstream';
import bs58 from 'bs58';
import {
  IndexerConfig,
  ParsedTransaction,
  ParsedAccountUpdate,
  ParsedInstruction,
} from './types';
import { DatabaseManager } from './db';
import { MicroscopeIdlDecoder } from './microscope/idlDecoder';
import { MicroscopeGovernanceTracker } from './microscope/governance';
import { MicroscopeMetrics } from './microscope/metrics';
import { MicroscopeServer } from './microscope/server';
import { RpcFailoverPoller } from './rpcFailover';

/**
 * Builds the Helius Laserstream gRPC subscription request:
 * - accountInclude for transaction filtering by multiple Program IDs & Multisig addresses
 * - owner for account update filtering by Program IDs
 * - Commitment level configurable (defaults to CONFIRMED)
 * - fromSlot for historical replay if resuming
 */
export function buildSubscribeRequest(
  programIdsInput: string | string[],
  commitment: CommitmentLevel = CommitmentLevel.CONFIRMED,
  fromSlot?: number | null,
  multisigAddresses: string[] = []
): SubscribeRequest {
  const programIds = Array.isArray(programIdsInput) ? programIdsInput : [programIdsInput];
  const accountInclude = Array.from(new Set([...programIds, ...multisigAddresses].filter(Boolean)));
  const owners = Array.from(new Set(programIds.filter(Boolean)));

  const request: SubscribeRequest = {
    transactions: {
      'program-txs': {
        accountInclude,
        accountExclude: [],
        accountRequired: [],
        vote: false,
        failed: false,
      },
    },
    accounts: {
      'program-accounts': {
        account: [],
        owner: owners,
        filters: [],
      },
    },
    slots: {
      'slot-tracker': {
        filterByCommitment: true,
      },
    },
    commitment,
  };

  if (typeof fromSlot === 'number' && fromSlot > 0) {
    request.fromSlot = fromSlot;
  }

  return request;
}

/**
 * Decodes raw transaction protobuf into a structured, readable format.
 * If an Anchor IDL decoder is provided, instructions and Anchor events are decoded into named arguments.
 */
export function parseTransactionUpdate(
  update: SubscribeUpdate,
  idlDecoder?: MicroscopeIdlDecoder,
  targetProgramIds?: string | string[]
): ParsedTransaction | null {
  const txUpdate = update.transaction;
  if (!txUpdate || !txUpdate.transaction) {
    return null;
  }

  const txInfo = txUpdate.transaction;
  const rawTx = txInfo.transaction;
  const meta = txInfo.meta;

  const slot = Number(txUpdate.slot || 0);
  const signature = txInfo.signature ? bs58.encode(Buffer.from(txInfo.signature)) : '';

  if (!signature) {
    return null;
  }

  // Parse account keys
  const accountKeys: string[] = [];
  if (rawTx?.message?.accountKeys) {
    for (const keyBuf of rawTx.message.accountKeys) {
      if (keyBuf) {
        accountKeys.push(bs58.encode(Buffer.from(keyBuf)));
      }
    }
  }

  const recentBlockhash = rawTx?.message?.recentBlockhash
    ? bs58.encode(Buffer.from(rawTx.message.recentBlockhash))
    : '';

  // Parse instructions & attempt Anchor IDL decoding
  const instructions: ParsedInstruction[] = [];
  if (rawTx?.message?.instructions) {
    for (const inst of rawTx.message.instructions) {
      const progIdx = inst.programIdIndex ?? -1;
      const programId = progIdx >= 0 && progIdx < accountKeys.length ? accountKeys[progIdx] : `idx:${progIdx}`;

      const rawAccounts = inst.accounts ? Array.from(inst.accounts) : [];
      const instAccounts: string[] = rawAccounts.map((idx: number) =>
        idx >= 0 && idx < accountKeys.length ? accountKeys[idx] : `idx:${idx}`
      );
      const dataStr = inst.data ? Buffer.from(inst.data).toString('base64') : '';

      // Decode with Anchor IDL if active and matching any target program
      let decoded = null;
      const targetList = Array.isArray(targetProgramIds)
        ? targetProgramIds
        : targetProgramIds
          ? [targetProgramIds]
          : [];
      if (idlDecoder && (targetList.length === 0 || targetList.includes(programId))) {
        decoded = idlDecoder.decodeInstruction(dataStr);
      }

      instructions.push({
        programId,
        accounts: instAccounts,
        data: dataStr,
        decoded,
      });
    }
  }

  const fee = meta?.fee !== undefined && meta?.fee !== null ? Number(meta.fee) : 0;
  const computeUnitsConsumed =
    meta?.computeUnitsConsumed !== undefined && meta?.computeUnitsConsumed !== null
      ? Number(meta.computeUnitsConsumed)
      : null;
  const err = meta?.err ? JSON.stringify(meta.err) : null;
  const logMessages = meta?.logMessages || [];

  // Decode Anchor event logs
  const decodedEvents = idlDecoder ? idlDecoder.decodeEvents(logMessages) : [];

  const createdAt = update.createdAt instanceof Date ? update.createdAt.toISOString() : new Date().toISOString();

  return {
    signature,
    slot,
    blockTime: null,
    err,
    fee,
    computeUnitsConsumed,
    recentBlockhash,
    accounts: accountKeys,
    instructions,
    logMessages,
    decodedEvents: decodedEvents.length > 0 ? decodedEvents : undefined,
    createdAt,
  };
}

/**
 * Decodes raw account update protobuf into a structured format.
 */
export function parseAccountUpdate(update: SubscribeUpdate): ParsedAccountUpdate | null {
  const accUpdate = update.account;
  if (!accUpdate || !accUpdate.account) {
    return null;
  }

  const accInfo = accUpdate.account;
  const slot = Number(accUpdate.slot || 0);
  const pubkey = accInfo.pubkey ? bs58.encode(Buffer.from(accInfo.pubkey)) : '';
  const owner = accInfo.owner ? bs58.encode(Buffer.from(accInfo.owner)) : '';

  if (!pubkey) {
    return null;
  }

  const lamports = accInfo.lamports !== undefined && accInfo.lamports !== null ? Number(accInfo.lamports) : 0;
  const executable = Boolean(accInfo.executable);
  const rentEpoch = accInfo.rentEpoch !== undefined && accInfo.rentEpoch !== null ? Number(accInfo.rentEpoch) : 0;
  const data = accInfo.data ? Buffer.from(accInfo.data) : Buffer.alloc(0);
  const writeVersion =
    accInfo.writeVersion !== undefined && accInfo.writeVersion !== null ? Number(accInfo.writeVersion) : 0;
  const txnSignature = accInfo.txnSignature ? bs58.encode(Buffer.from(accInfo.txnSignature)) : null;

  const updatedAt = update.createdAt instanceof Date ? update.createdAt.toISOString() : new Date().toISOString();

  return {
    pubkey,
    slot,
    owner,
    lamports,
    executable,
    rentEpoch,
    dataLen: data.length,
    dataBase64: data.toString('base64'),
    writeVersion,
    txnSignature,
    updatedAt,
  };
}

export interface MicroscopeContext {
  idlDecoder: MicroscopeIdlDecoder;
  governance: MicroscopeGovernanceTracker;
  metrics: MicroscopeMetrics;
  server: MicroscopeServer;
}

/**
 * Connects to Helius Devnet Laserstream gRPC and handles indexing & Microscope pipeline.
 */
export async function startLaserstreamSubscription(
  config: IndexerConfig,
  db: DatabaseManager,
  microscope?: MicroscopeContext
): Promise<{ stream: StreamHandle | null; stop: () => void }> {
  const watchedPrograms =
    config.programIds && config.programIds.length > 0 ? config.programIds : [config.programId];
  const multisigs = config.multisigAddresses || [];
  const rpcFailover = new RpcFailoverPoller(config, db, microscope);

  const laserstreamConfig: LaserstreamConfig = {
    apiKey: config.heliusApiKey,
    endpoint: config.endpoint,
    maxReconnectAttempts: config.maxReconnectAttempts,
    replay: config.replay,
    intraSlotUpdates: config.intraSlotUpdates,
  };

  // Determine starting slot for replay if resuming from SQLite
  const latestStoredSlot = db.getLatestSlot();
  let fromSlot = config.replay && latestStoredSlot && latestStoredSlot > 0 ? latestStoredSlot : undefined;

  // Proactively check oldest available replay slot with Helius unary client
  if (fromSlot) {
    try {
      const unaryClient = new LaserstreamClient({
        endpoint: config.endpoint,
        apiKey: config.heliusApiKey,
        timeoutMs: 5000,
      });
      const replayInfo = await unaryClient.subscribeReplayInfo().catch(() => null);
      unaryClient.close();

      if (replayInfo?.firstAvailable) {
        const firstAvailable = Number(replayInfo.firstAvailable);
        if (fromSlot < firstAvailable) {
          console.warn(
            `[Laserstream] Stored slot ${fromSlot} is older than oldest available buffer slot ${firstAvailable}. ` +
            `Clamping fromSlot forward to ${firstAvailable} to prevent OUT_OF_RANGE error.`
          );
          fromSlot = firstAvailable;
          db.updateLatestSlot(firstAvailable);
        }
      }
    } catch {
      // Ignored if unary check is unavailable
    }
  }

  const request = buildSubscribeRequest(watchedPrograms, config.commitment, fromSlot, multisigs);

  console.log(`[Laserstream] Connecting to ${config.endpoint}...`);
  if (fromSlot) {
    console.log(`[Laserstream] Resuming stream with replay from slot: ${fromSlot}`);
  }

  const onData = (update: SubscribeUpdate) => {
    // Automatic failback: if RPC failover was active, stop it now that gRPC is delivering data
    if (rpcFailover.isActive()) {
      rpcFailover.stop(true);
    }

    // 1. Slot update
    if (update.slot && update.slot.slot) {
      const slot = Number(update.slot.slot);
      db.updateLatestSlot(slot);
      if (microscope) {
        microscope.server.broadcastSlot(slot);
      }
    }

    // 2. Transaction update
    if (update.transaction) {
      const parsedTx = parseTransactionUpdate(update, microscope?.idlDecoder, watchedPrograms);
      if (parsedTx) {
        db.saveTransaction(parsedTx);

        // Microscope Governance & Multisig Analysis
        if (microscope) {
          const govEvent = microscope.governance.analyzeTransaction(parsedTx, watchedPrograms, multisigs);
          if (govEvent) {
            db.saveGovernanceEvent(govEvent);
            microscope.metrics.recordGovernanceEvent();
            microscope.server.broadcastGovernance(govEvent);
            console.log(`\x1b[33m[Microscope Governance]\x1b[0m ${govEvent.type}: ${govEvent.description}`);
          }

          // Record metrics & broadcast to live dashboard
          const decodedNames = parsedTx.instructions.map((i) => i.decoded?.name).filter(Boolean) as string[];
          microscope.metrics.recordTransaction(parsedTx, decodedNames);
          microscope.server.broadcastTransaction(parsedTx);
        }

        const status = parsedTx.err ? `FAILED (${parsedTx.err})` : 'SUCCESS';
        const decodedSummary = parsedTx.instructions.find((i) => i.decoded)?.decoded?.name;
        const instTag = decodedSummary ? `[IDL: ${decodedSummary}] ` : '';

        console.log(
          `[TX] Slot ${parsedTx.slot} | ${instTag}Sig: ${parsedTx.signature.slice(0, 16)}... | ` +
          `Fee: ${parsedTx.fee} lamports | Accounts: ${parsedTx.accounts.length} | Status: ${status}`
        );
      }
    }

    // 3. Account update
    if (update.account) {
      const parsedAcc = parseAccountUpdate(update);
      if (parsedAcc) {
        db.saveAccountUpdate(parsedAcc);
        console.log(
          `[ACC] Slot ${parsedAcc.slot} | Pubkey: ${parsedAcc.pubkey.slice(0, 16)}... | ` +
          `Owner: ${parsedAcc.owner.slice(0, 12)}... | Lamports: ${parsedAcc.lamports} | Data: ${parsedAcc.dataLen} bytes`
        );
      }
    }
  };

  const onError = (error: Error) => {
    console.error(`[Laserstream] Stream error:`, error.message);
    if (!rpcFailover.isActive()) {
      rpcFailover.start(error.message);
    }
  };

  let stream: StreamHandle | null = null;
  try {
    stream = await subscribe(laserstreamConfig, request, onData, onError);
    console.log(`[Laserstream] Subscription active (Stream ID: ${stream.id})`);
  } catch (err: any) {
    console.error(`[Laserstream] Initial subscribe failed:`, err.message);
    rpcFailover.start(err.message);
  }

  return {
    stream,
    stop: () => {
      rpcFailover.stop(false);
      if (stream) {
        console.log(`[Laserstream] Cancelling stream ID ${stream.id}...`);
        stream.cancel();
      }
    },
  };
}
