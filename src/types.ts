import { CommitmentLevel } from 'helius-laserstream';

/**
 * Configuration options for the Helius Devnet Indexer
 */
export interface IndexerConfig {
  /** Helius API key with access to Laserstream gRPC */
  heliusApiKey: string;
  /** Devnet Laserstream endpoint (default: https://laserstream-devnet-ewr.helius-rpc.com) */
  endpoint: string;
  /** Solana Program ID to index transactions and accounts for */
  programId: string;
  /** Commitment level (PROCESSED = 0, CONFIRMED = 1, FINALIZED = 2) */
  commitment: CommitmentLevel;
  /** Path to the SQLite database file */
  dbPath: string;
  /** Maximum number of reconnection attempts before giving up */
  maxReconnectAttempts: number;
  /** Automatically replay missed slots upon reconnection */
  replay: boolean;
  /** Deliver every write per slot rather than only latest state */
  intraSlotUpdates: boolean;
}

/**
 * Parsed Solana Instruction summary
 */
export interface ParsedInstruction {
  programId: string;
  accounts: string[];
  data: string;
}

/**
 * Normalized transaction record stored in database
 */
export interface ParsedTransaction {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: string | null;
  fee: number;
  computeUnitsConsumed: number | null;
  recentBlockhash: string;
  accounts: string[];
  instructions: ParsedInstruction[];
  logMessages: string[];
  createdAt: string;
}

/**
 * Normalized account update record stored in database
 */
export interface ParsedAccountUpdate {
  pubkey: string;
  slot: number;
  owner: string;
  lamports: number;
  executable: boolean;
  rentEpoch: number;
  dataLen: number;
  dataBase64: string;
  writeVersion: number;
  txnSignature: string | null;
  updatedAt: string;
}

/**
 * Indexer runtime statistics
 */
export interface IndexerStats {
  transactionsCount: number;
  accountsCount: number;
  latestSlot: number;
  lastUpdateAt: string | null;
}
