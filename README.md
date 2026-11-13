# Solana Devnet Indexer (Helius LaserStream gRPC)

A production-ready Solana transaction and account state indexer targeting **Solana Devnet**, built with TypeScript and the official `helius-laserstream` SDK.

Streams real-time filtered transactions and account updates directly via Helius LaserStream gRPC, decodes instruction and account data, tracks slot progression, and persists everything into a high-performance local SQLite database with automatic reconnection and historical replay.

---

## Features

- **Official SDK**: Built on `helius-laserstream` using the higher-level `subscribe()` helper.
- **Dedicated Devnet Target**: Connects to `https://laserstream-devnet-ewr.helius-rpc.com`.
- **Targeted Subscriptions**:
  - **Transactions**: Streamed using `accountInclude: [PROGRAM_ID]` filter (`vote: false`, `failed: false`).
  - **Account Updates**: Streamed using `owner: [PROGRAM_ID]` filter.
  - **Commitment**: Configurable (defaults to `CONFIRMED`).
- **Resilient Reconnection & Replay**:
  - Automatically reconnects on network dropouts.
  - Resumes from the last indexed slot (`fromSlot`), guaranteeing no data gaps during transient network interruptions.
- **SQLite Persistence**:
  - Backed by Node.js native SQLite engine (`node:sqlite`) running in WAL mode with fast indexes on slot, pubkey, owner, and signature.
- **Decoded Fields**:
  - Transactions: Base58 signatures, account keys, instructions (program IDs, account indices, payload), log messages, compute units, fees, error status.
  - Accounts: Base58 pubkeys, owner program, lamports balance, executable flag, rent epoch, raw payload, write version.
- **Graceful Lifecycle**:
  - Handles `SIGINT` (Ctrl+C) and `SIGTERM` cleanly closing streams and flushing database writes.
  - Periodic background indexing stats reporter.
- **Cross-Platform**: Tested and optimized for Windows, Linux, and macOS.

---

## Project Structure

```
helius-indexer/
├── src/
│   ├── index.ts          # Main application entry point & lifecycle manager
│   ├── laserstream.ts    # LaserStream gRPC subscription & protobuf decoding
│   ├── db.ts             # SQLite database layer (WAL mode, schema, queries)
│   └── types.ts          # TypeScript interfaces & configuration types
├── scripts/
│   └── patch-laserstream.js # Fallback loader for environments without precompiled binaries
├── test/
│   └── db.test.ts        # Database integration and persistence tests
├── .env.example          # Environment variable template
├── tsconfig.json         # TypeScript configuration
└── package.json          # Project scripts and dependencies
```

---

## Getting Started

### 1. Prerequisites

- **Node.js**: Version 20.0.0 or higher (Node 22 recommended)
- **Helius API Key**: Sign up at [dashboard.helius.dev](https://dashboard.helius.dev) to get an API key with LaserStream gRPC access.

### 2. Installation

Clone this repository and install dependencies:

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and set your Helius API key and optional program filter:

```env
# Required: Your Helius API Key
HELIUS_API_KEY=your_actual_api_key_here

# Optional: Endpoint (defaults to Devnet)
HELIUS_ENDPOINT=https://laserstream-devnet-ewr.helius-rpc.com

# Optional: Target Program ID to stream transactions & accounts for
# Default placeholder: Devnet SPL Memo Program
PROGRAM_ID=MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr

# Optional: Commitment level (CONFIRMED | PROCESSED | FINALIZED)
COMMITMENT=CONFIRMED

# Optional: SQLite Database file path
DATABASE_PATH=./indexer.db

# Optional: Historical replay upon reconnection (resumes from last indexed slot)
REPLAY=true

# Optional: Stream every intra-slot state update
INTRA_SLOT_UPDATES=false
```

---

## Running the Indexer

### Development Mode (with hot reloading via `tsx watch`)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Building to JavaScript

```bash
npm run build
node dist/index.js
```

---

## Inspecting Indexed Data

Useful utility scripts are included in `package.json`:

```bash
# View real-time database counts and highest indexed slot
npm run stats

# Query the 5 most recent indexed transactions
npm run query:txs

# Query the 5 most recent indexed account state updates
npm run query:accounts

# Run database persistence tests
npm test
```

You can also inspect the SQLite database using standard tools (`sqlite3`, DBeaver, TablePlus, or VS Code SQLite extensions):

```bash
sqlite3 indexer.db "SELECT signature, slot, fee, created_at FROM transactions LIMIT 5;"
```

---

## Database Schema

### `transactions` Table
Stores parsed transactions matching `accountInclude: [PROGRAM_ID]`:

| Column | Type | Description |
|---|---|---|
| `signature` | TEXT PRIMARY KEY | Base58 Solana transaction signature |
| `slot` | INTEGER | Solana slot number (Indexed) |
| `block_time` | INTEGER | Block timestamp (if available) |
| `err` | TEXT | Execution error JSON (null on success) |
| `fee` | INTEGER | Transaction fee paid in lamports |
| `compute_units_consumed` | INTEGER | Compute units consumed |
| `recent_blockhash` | TEXT | Recent blockhash used by the transaction |
| `accounts` | TEXT (JSON) | Array of Base58 account public keys involved |
| `instructions` | TEXT (JSON) | Array of instructions with resolved program IDs and base64 data |
| `log_messages` | TEXT (JSON) | Array of runtime log messages |
| `created_at` | TEXT | ISO timestamp when indexed (Indexed) |

### `accounts` Table
Stores account states matching `owner: [PROGRAM_ID]`:

| Column | Type | Description |
|---|---|---|
| `pubkey` | TEXT | Base58 account public key (Indexed) |
| `slot` | INTEGER | Slot number when updated (Indexed) |
| `owner` | TEXT | Base58 owner Program ID (Indexed) |
| `lamports` | INTEGER | Account balance in lamports |
| `executable` | INTEGER | Boolean flag (1 if executable, 0 otherwise) |
| `rent_epoch` | INTEGER | Solana rent epoch |
| `data_len` | INTEGER | Byte length of the account data |
| `data_base64` | TEXT | Base64-encoded account data |
| `write_version` | INTEGER | Geyser write version sequence number |
| `txn_signature` | TEXT | Associated transaction signature (if available) |
| `updated_at` | TEXT | ISO timestamp when indexed |

*Primary Key*: `(pubkey, slot, write_version)`

### `indexer_metadata` Table
Maintains indexer state such as `latest_slot` and `last_update_at` for seamless historical replay upon process restart or reconnection.

---

## Example Filter Configurations

The indexer filter in `src/laserstream.ts` uses Helius LaserStream's subscription format:

```typescript
{
  transactions: {
    "program-txs": {
      accountInclude: [PROGRAM_ID],
      vote: false,
      failed: false
    }
  },
  accounts: {
    "program-accounts": {
      owner: [PROGRAM_ID]
    }
  },
  commitment: CommitmentLevel.CONFIRMED,
  fromSlot: 284192000 // Automatically supplied when resuming for replay
}
```

---

## Reconnection & Replay Resiliency

When `REPLAY=true` (the default):
1. The indexer continuously records the latest slot observed across transactions, accounts, and slots in `indexer_metadata`.
2. If the connection drops (e.g. temporary network blip or server restart), the client reconnects with exponential backoff.
3. Upon reconnection, `fromSlot` is set to the last recorded slot, instructing Helius LaserStream to replay all transactions and account updates that occurred during the disconnection period.
4. Duplicate updates are safely handled using SQLite's `ON CONFLICT` clauses.

---

## License

MIT
