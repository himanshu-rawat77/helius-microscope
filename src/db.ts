import { DatabaseSync } from 'node:sqlite';
import { ParsedTransaction, ParsedAccountUpdate, IndexerStats } from './types';
import path from 'path';
import fs from 'fs';

export class DatabaseManager {
  private db: DatabaseSync | null = null;
  private dbPath: string;

  constructor(dbPath: string = './indexer.db') {
    this.dbPath = path.resolve(dbPath);
  }

  /**
   * Initializes the SQLite database, establishes tables and performance indexes.
   */
  public init(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);

    // Apply performance pragmas for write-heavy streaming indexing
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    // Schema definition
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexer_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        signature TEXT PRIMARY KEY,
        slot INTEGER NOT NULL,
        block_time INTEGER,
        err TEXT,
        fee INTEGER NOT NULL,
        compute_units_consumed INTEGER,
        recent_blockhash TEXT NOT NULL,
        accounts TEXT NOT NULL,
        instructions TEXT NOT NULL,
        log_messages TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_slot ON transactions(slot);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

      CREATE TABLE IF NOT EXISTS accounts (
        pubkey TEXT NOT NULL,
        slot INTEGER NOT NULL,
        owner TEXT NOT NULL,
        lamports INTEGER NOT NULL,
        executable INTEGER NOT NULL,
        rent_epoch INTEGER NOT NULL,
        data_len INTEGER NOT NULL,
        data_base64 TEXT NOT NULL,
        write_version INTEGER NOT NULL,
        txn_signature TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (pubkey, slot, write_version)
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_pubkey ON accounts(pubkey);
      CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner);
      CREATE INDEX IF NOT EXISTS idx_accounts_slot ON accounts(slot);
    `);
  }

  private getDatabase(): DatabaseSync {
    if (!this.db) {
      throw new Error('Database is not initialized. Call init() first.');
    }
    return this.db;
  }

  /**
   * Persists a parsed transaction into SQLite.
   * Returns true if newly inserted, false if already existed.
   */
  public saveTransaction(tx: ParsedTransaction): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO transactions (
        signature, slot, block_time, err, fee, compute_units_consumed,
        recent_blockhash, accounts, instructions, log_messages, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signature) DO UPDATE SET
        slot = excluded.slot,
        err = excluded.err,
        fee = excluded.fee,
        compute_units_consumed = excluded.compute_units_consumed,
        log_messages = excluded.log_messages
    `);

    const result = stmt.run(
      tx.signature,
      tx.slot,
      tx.blockTime,
      tx.err,
      tx.fee,
      tx.computeUnitsConsumed,
      tx.recentBlockhash,
      JSON.stringify(tx.accounts),
      JSON.stringify(tx.instructions),
      JSON.stringify(tx.logMessages),
      tx.createdAt
    ) as { changes?: number };

    this.updateMetadata('last_update_at', new Date().toISOString());
    this.updateLatestSlot(tx.slot);

    return Boolean(result && result.changes && result.changes > 0);
  }

  /**
   * Persists an account update into SQLite.
   */
  public saveAccountUpdate(account: ParsedAccountUpdate): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO accounts (
        pubkey, slot, owner, lamports, executable, rent_epoch,
        data_len, data_base64, write_version, txn_signature, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pubkey, slot, write_version) DO UPDATE SET
        lamports = excluded.lamports,
        data_len = excluded.data_len,
        data_base64 = excluded.data_base64,
        updated_at = excluded.updated_at
    `);

    const result = stmt.run(
      account.pubkey,
      account.slot,
      account.owner,
      account.lamports,
      account.executable ? 1 : 0,
      account.rentEpoch,
      account.dataLen,
      account.dataBase64,
      account.writeVersion,
      account.txnSignature,
      account.updatedAt
    ) as { changes?: number };

    this.updateMetadata('last_update_at', new Date().toISOString());
    this.updateLatestSlot(account.slot);

    return Boolean(result && result.changes && result.changes > 0);
  }

  /**
   * Updates or inserts a key-value record in indexer_metadata.
   */
  public updateMetadata(key: string, value: string): void {
    const db = this.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO indexer_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, value, new Date().toISOString());
  }

  /**
   * Retrieves a metadata value by key.
   */
  public getMetadata(key: string): string | null {
    const db = this.getDatabase();
    const stmt = db.prepare(`SELECT value FROM indexer_metadata WHERE key = ?`);
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  /**
   * Tracks the latest processed slot in the database for replay resilience.
   */
  public updateLatestSlot(slot: number): void {
    const current = this.getLatestSlot();
    if (current === null || slot > current) {
      this.updateMetadata('latest_slot', String(slot));
    }
  }

  /**
   * Retrieves the highest slot observed so far.
   */
  public getLatestSlot(): number | null {
    const val = this.getMetadata('latest_slot');
    return val ? parseInt(val, 10) : null;
  }

  /**
   * Returns real-time indexing counts and status.
   */
  public getStats(): IndexerStats {
    const db = this.getDatabase();
    const txRow = db.prepare('SELECT COUNT(*) as count FROM transactions').get() as { count: number };
    const accRow = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
    const latestSlot = this.getLatestSlot() || 0;
    const lastUpdateAt = this.getMetadata('last_update_at');

    return {
      transactionsCount: txRow ? txRow.count : 0,
      accountsCount: accRow ? accRow.count : 0,
      latestSlot,
      lastUpdateAt,
    };
  }

  /**
   * Fetches recent transactions for inspection or logging.
   */
  public getRecentTransactions(limit: number = 10): any[] {
    const db = this.getDatabase();
    const stmt = db.prepare(`SELECT * FROM transactions ORDER BY slot DESC, created_at DESC LIMIT ?`);
    return stmt.all(limit);
  }

  /**
   * Fetches recent account updates for inspection.
   */
  public getRecentAccounts(limit: number = 10): any[] {
    const db = this.getDatabase();
    const stmt = db.prepare(`SELECT * FROM accounts ORDER BY slot DESC, updated_at DESC LIMIT ?`);
    return stmt.all(limit);
  }

  /**
   * Safely closes the database connection.
   */
  public close(): void {
    if (this.db) {
      try {
        this.db.exec('PRAGMA optimize;');
      } catch {}
      this.db.close();
      this.db = null;
    }
  }
}
