import { MicroscopeIdlDecoder } from '../src/microscope/idlDecoder';
import { MicroscopeGovernanceTracker, BPF_LOADER_UPGRADEABLE_ID } from '../src/microscope/governance';
import { MicroscopeMetrics } from '../src/microscope/metrics';
import { MicroscopeServer } from '../src/microscope/server';
import { buildSubscribeRequest } from '../src/laserstream';
import { resolveHeliusRpcEndpoint } from '../src/rpcFailover';
import { CommitmentLevel } from 'helius-laserstream';
import { DatabaseManager } from '../src/db';
import { ParsedTransaction } from '../src/types';
import fs from 'fs';

async function runMicroscopeTests() {
  console.log('[Test] Running Solana Microscope Local Unit Tests...');

  // 1. Test IDL Decoder
  const idlDecoder = new MicroscopeIdlDecoder();
  const sampleIdl = {
    version: '0.1.0',
    name: 'vault_protocol',
    instructions: [
      {
        name: 'initialize',
        accounts: [],
        args: [{ name: 'feeBasisPoints', type: 'u16' }],
      },
      {
        name: 'deposit',
        accounts: [],
        args: [{ name: 'amount', type: 'u64' }],
      },
    ],
    events: [
      {
        name: 'DepositEvent',
        fields: [
          { name: 'user', type: 'publicKey', index: false },
          { name: 'amount', type: 'u64', index: false },
        ],
      },
    ],
  };

  const loaded = idlDecoder.loadIdl(sampleIdl as any);
  if (!loaded) throw new Error('Failed to load sample IDL');
  console.log('[Test] ✓ IDL Decoder initialized successfully');

  // 2. Test Governance Tracker
  const govTracker = new MicroscopeGovernanceTracker();
  const dummyUpgradeTx: ParsedTransaction = {
    signature: 'UpgradeTxSignatureSample111111111111111111111111111111111111111111111111111111111111',
    slot: 284192500,
    blockTime: Math.floor(Date.now() / 1000),
    err: null,
    fee: 5000,
    computeUnitsConsumed: 85000,
    recentBlockhash: 'EkSnNWid2cvwEVnPx9aZaWBppFed381PhKTbMsBaNVNP',
    accounts: [
      BPF_LOADER_UPGRADEABLE_ID,
      'TargetProgram111111111111111111111111111111',
      'AuthorityWallet111111111111111111111111111111',
    ],
    instructions: [],
    logMessages: [
      `Program ${BPF_LOADER_UPGRADEABLE_ID} invoke [1]`,
      'Program log: Instruction: Upgrade',
      'Program success',
    ],
    createdAt: new Date().toISOString(),
  };

  const govEvent = govTracker.analyzeTransaction(dummyUpgradeTx, 'TargetProgram111111111111111111111111111111');
  if (!govEvent || govEvent.type !== 'PROGRAM_UPGRADE') {
    throw new Error('Failed to detect BPF program upgrade!');
  }
  console.log('[Test] ✓ BPF Program Upgrade successfully detected:', govEvent.type);

  // 3. Test Metrics Aggregator & Prometheus Exporter
  const metrics = new MicroscopeMetrics();
  metrics.recordTransaction(dummyUpgradeTx, ['upgrade']);
  metrics.recordGovernanceEvent();

  const summary = metrics.getSummary();
  if (summary.totalTransactions !== 1 || summary.avgComputeUnits !== 85000 || summary.governanceEventsCount !== 1) {
    throw new Error(`Metrics mismatch: ${JSON.stringify(summary)}`);
  }

  const prom = metrics.toPrometheus();
  if (!prom.includes('solana_microscope_tx_total 1') || !prom.includes('solana_microscope_governance_events_total 1')) {
    throw new Error('Prometheus serialization failure');
  }
  console.log('[Test] ✓ Metrics & Prometheus formatting verified');

  // 4. Test Embedded Web Server
  const testDb = new DatabaseManager('./test-microscope-server.db');
  testDb.init();

  const server = new MicroscopeServer(
    idlDecoder,
    govTracker,
    metrics,
    testDb,
    'TargetProgram111111111111111111111111111111',
    'https://laserstream-devnet-ewr.helius-rpc.com',
    'devnet',
    3456
  );

  await server.start();
  console.log('[Test] ✓ Microscope Local HTTP server started on port 3456');

  // Verify HTTP endpoints
  const rootRes = await fetch('http://localhost:3456/');
  if (rootRes.status !== 200) throw new Error(`Root status: ${rootRes.status}`);
  const html = await rootRes.text();
  if (!html.includes('Solana Microscope')) throw new Error('Dashboard HTML missing title');

  const metricsRes = await fetch('http://localhost:3456/metrics');
  const metricsText = await metricsRes.text();
  if (!metricsText.includes('solana_microscope_tx_total')) throw new Error('Prometheus endpoint failed');

  const jsonMetricsRes = await fetch('http://localhost:3456/api/metrics');
  const jsonMetrics = await jsonMetricsRes.json();
  if (jsonMetrics.totalTransactions !== 1) throw new Error('JSON metrics endpoint failed');

  // 5. Test Multi-Program + Multisig Subscription & /api/info + Failover Status
  const multiReq = buildSubscribeRequest(
    ['ProgA11111111111111111111111111111111111111', 'ProgB11111111111111111111111111111111111111'],
    CommitmentLevel.CONFIRMED,
    null,
    ['Multisig11111111111111111111111111111111111']
  );
  const included = multiReq.transactions?.['program-txs']?.accountInclude || [];
  if (included.length !== 3) {
    throw new Error(`Expected 3 watched addresses in accountInclude, got ${included.length}`);
  }
  console.log('[Test] ✓ Multi-program + multisig SubscribeRequest verified');

  const multiGov = govTracker.analyzeTransaction(
    {
      ...dummyUpgradeTx,
      signature: 'MultisigTx111111111111111111111111111111111111111111111111111111111111111111111',
      accounts: ['Multisig11111111111111111111111111111111111'],
      logMessages: ['Program log: Execute proposal'],
    },
    ['ProgA11111111111111111111111111111111111111'],
    ['Multisig11111111111111111111111111111111111']
  );
  if (!multiGov || multiGov.type !== 'MULTISIG_EXECUTE') {
    throw new Error('Failed to detect monitored multisig execution');
  }
  console.log('[Test] ✓ Monitored multisig execution detected');

  server.setDataSource('rpc_failover', 'Simulated gRPC disconnect');
  const infoRes = await fetch('http://localhost:3456/api/info');
  const infoJson = await infoRes.json();
  if (infoJson.dataSource !== 'rpc_failover') {
    throw new Error(`Expected rpc_failover dataSource, got ${infoJson.dataSource}`);
  }
  const derivedRpc = resolveHeliusRpcEndpoint({
    network: 'devnet',
    heliusApiKey: 'test-key',
    endpoint: '',
    programId: 'ProgA',
    commitment: CommitmentLevel.CONFIRMED,
    dbPath: './test.db',
    maxReconnectAttempts: 5,
    replay: true,
    intraSlotUpdates: false,
  });
  if (!derivedRpc.includes('devnet.helius-rpc.com')) {
    throw new Error(`Unexpected derived RPC endpoint: ${derivedRpc}`);
  }
  console.log('[Test] ✓ RPC failover status & endpoint resolution verified');

  server.stop();
  testDb.close();

  // Cleanup test DB
  if (fs.existsSync('./test-microscope-server.db')) fs.unlinkSync('./test-microscope-server.db');
  if (fs.existsSync('./test-microscope-server.db-wal')) fs.unlinkSync('./test-microscope-server.db-wal');
  if (fs.existsSync('./test-microscope-server.db-shm')) fs.unlinkSync('./test-microscope-server.db-shm');

  console.log('[Test] ✓ ALL MICROSCOPE TESTS PASSED CLEANLY!');
}

runMicroscopeTests().catch((err) => {
  console.error('[Test Error]:', err);
  process.exit(1);
});
