import {
  subscribe,
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

/**
 * Builds the Helius Laserstream gRPC subscription request according to requirements:
 * - accountInclude for transaction filtering by Program ID
 * - owner for account update filtering by Program ID
 * - Commitment level configurable (defaults to CONFIRMED)
 * - fromSlot for historical replay if resuming
 */
export function buildSubscribeRequest(
  programId: string,
  commitment: CommitmentLevel = CommitmentLevel.CONFIRMED,
  fromSlot?: number | null
): SubscribeRequest {
  const request: SubscribeRequest = {
    transactions: {
      'program-txs': {
        accountInclude: [programId],
        accountExclude: [],
        accountRequired: [],
        vote: false,
        failed: false,
      },
    },
    accounts: {
      'program-accounts': {
        account: [],
        owner: [programId],
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
 */
export function parseTransactionUpdate(update: SubscribeUpdate): ParsedTransaction | null {
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

  // Parse instructions
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

      instructions.push({
        programId,
        accounts: instAccounts,
        data: dataStr,
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

/**
 * Connects to Helius Devnet Laserstream gRPC and handles indexing loop.
 */
export async function startLaserstreamSubscription(
  config: IndexerConfig,
  db: DatabaseManager
): Promise<{ stream: StreamHandle; stop: () => void }> {
  const laserstreamConfig: LaserstreamConfig = {
    apiKey: config.heliusApiKey,
    endpoint: config.endpoint,
    maxReconnectAttempts: config.maxReconnectAttempts,
    replay: config.replay,
    intraSlotUpdates: config.intraSlotUpdates,
  };

  // Determine starting slot for replay if resuming from SQLite
  const latestStoredSlot = db.getLatestSlot();
  const fromSlot = config.replay && latestStoredSlot && latestStoredSlot > 0 ? latestStoredSlot : undefined;

  const request = buildSubscribeRequest(config.programId, config.commitment, fromSlot);

  console.log(`[Laserstream] Connecting to ${config.endpoint}...`);
  if (fromSlot) {
    console.log(`[Laserstream] Resuming stream with replay from slot: ${fromSlot}`);
  }

  const onData = (update: SubscribeUpdate) => {
    // 1. Slot update
    if (update.slot && update.slot.slot) {
      const slot = Number(update.slot.slot);
      db.updateLatestSlot(slot);
    }

    // 2. Transaction update
    if (update.transaction) {
      const parsedTx = parseTransactionUpdate(update);
      if (parsedTx) {
        db.saveTransaction(parsedTx);
        const status = parsedTx.err ? `FAILED (${parsedTx.err})` : 'SUCCESS';
        console.log(
          `[TX] Slot ${parsedTx.slot} | Sig: ${parsedTx.signature.slice(0, 16)}... | ` +
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
  };

  const stream = await subscribe(laserstreamConfig, request, onData, onError);
  console.log(`[Laserstream] Subscription active (Stream ID: ${stream.id})`);

  return {
    stream,
    stop: () => {
      console.log(`[Laserstream] Cancelling stream ID ${stream.id}...`);
      stream.cancel();
    },
  };
}
