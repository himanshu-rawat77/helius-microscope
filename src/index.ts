import dotenv from 'dotenv';
dotenv.config();

import { CommitmentLevel } from 'helius-laserstream';
import { DatabaseManager } from './db';
import { startLaserstreamSubscription } from './laserstream';
import { IndexerConfig } from './types';
import { MicroscopeIdlDecoder } from './microscope/idlDecoder';
import { MicroscopeGovernanceTracker } from './microscope/governance';
import { MicroscopeMetrics } from './microscope/metrics';
import { MicroscopeServer } from './microscope/server';
import fs from 'fs';
import path from 'path';

// Helius LaserStream Regional Endpoints
const LASERSTREAM_DEVNET_ENDPOINT = 'https://laserstream-devnet-ewr.helius-rpc.com';
const LASERSTREAM_MAINNET_ENDPOINT = 'https://laserstream-mainnet-ewr.helius-rpc.com';

// Default placeholder program ID: Solana SPL Memo Program
const DEFAULT_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const COMMITMENT_NAMES: Record<CommitmentLevel, string> = {
  [CommitmentLevel.PROCESSED]: 'PROCESSED',
  [CommitmentLevel.CONFIRMED]: 'CONFIRMED',
  [CommitmentLevel.FINALIZED]: 'FINALIZED',
};

function parseAddressList(raw?: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

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
  console.log('='.repeat(72));
  console.log('        SOLANA MICROSCOPE LOCAL & HELIUS LASERSTREAM INDEXER        ');
  console.log('='.repeat(72));

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey || apiKey === 'your_helius_api_key_here') {
    console.error('\n[Error] Missing HELIUS_API_KEY in environment variables.');
    console.error('Please configure your HELIUS_API_KEY in .env before running.\n');
    console.error('Example:');
    console.error('  HELIUS_API_KEY=your_actual_api_key\n');
    process.exit(1);
  }

  // Parse Target Network (devnet | mainnet)
  const networkRaw = (process.env.NETWORK || 'devnet').trim().toLowerCase();
  const network: 'mainnet' | 'devnet' =
    networkRaw === 'mainnet' || networkRaw === 'mainnet-beta' ? 'mainnet' : 'devnet';

  const defaultEndpoint = network === 'mainnet' ? LASERSTREAM_MAINNET_ENDPOINT : LASERSTREAM_DEVNET_ENDPOINT;
  const endpoint = process.env.HELIUS_ENDPOINT || defaultEndpoint;
  const parsedProgramIds = parseAddressList(process.env.PROGRAM_IDS || process.env.PROGRAM_ID);
  const programIds = parsedProgramIds.length > 0 ? parsedProgramIds : [DEFAULT_PROGRAM_ID];
  const programId = programIds[0];
  const multisigAddresses = parseAddressList(process.env.MULTISIG_ADDRESSES);
  const commitment = parseCommitment(process.env.COMMITMENT);
  const dbPath = process.env.DATABASE_PATH || './indexer.db';
  const replay = process.env.REPLAY !== 'false';
  const intraSlotUpdates = process.env.INTRA_SLOT_UPDATES === 'true';
  const microscopePort = parseInt(process.env.MICROSCOPE_PORT || '3000', 10);
  const idlPath = process.env.IDL_PATH || './idl.json';
  const rpcFailoverEnabled = process.env.RPC_FAILOVER_ENABLED !== 'false';
  const rpcEndpoint = process.env.HELIUS_RPC_URL || undefined;
  const rpcPollIntervalMs = parseInt(process.env.RPC_POLL_INTERVAL_MS || '3000', 10);

  const config: IndexerConfig = {
    network,
    heliusApiKey: apiKey,
    endpoint,
    programId,
    programIds,
    multisigAddresses,
    commitment,
    dbPath,
    maxReconnectAttempts: 15,
    replay,
    intraSlotUpdates,
    microscopePort,
    idlPath,
    rpcFailoverEnabled,
    rpcEndpoint,
    rpcPollIntervalMs,
  };

  // 1. Initialize SQLite Database
  const db = new DatabaseManager(config.dbPath);
  db.init();

  const initialStats = db.getMetricsAggregate();
  console.log(
    `[Database] Initialized. Stored: ${initialStats.transactionsCount} txs, ` +
    `${initialStats.accountsCount} accounts, ${initialStats.governanceCount || 0} governance events.`
  );

  // 2. Initialize Microscope Components
  const idlDecoder = new MicroscopeIdlDecoder();
  if (fs.existsSync(config.idlPath!)) {
    idlDecoder.loadIdlFromFile(path.resolve(config.idlPath!));
  } else {
    console.log(`[Microscope IDL] No local idl.json found. You can upload/paste one directly on the dashboard.`);
  }

  const governanceTracker = new MicroscopeGovernanceTracker();
  governanceTracker.initFromDatabase(db.getRecentGovernanceEvents());

  const metrics = new MicroscopeMetrics();
  metrics.initFromDatabase(initialStats);

  const microscopeServer = new MicroscopeServer(
    idlDecoder,
    governanceTracker,
    metrics,
    db,
    config.programIds || [config.programId],
    config.endpoint,
    config.network,
    config.microscopePort,
    config.multisigAddresses || []
  );
  await microscopeServer.start();

  console.log(`[Config] Target Cluster   : ${config.network.toUpperCase()} (${config.network === 'mainnet' ? 'Solana Mainnet-Beta' : 'Solana Devnet'})`);
  console.log(`[Config] Target Endpoint  : ${config.endpoint}`);
  console.log(`[Config] Target Programs  : ${(config.programIds || [config.programId]).join(', ')}`);
  if (config.multisigAddresses && config.multisigAddresses.length > 0) {
    console.log(`[Config] Multisig Targets : ${config.multisigAddresses.join(', ')}`);
  }
  console.log(`[Config] RPC Failover     : ${config.rpcFailoverEnabled ? `Enabled (${config.rpcPollIntervalMs}ms poll)` : 'Disabled'}`);
  console.log(`[Config] Commitment Level : ${COMMITMENT_NAMES[config.commitment]}`);
  console.log(`[Config] Database Path    : ${config.dbPath}`);
  console.log(`[Config] Replay Resiliency: ${config.replay}`);
  console.log('='.repeat(72));

  // 3. Start Helius LaserStream gRPC Subscription
  let subscription: { stream: any; stop: () => void };
  try {
    subscription = await startLaserstreamSubscription(config, db, {
      idlDecoder,
      governance: governanceTracker,
      metrics,
      server: microscopeServer,
    });
  } catch (err: any) {
    console.error('[Error] Failed to initialize Laserstream subscription:', err.message);
    microscopeServer.stop();
    db.close();
    process.exit(1);
  }

  // Periodic statistics reporter (every 20 seconds)
  const statsInterval = setInterval(() => {
    const summary = metrics.getSummary();
    console.log(
      `[Microscope Stats] Txs: ${summary.totalTransactions} | ` +
      `Failed: ${summary.totalFailed} (${summary.successRate}%) | ` +
      `TPS: ${summary.tps} | ` +
      `Avg CU: ${summary.avgComputeUnits.toLocaleString()} | ` +
      `Gov Events: ${summary.governanceEventsCount}`
    );
  }, 20000);

  // Graceful shutdown handling
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Shutdown] Received ${signal}. Gracefully stopping Microscope Local...`);
    clearInterval(statsInterval);

    try {
      microscopeServer.stop();
      console.log('[Shutdown] Microscope local server stopped.');
    } catch (err: any) {
      console.error('[Shutdown] Error stopping web server:', err.message);
    }

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

    console.log('[Shutdown] Microscope Local stopped cleanly.');
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
