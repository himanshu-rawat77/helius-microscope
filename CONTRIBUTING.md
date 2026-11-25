# Contributing to Solana Microscope Local

Thank you for your interest in contributing! This project aims to make Solana program observability and Helius LaserStream gRPC indexing effortless on any local machine.

## Prerequisites

- **Node.js >= 22.5.0** (required for built-in `node:sqlite`)
- **npm**
- A **Helius API Key** (free tier works for Devnet) if running live streams

## Local Development Setup

```bash
git clone https://github.com/<your-username>/helius-indexer.git
cd helius-indexer
npm install
cp .env.example .env
```

## Running Build & Tests

Before opening a Pull Request, please ensure TypeScript compiles cleanly and all unit tests pass:

```bash
npm run build
npm test
npm run test:microscope
```

## Pull Request Guidelines

1. Keep PRs focused and scoped to a single feature or bugfix.
2. Add or update unit tests in `test/` when modifying database, decoder, governance, server, or failover behavior.
3. Never commit `.env`, API keys, or local `*.db` SQLite files.
4. Update `README.md` and `.env.example` if you introduce new configuration options.
