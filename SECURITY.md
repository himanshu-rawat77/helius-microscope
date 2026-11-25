# Security Policy

## Secret & API Key Hygiene

- **Never commit `.env`** or hardcode `HELIUS_API_KEY` / RPC URLs containing keys in source files, tests, or screenshots.
- Always use `.env.example` with placeholder values for documentation.
- Local SQLite databases (`*.db`, `*.db-wal`, `*.db-shm`) are gitignored by default.

## Reporting a Vulnerability

If you discover a security issue (for example, an XSS vector in the dashboard HTML, an unsafe file/IDL parser, or credential leakage):

1. **Do not** open a public GitHub issue with exploit details.
2. Report it privately via GitHub Security Advisories or contact the repository maintainer directly.
3. Include reproduction steps and affected file paths so we can patch it promptly.
