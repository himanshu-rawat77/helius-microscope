import dotenv from 'dotenv';
dotenv.config();

import { CommitmentLevel } from 'helius-laserstream';
import { DatabaseManager } from './db';
import { startLaserstreamSubscription } from './laserstream';
import { IndexerConfig } from './types';

// Devnet endpoint per specification
const DEVNET_ENDPOINT = 'https://laserstream-devnet-ewr.helius-rpc.com';

// Default placeholder program ID: Solana SPL Memo Program on Devnet
const DEFAULT_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const COMMITMENT_NAMES: Record<CommitmentLevel, string> = {
  [CommitmentLevel.PROCESSED]: 'PROCESSED',
  [CommitmentLevel.CONFIRMED]: 'CONFIRMED',
  [CommitmentLevel.FINALIZED]: 'FINALIZED',
};

function parseCommitment(val?: string): CommitmentLevel {
  const normalized = (val || '').trim().toUpperCase();
  switch (normalized) {
    case 'PROCESSED':
      return CommitmentLevel.PROCESSED;
    case 'FINALIZED':
      return CommitmentLevel.FINALIZED;
    case 'CONFIRMED':
    default:
      return CommitmentLevel.CONFIRMED;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('       HELIUS LASERSTREAM SOLANA DEVNET INDEXER       ');
  console.log('='.repeat(70));

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey || apiKey === 'your_helius_api_key_here') {
    console.error('\n[Error] Missing HELIUS_API_KEY in environment variables.');
    console.error('Please configure your HELIUS_API_KEY in .env before running.\n');
    console.error('Example:');
    console.error('  HELIUS_API_KEY=your_actual_api_key\n');
    process.exit(1);
  }

  const endpoint = process.env.HELIUS_ENDPOINT || DEVNET_ENDPOINT;
  const programId = process.env.PROGRAM_ID || DEFAULT_PROGRAM_ID;
  const commitment = parseCommitment(process.env.COMMITMENT);
  const dbPath = process.env.DATABASE_PATH || './indexer.db';
  const replay = process.env.REPLAY !== 'false';
  const intraSlotUpdates = process.env.INTRA_SLOT_UPDATES === 'true';

  const config: IndexerConfig = {
    heliusApiKey: apiKey,
    endpoint,
    programId,
    commitment,
    dbPath,
    maxReconnectAttempts: 15,
    replay,
    intraSlotUpdates,
  };

  console.log(`[Config] Target Endpoint  : ${config.endpoint}`);
  console.log(`[Config] Target Program ID: ${config.programId}`);
  console.log(`[Config] Commitment Level : ${COMMITMENT_NAMES[config.commitment]}`);
  console.log(`[Config] Database Path    : ${config.dbPath}`);
  console.log(`[Config] Replay Resiliency: ${config.replay}`);
  console.log('='.repeat(70));

  // Initialize SQLite database
  const db = new DatabaseManager(config.dbPath);
  db.init();

  const initialStats = db.getStats();
  console.log(
    `[Database] Initialized. Current store: ${initialStats.transactionsCount} txs, ` +
    `${initialStats.accountsCount} accounts. Last slot: ${initialStats.latestSlot}`
  );

  // Start subscription stream
  let subscription: { stream: any; stop: () => void };
  try {
    subscription = await startLaserstreamSubscription(config, db);
  } catch (err: any) {
    console.error('[Error] Failed to initialize Laserstream subscription:', err.message);
    db.close();
    process.exit(1);
  }

  // Periodic statistics reporter (every 20 seconds)
  const statsInterval = setInterval(() => {
    const stats = db.getStats();
    console.log(
      `[Stats] Transactions: ${stats.transactionsCount} | ` +
      `Accounts: ${stats.accountsCount} | ` +
      `Latest Slot: ${stats.latestSlot} | ` +
      `Last Update: ${stats.lastUpdateAt || 'none'}`
    );
  }, 20000);

  // Graceful shutdown handling
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Shutdown] Received ${signal}. Gracefully stopping indexer...`);
    clearInterval(statsInterval);

    try {
      subscription.stop();
      console.log('[Shutdown] Laserstream stream disconnected.');
    } catch (err: any) {
      console.error('[Shutdown] Error disconnecting stream:', err.message);
    }

    try {
      db.close();
      console.log('[Shutdown] SQLite database safely closed.');
    } catch (err: any) {
      console.error('[Shutdown] Error closing database:', err.message);
    }

    console.log('[Shutdown] Indexer stopped cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep process running
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
