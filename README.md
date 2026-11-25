# Solana Microscope Local & Helius LaserStream Indexer

A self-hosted, single-process local alternative to [Solana Microscope](https://github.com/solana-foundation/solana-microscope) built in TypeScript on top of **Helius LaserStream gRPC** (Yellowstone Geyser protocol), with automatic **JSON-RPC failover**, **multi-program & multisig monitoring**, **Anchor IDL decoding**, **SQLite WAL persistence**, and **Prometheus + Grafana** observability.

---

## Why Use This?

The official [solana-foundation/solana-microscope](https://github.com/solana-foundation/solana-microscope) runs a multi-container Rust + Carbon + Yellowstone + Prometheus + Loki + Grafana stack. This project brings core program observability into a **single Node.js process** with zero mandatory container overhead—working out of the box on **Windows, macOS, and Linux**—while optionally plugging straight into Prometheus & Grafana when you want time-series charts.

| Feature | Official Multi-Container Stack | Solana Microscope Local |
|---|---|---|
| **gRPC Ingestion** | Yellowstone gRPC (Rust) | Helius LaserStream gRPC (Yellowstone over HTTP/2) |
| **Failover** | RPC fallback polling | Automatic Yellowstone gRPC ↔ JSON-RPC failover & failback |
| **Multi-Target** | Programs & Squads multisigs | Multiple `PROGRAM_IDS` + `MULTISIG_ADDRESSES` per instance |
| **Instruction Decoding** | Carbon Rust IDL decoder | Anchor Borsh Decoder (`@coral-xyz/anchor`) + live browser IDL upload |
| **Event Parsing** | Inner event extraction | Anchor `emit!` log decoder (`Program data: <base64>`) |
| **Governance Tracking** | Squads & BPF upgrades | `BPFLoaderUpgradeab1e` & Squads v3/v4 + custom multisig watcher |
| **Dashboard UI** | Grafana | Built-in dark-mode SSE console (`http://localhost:3000`) + optional Grafana |
| **Metrics Exporter** | Prometheus | Built-in `/metrics` endpoint + pre-built `docker-compose.yml` for Grafana |
| **Storage** | Loki + PostgreSQL | Built-in `node:sqlite` (WAL mode) with auto-migration |

---

## Core Capabilities

1. **Multi-Program & Multisig Monitoring**:
   - Monitor one program (`PROGRAM_ID`), multiple comma-separated programs (`PROGRAM_IDS`), and Squads/multisig PDA addresses (`MULTISIG_ADDRESSES`) simultaneously in one instance.
2. **Yellowstone gRPC + JSON-RPC Failover**:
   - Streams real-time slots, transactions, and account updates via Helius LaserStream gRPC.
   - If the gRPC stream disconnects or hits an error, `RpcFailoverPoller` automatically activates JSON-RPC polling (`getSignaturesForAddress` + `getTransaction`) and automatically fails back when LaserStream recovers.
3. **Anchor IDL Dynamic Decoding**:
   - Decodes raw instruction bytes into named Anchor instructions and structured JSON args.
   - Parses `Program data: <base64>` logs into decoded Anchor events.
   - Load via `IDL_PATH=./idl.json` on startup or upload/paste JSON directly in the web UI.
4. **Interactive Web Console (`http://localhost:3000`)**:
   - Real-time Server-Sent Events (SSE) feed with **Search**, **Target Program Filter**, **Success/Failed/Decoded** pills, **Pause/Resume**, and **Expandable Payload Inspector**.
   - Live slot ticker, active data source badge (`LaserStream gRPC` vs `RPC Failover Polling`), and historical SQLite metric hydration.
5. **Prometheus & Grafana Live Visualisations**:
   - `/metrics` exposes `solana_microscope_tx_total`, `solana_microscope_tps`, `solana_microscope_cu_avg`, `solana_microscope_cu_max`, `solana_microscope_fee_lamports_total`, `solana_microscope_governance_events_total`, and `solana_microscope_instruction_count`.
   - Ready-to-run `docker-compose.yml` + pre-provisioned Grafana dashboard at `http://localhost:3001`.
6. **Replay Resiliency & Cross-Platform Support**:
   - Stores `latest_slot` in SQLite (`WAL` mode) and clamps stale checkpoints via `subscribeReplayInfo()` to avoid `OUT_OF_RANGE` loops.
   - `scripts/patch-laserstream.js` (`postinstall`) auto-enables pure-JS `@grpc/grpc-js` fallback on platforms without native binaries (such as Windows).

---

## Project Structure

```
helius-indexer/
├── src/
│   ├── index.ts                      # Entry point, config parser & service coordinator
│   ├── laserstream.ts                # LaserStream gRPC subscription & decoding pipeline
│   ├── rpcFailover.ts                # Automatic JSON-RPC failover poller & normalizer
│   ├── db.ts                         # SQLite WAL storage engine & auto-migrations
│   ├── types.ts                      # TypeScript interfaces
│   └── microscope/
│       ├── idlDecoder.ts             # Anchor Borsh instruction & event decoder
│       ├── governance.ts             # BPF Upgradeable & Squads/multisig tracker
│       ├── metrics.ts                # Windowed TPS, CU metrics & Prometheus formatter
│       ├── dashboardHtml.ts          # Embedded dark-mode SPA console
│       └── server.ts                 # Node HTTP server (SSE, REST APIs, /metrics)
├── monitoring/
│   ├── prometheus.yml                # Prometheus scrape config
│   └── grafana/                      # Auto-provisioned datasource & dashboard JSON
├── test/
│   ├── db.test.ts                    # SQLite persistence & WAL tests
│   └── microscope.test.ts            # IDL, Governance, Metrics, Server & Failover tests
├── scripts/
│   └── patch-laserstream.js          # Cross-platform gRPC fallback patcher
├── docker-compose.yml                # Optional Prometheus + Grafana stack
├── .env.example                      # Environment variables template
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

---

## Getting Started

### 1. Prerequisites

- **Node.js >= 22.5.0** (required for built-in `node:sqlite`)
- **Helius API Key** from [dashboard.helius.dev](https://dashboard.helius.dev)
- **Docker** *(optional, only needed if you want Grafana + Prometheus)*

### 2. Installation

```bash
git clone https://github.com/<your-username>/helius-indexer.git
cd helius-indexer
npm install
```

### 3. Configuration

```bash
cp .env.example .env
```

Edit `.env` and set your `HELIUS_API_KEY`, `NETWORK` (`devnet` or `mainnet`), and target programs/multisigs:

```env
HELIUS_API_KEY=your_helius_api_key_here
NETWORK=devnet

# Single program or multiple comma-separated programs:
PROGRAM_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
# PROGRAM_IDS=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA,ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL

# Optional Squads / Multisig PDA addresses:
# MULTISIG_ADDRESSES=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf

# Automatic RPC failover when LaserStream disconnects:
RPC_FAILOVER_ENABLED=true
RPC_POLL_INTERVAL_MS=3000
```

### 4. Run Microscope Local

```bash
npm start
```

Open:
- **Web Dashboard:** `http://localhost:3000`
- **Prometheus Metrics:** `http://localhost:3000/metrics`
- **Server & Target Info:** `http://localhost:3000/api/info`

### 5. Optional: Live Grafana + Prometheus Visualisations

With `npm start` running, start Prometheus & Grafana in another terminal:

```bash
docker compose up -d
```

- **Grafana:** `http://localhost:3001` (login: `admin` / `admin`) → **Dashboards → Solana Microscope Local**
- **Prometheus:** `http://localhost:9090`

---

## Running Tests

```bash
npm run test:all
```

Or individually:

```bash
npm run build
npm test
npm run test:microscope
```

---

## Contributing & Security

- See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.
- See [SECURITY.md](SECURITY.md) for secret hygiene and vulnerability reporting.

## License

[MIT](LICENSE)
