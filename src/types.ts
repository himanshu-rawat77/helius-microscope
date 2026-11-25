import { CommitmentLevel } from 'helius-laserstream';

/**
 * Configuration options for the Helius Devnet Indexer & Microscope
 */
export interface IndexerConfig {
  /** Target Solana cluster ('mainnet' | 'devnet') */
  network: 'mainnet' | 'devnet';
  /** Helius API key with access to Laserstream gRPC */
  heliusApiKey: string;
  /** Laserstream gRPC endpoint */
  endpoint: string;
  /** Primary Solana Program ID (kept for backwards compatibility) */
  programId: string;
  /** Multiple Solana Program IDs to monitor simultaneously */
  programIds?: string[];
  /** Optional Multisig / Squads PDA addresses to monitor */
  multisigAddresses?: string[];
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
  /** Port for Microscope Local Dashboard (default: 3000) */
  microscopePort?: number;
  /** Optional file path to Anchor IDL JSON */
  idlPath?: string;
  /** Enable automatic RPC polling failover if LaserStream gRPC disconnects */
  rpcFailoverEnabled?: boolean;
  /** Optional custom Solana JSON-RPC URL for failover */
  rpcEndpoint?: string;
  /** RPC polling interval in ms when failover is active (default: 3000) */
  rpcPollIntervalMs?: number;
}

/**
 * Anchor IDL decoded instruction
 */
export interface DecodedInstruction {
  name: string;
  args: Record<string, any>;
}

/**
 * Anchor IDL decoded event (emitted via emit!)
 */
export interface DecodedEvent {
  name: string;
  data: Record<string, any>;
}

/**
 * Parsed Solana Instruction summary
 */
export interface ParsedInstruction {
  programId: string;
  accounts: string[];
  data: string;
  decoded?: DecodedInstruction | null;
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
  decodedEvents?: DecodedEvent[];
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
 * Microscope Governance and Program Upgrade Event
 */
export interface GovernanceEvent {
  type: 'PROGRAM_UPGRADE' | 'AUTHORITY_CHANGE' | 'MULTISIG_PROPOSAL' | 'MULTISIG_EXECUTE';
  signature: string;
  slot: number;
  description: string;
  details: Record<string, any>;
  timestamp: string;
}

/**
 * Indexer runtime statistics
 */
export interface IndexerStats {
  transactionsCount: number;
  accountsCount: number;
  governanceCount?: number;
  latestSlot: number;
  lastUpdateAt: string | null;
}
