import http from 'http';
import { MicroscopeIdlDecoder } from './idlDecoder';
import { MicroscopeGovernanceTracker } from './governance';
import { MicroscopeMetrics } from './metrics';
import { DatabaseManager } from '../db';
import { getDashboardHtml } from './dashboardHtml';
import { ParsedTransaction, GovernanceEvent } from '../types';

export class MicroscopeServer {
  private server: http.Server | null = null;
  private sseClients = new Set<http.ServerResponse>();
  private idlDecoder: MicroscopeIdlDecoder;
  private governance: MicroscopeGovernanceTracker;
  private metrics: MicroscopeMetrics;
  private db: DatabaseManager;
  private programIds: string[];
  private multisigAddresses: string[];
  private endpoint: string;
  private network: 'mainnet' | 'devnet';
  private port: number;
  private dataSource: 'laserstream' | 'rpc_failover' = 'laserstream';
  private failoverReason: string | null = null;

  constructor(
    idlDecoder: MicroscopeIdlDecoder,
    governance: MicroscopeGovernanceTracker,
    metrics: MicroscopeMetrics,
    db: DatabaseManager,
    programIdsInput: string | string[],
    endpoint: string,
    network: 'mainnet' | 'devnet' = 'devnet',
    port: number = 3000,
    multisigAddresses: string[] = []
  ) {
    this.idlDecoder = idlDecoder;
    this.governance = governance;
    this.metrics = metrics;
    this.db = db;
    this.programIds = Array.isArray(programIdsInput) ? programIdsInput : [programIdsInput];
    this.multisigAddresses = multisigAddresses;
    this.endpoint = endpoint;
    this.network = network;
    this.port = port;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, () => {
        console.log(`[Microscope Local] Web Dashboard: http://localhost:${this.port}`);
        console.log(`[Microscope Local] Prometheus metrics: http://localhost:${this.port}/metrics`);
        resolve();
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Enable CORS for dashboard integrations
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Root: Serves Microscope Local Dashboard UI
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml(this.programIds, this.endpoint, this.network, this.multisigAddresses));
      return;
    }

    // 2. Real-time Server-Sent Events (SSE) Stream
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': keepalive\n\n');

      this.sseClients.add(res);

      // Send initial metrics snapshot
      res.write(`data: ${JSON.stringify({ type: 'METRICS', data: this.metrics.getSummary() })}\n\n`);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 3. Prometheus /metrics Endpoint
    if (url.pathname === '/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(this.metrics.toPrometheus());
      return;
    }

    // 4. API: Get Current Metrics (JSON)
    if (url.pathname === '/api/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.metrics.getSummary()));
      return;
    }

    // 4b. API: Get Server, Monitored Targets, Failover Status & IDL Info
    if (url.pathname === '/api/info' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          network: this.network,
          programId: this.programIds[0] || '',
          programIds: this.programIds,
          multisigAddresses: this.multisigAddresses,
          endpoint: this.endpoint,
          dataSource: this.dataSource,
          failoverReason: this.failoverReason,
          idl: this.idlDecoder.idl ? this.idlDecoder.getSummary() : null,
        })
      );
      return;
    }

    // 5. API: Get Recent Governance Events
    if (url.pathname === '/api/governance' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.governance.getRecentEvents()));
      return;
    }

    // 6. API: Get Recent Transactions from SQLite
    if (url.pathname === '/api/transactions' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const txs = this.db.getRecentTransactions(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(txs));
      return;
    }

    // 7. API: Load Anchor IDL JSON dynamically
    if (url.pathname === '/api/idl' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const ok = this.idlDecoder.loadIdl(parsed);
          if (ok) {
            const summary = this.idlDecoder.getSummary();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, ...summary }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Failed to parse Anchor IDL structure' }));
          }
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  /**
   * Updates the active data source ('laserstream' | 'rpc_failover') and notifies connected browsers.
   */
  public setDataSource(source: 'laserstream' | 'rpc_failover', reason?: string) {
    this.dataSource = source;
    this.failoverReason = reason || null;
    if (this.sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify({ type: 'SOURCE_STATUS', data: { dataSource: source, failoverReason: this.failoverReason } })}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(msg);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  /**
   * Broadcasts a live slot progression to all open browser sessions.
   */
  public broadcastSlot(slot: number) {
    if (this.sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify({ type: 'SLOT', data: { slot } })}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(msg);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  /**
   * Broadcasts a live confirmed transaction to all open browser dashboard sessions.
   */
  public broadcastTransaction(tx: ParsedTransaction) {
    if (this.sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify({ type: 'TRANSACTION', data: tx })}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(msg);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  /**
   * Broadcasts a governance or program upgrade event.
   */
  public broadcastGovernance(event: GovernanceEvent) {
    if (this.sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify({ type: 'GOVERNANCE', data: event })}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(msg);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  public stop() {
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {}
    }
    this.sseClients.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
