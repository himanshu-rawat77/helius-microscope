import { DatabaseManager } from '../src/db';
import { ParsedTransaction, ParsedAccountUpdate } from '../src/types';
import fs from 'fs';

async function runTest() {
  const testDbPath = './test-indexer.db';
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  console.log('[Test] Initializing DatabaseManager on', testDbPath);
  const db = new DatabaseManager(testDbPath);
  db.init();

  const dummyTx: ParsedTransaction = {
    signature: '5wHzFjZ2144YhT8xM7t1c9Xyq2zV4B3n6M7K8L9P0Q1R2S3T4U5V6W7X8Y9Z0A1B2C3D4E5F6G7H8I9J0K',
    slot: 284192000,
    blockTime: Math.floor(Date.now() / 1000),
    err: null,
    fee: 5000,
    computeUnitsConsumed: 1250,
    recentBlockhash: 'EkSnNWid2cvwEVnPx9aZaWBppFed381PhKTbMsBaNVNP',
    accounts: [
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
      '4Nd1mBQtrMJVYVfKf2PJy9NZzqd3ChD2PeeU9SoB619v',
    ],
    instructions: [
      {
        programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
        accounts: ['4Nd1mBQtrMJVYVfKf2PJy9NZzqd3ChD2PeeU9SoB619v'],
        data: Buffer.from('Hello Solana Devnet').toString('base64'),
      },
    ],
    logMessages: [
      'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]',
      'Program log: Memo (len 19): "Hello Solana Devnet"',
      'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr success',
    ],
    createdAt: new Date().toISOString(),
  };

  console.log('[Test] Saving transaction...');
  const txSaved = db.saveTransaction(dummyTx);
  console.log('[Test] Transaction saved:', txSaved);

  const dummyAcc: ParsedAccountUpdate = {
    pubkey: '4Nd1mBQtrMJVYVfKf2PJy9NZzqd3ChD2PeeU9SoB619v',
    slot: 284192000,
    owner: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    lamports: 1000000000,
    executable: false,
    rentEpoch: 340,
    dataLen: 128,
    dataBase64: Buffer.from('state-data-sample').toString('base64'),
    writeVersion: 1,
    txnSignature: dummyTx.signature,
    updatedAt: new Date().toISOString(),
  };

  console.log('[Test] Saving account update...');
  const accSaved = db.saveAccountUpdate(dummyAcc);
  console.log('[Test] Account saved:', accSaved);

  const stats = db.getStats();
  console.log('[Test] Database stats:', stats);

  if (stats.transactionsCount !== 1 || stats.accountsCount !== 1 || stats.latestSlot !== 284192000) {
    throw new Error(`Test failed! Unexpected stats: ${JSON.stringify(stats)}`);
  }

  const recentTxs = db.getRecentTransactions(5);
  console.log('[Test] Recent transactions count:', recentTxs.length);
  if (recentTxs[0].signature !== dummyTx.signature) {
    throw new Error('Transaction signature mismatch');
  }

  const recentAccs = db.getRecentAccounts(5);
  console.log('[Test] Recent accounts count:', recentAccs.length);
  if (recentAccs[0].pubkey !== dummyAcc.pubkey) {
    throw new Error('Account pubkey mismatch');
  }

  db.close();
  console.log('[Test] Database closed successfully.');

  // Clean up test db files
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

  console.log('[Test] ALL TESTS PASSED!');
}

runTest().catch((err) => {
  console.error('[Test] FAILED:', err);
  process.exit(1);
});
