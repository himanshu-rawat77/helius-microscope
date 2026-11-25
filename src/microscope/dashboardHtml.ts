export function getDashboardHtml(
  programIdsInput: string | string[],
  endpoint: string,
  network: 'mainnet' | 'devnet' = 'devnet',
  multisigAddresses: string[] = []
): string {
  const programIds = Array.isArray(programIdsInput) ? programIdsInput : [programIdsInput];
  const programId = programIds[0] || '';
  const isMainnet = network === 'mainnet';
  const networkName = isMainnet ? 'Solana Mainnet-Beta' : 'Solana Devnet';
  const networkColor = isMainnet ? 'text-cyan-400' : 'text-emerald-400';
  const networkDot = isMainnet ? 'bg-cyan-400' : 'bg-emerald-400';
  const clusterSuffix = isMainnet ? '' : '?cluster=devnet';

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solana Microscope Local - Program Telemetry & Observability</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#f0fdf4',
              500: '#10b981',
              600: '#059669',
              900: '#064e3b'
            }
          }
        }
      }
    }
  </script>
  <style>
    body { background-color: #090a0f; color: #f3f4f6; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .live-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #11131a; }
    ::-webkit-scrollbar-thumb { background: #232838; border-radius: 3px; }
  </style>
</head>
<body class="min-h-screen flex flex-col">

  <!-- Top Navigation Bar -->
  <header class="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-50 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center space-x-3">
      <div class="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-lg">
        🔬
      </div>
      <div>
        <div class="flex items-center space-x-2">
          <span class="font-bold text-lg tracking-tight text-white">Solana Microscope</span>
          <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium">Local</span>
        </div>
        <p class="text-xs text-zinc-400">Zero-overhead program observability & Anchor IDL telemetry</p>
      </div>
    </div>

    <!-- Target Info Badges -->
    <div class="flex flex-wrap items-center gap-2.5 text-xs">
      <div class="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 mono">
        <span class="h-2 w-2 rounded-full bg-emerald-400 live-pulse"></span>
        <span class="text-zinc-400">Slot:</span>
        <span class="font-semibold text-white" id="liveSlotDisplay">--</span>
      </div>

      <div class="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800">
        <span class="h-2 w-2 rounded-full ${networkDot} live-pulse"></span>
        <span class="text-zinc-400">Network:</span>
        <span class="font-medium ${networkColor}">${networkName}</span>
      </div>

      <div class="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 mono">
        <span class="text-zinc-400">Watching:</span>
        <span class="text-indigo-400 font-semibold">${programIds.length} Program${programIds.length > 1 ? 's' : ''}</span>
        ${multisigAddresses.length > 0 ? `<span class="text-zinc-600">•</span><span class="text-purple-400 font-semibold">${multisigAddresses.length} Multisig${multisigAddresses.length > 1 ? 's' : ''}</span>` : ''}
      </div>

      <div id="dataSourceBadge" class="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
        <span class="h-2 w-2 rounded-full bg-emerald-400 live-pulse" id="dataSourceDot"></span>
        <span id="dataSourceText">LaserStream gRPC</span>
      </div>

      <a href="/metrics" target="_blank" class="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition">
        /metrics (Prometheus)
      </a>
    </div>
  </header>

  <!-- Main Container -->
  <main class="flex-1 p-6 max-w-7xl w-full mx-auto space-y-5">

    <!-- KPI Metric Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-400 font-medium">Total Transactions</span>
          <span id="metricSessionBadge" class="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">+0 live</span>
        </div>
        <div class="text-2xl font-bold text-white mt-1 flex items-baseline space-x-2">
          <span id="metricTotalTx">0</span>
          <span class="text-xs text-emerald-400 font-mono" id="metricTps">0.00 TPS</span>
        </div>
        <div class="text-[11px] text-zinc-500 mt-1" id="metricTxSub">Stored in SQLite + live stream</div>
      </div>

      <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-400 font-medium">Success Rate</span>
          <span id="metricTotalFees" class="text-[11px] text-amber-400/90 font-mono">0.0000 SOL fees</span>
        </div>
        <div class="text-2xl font-bold text-white mt-1 flex items-baseline space-x-2">
          <span id="metricSuccessRate">100%</span>
          <span class="text-xs text-rose-400 font-mono" id="metricFailedTx">0 failed</span>
        </div>
        <div class="text-[11px] text-zinc-500 mt-1">On-chain execution & total fees</div>
      </div>

      <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-400 font-medium">Avg Compute Units</span>
          <span id="metricLastTx" class="text-[11px] text-zinc-500 font-mono">Last tx: --</span>
        </div>
        <div class="text-2xl font-bold text-white mt-1 flex items-baseline space-x-2">
          <span id="metricAvgCu">0 CU</span>
          <span class="text-xs text-zinc-400 font-mono" id="metricMaxCu">Max: 0</span>
        </div>
        <div class="text-[11px] text-zinc-500 mt-1">CU consumption per transaction</div>
      </div>

      <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-400 font-medium">Governance & Accounts</span>
          <span id="metricAccountsCount" class="text-[11px] text-indigo-400 font-mono">0 accounts</span>
        </div>
        <div class="text-2xl font-bold text-white mt-1 flex items-baseline space-x-2">
          <span id="metricGovCount">0</span>
          <span class="text-xs text-zinc-400">Events</span>
        </div>
        <div class="text-[11px] text-zinc-500 mt-1">BPF Upgrades & Squads Multisig</div>
      </div>
    </div>

    <!-- Monitored Programs & Multisigs Bar -->
    <div class="px-4 py-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800 flex flex-wrap items-center gap-2 text-xs">
      <span class="text-zinc-400 font-medium mr-1">Monitored Targets:</span>
      ${programIds
        .map(
          (p) =>
            `<a href="https://explorer.solana.com/address/${p}${clusterSuffix}" target="_blank" title="${p}" class="mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:border-indigo-400 transition">Prog: ${p.slice(0, 6)}...${p.slice(-4)}</a>`
        )
        .join('')}
      ${multisigAddresses
        .map(
          (m) =>
            `<a href="https://explorer.solana.com/address/${m}${clusterSuffix}" target="_blank" title="${m}" class="mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:border-purple-400 transition">Multisig: ${m.slice(0, 6)}...${m.slice(-4)}</a>`
        )
        .join('')}
    </div>

    <!-- Stream Diagnostic Banner -->
    <div id="diagnosticBanner" class="px-4 py-3 rounded-xl bg-amber-950/20 border border-amber-800/40 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2">
      <div class="flex items-start md:items-center space-x-2.5">
        <span class="text-amber-400 text-sm">ℹ️</span>
        <div class="text-zinc-300" id="diagnosticText">
          Checking live stream activity for <span class="mono text-amber-300">${programId.slice(0, 8)}...</span> on <span class="font-semibold">${networkName}</span>...
        </div>
      </div>
      <div class="text-[11px] text-zinc-400 mono shrink-0" id="endpointBadge">
        ${endpoint.replace('https://', '')}
      </div>
    </div>

    <!-- Anchor IDL Status & Upload Section -->
    <div class="p-4 rounded-xl bg-gradient-to-r from-zinc-900 via-zinc-900 to-indigo-950/30 border border-zinc-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex items-center space-x-3">
        <div class="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
          📜
        </div>
        <div>
          <div class="flex items-center space-x-2">
            <span class="font-semibold text-sm text-white">Anchor IDL Status:</span>
            <span id="idlStatusBadge" class="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">No IDL Loaded (Raw Mode)</span>
          </div>
          <p class="text-xs text-zinc-400 mt-0.5" id="idlDescription">Load an Anchor IDL JSON to decode raw instructions into named parameters and events.</p>
        </div>
      </div>

      <div class="flex items-center space-x-2 w-full md:w-auto">
        <input type="file" id="idlFileInput" accept=".json" class="hidden" onchange="uploadIdlFile(event)">
        <button onclick="document.getElementById('idlFileInput').click()" class="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shadow-sm">
          Upload IDL JSON
        </button>
        <button onclick="promptPasteIdl()" class="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg border border-zinc-700 transition">
          Paste IDL
        </button>
      </div>
    </div>

    <!-- Tabbed Content Section -->
    <div class="space-y-4">
      <!-- Tab Headers -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-2">
        <div class="flex items-center space-x-2">
          <button onclick="switchTab('feed')" id="tabBtnFeed" class="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 text-white transition">
            Transaction Feed (<span id="streamCount">0</span>)
          </button>
          <button onclick="switchTab('breakdown')" id="tabBtnBreakdown" class="px-3.5 py-1.5 text-xs font-medium rounded-lg text-zinc-400 hover:text-white transition">
            Instruction Telemetry
          </button>
          <button onclick="switchTab('governance')" id="tabBtnGovernance" class="px-3.5 py-1.5 text-xs font-medium rounded-lg text-zinc-400 hover:text-white transition">
            Governance & Upgrades
          </button>
        </div>

        <button onclick="togglePause()" id="pauseBtn" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition flex items-center space-x-1.5">
          <span id="pauseIcon">⏸</span>
          <span id="pauseLabel">Pause Feed</span>
        </button>
      </div>

      <!-- Tab 1: Live Activity Feed -->
      <div id="tabFeed" class="space-y-3">
        <!-- Search & Filter Bar -->
        <div class="flex flex-col md:flex-row gap-2.5 items-stretch md:items-center justify-between bg-zinc-900/40 p-3 rounded-xl border border-zinc-800/80">
          <input
            type="text"
            id="searchInput"
            oninput="renderActivityFeed()"
            placeholder="Filter by signature, slot, program ID, or instruction name..."
            class="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 mono"
          />
          <select id="programFilterSelect" onchange="renderActivityFeed()" class="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 mono focus:outline-none focus:border-indigo-500">
            <option value="">All Targets</option>
            ${programIds.map((p) => `<option value="${p}">Prog: ${p.slice(0, 8)}...${p.slice(-4)}</option>`).join('')}
            ${multisigAddresses.map((m) => `<option value="${m}">Multisig: ${m.slice(0, 8)}...${m.slice(-4)}</option>`).join('')}
          </select>
          <div class="flex items-center space-x-1.5 text-xs">
            <button onclick="setFilter('all')" id="filterAll" class="px-2.5 py-1 rounded-md bg-indigo-600 text-white font-medium">All</button>
            <button onclick="setFilter('success')" id="filterSuccess" class="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-400 hover:text-white">Success</button>
            <button onclick="setFilter('failed')" id="filterFailed" class="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-400 hover:text-white">Failed</button>
            <button onclick="setFilter('decoded')" id="filterDecoded" class="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-400 hover:text-white">Decoded</button>
          </div>
        </div>

        <div id="activityContainer" class="space-y-2.5">
          <div class="p-8 text-center text-zinc-500 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
            <span class="live-pulse inline-block text-lg mb-2">⚡</span>
            <p class="text-sm">Listening for transactions touching program on ${networkName}...</p>
            <p class="text-xs text-zinc-600 mt-1">Transactions streamed via Helius LaserStream gRPC will appear here live with decoded IDL payloads.</p>
          </div>
        </div>
      </div>

      <!-- Tab 2: Instruction Telemetry Breakdown -->
      <div id="tabBreakdown" class="hidden p-6 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
        <h3 class="text-sm font-semibold text-white">Instruction Invocations Breakdown</h3>
        <p class="text-xs text-zinc-400">Real-time distribution of instructions invoked on the watched program during this session.</p>
        <div id="instructionBars" class="space-y-3 pt-2">
          <div class="text-xs text-zinc-500">No instruction calls recorded yet in this session.</div>
        </div>
      </div>

      <!-- Tab 3: Governance Activity -->
      <div id="tabGovernance" class="hidden p-6 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
        <h3 class="text-sm font-semibold text-white">Governance & Program Upgrades</h3>
        <p class="text-xs text-zinc-400">Audit trail of BPF Loader program writes, upgrade authority changes, and Squads multisig actions.</p>
        <div id="governanceContainer" class="space-y-2.5 pt-2">
          <div class="text-xs text-zinc-500">No governance or upgrade events detected.</div>
        </div>
      </div>
    </div>

  </main>

  <!-- Status Bar Footer -->
  <footer class="border-t border-zinc-800 bg-zinc-950 px-6 py-2.5 text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center space-x-2">
      <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
      <span id="sseStatus">LaserStream SSE Connected</span>
    </div>
    <div class="mono text-[11px]">
      Helius LaserStream gRPC • Confirmed Commitment • Grafana-ready (/metrics)
    </div>
  </footer>

  <!-- Client-Side JavaScript -->
  <script>
    const WATCHED_PROGRAM_ID = ${JSON.stringify(programId)};
    const TARGET_NETWORK = ${JSON.stringify(networkName)};
    let activeTab = 'feed';
    let activeFilter = 'all';
    let isPaused = false;
    let pausedQueue = [];
    let activityItems = [];
    let expandedSigs = new Set();

    function switchTab(tab) {
      activeTab = tab;
      document.getElementById('tabFeed').classList.toggle('hidden', tab !== 'feed');
      document.getElementById('tabBreakdown').classList.toggle('hidden', tab !== 'breakdown');
      document.getElementById('tabGovernance').classList.toggle('hidden', tab !== 'governance');

      document.getElementById('tabBtnFeed').className = tab === 'feed' ? 'px-3.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 text-white transition' : 'px-3.5 py-1.5 text-xs font-medium rounded-lg text-zinc-400 hover:text-white transition';
      document.getElementById('tabBtnBreakdown').className = tab === 'breakdown' ? 'px-3.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 text-white transition' : 'px-3.5 py-1.5 text-xs font-medium rounded-lg text-zinc-400 hover:text-white transition';
      document.getElementById('tabBtnGovernance').className = tab === 'governance' ? 'px-3.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 text-white transition' : 'px-3.5 py-1.5 text-xs font-medium rounded-lg text-zinc-400 hover:text-white transition';
    }

    function setFilter(f) {
      activeFilter = f;
      ['all', 'success', 'failed', 'decoded'].forEach(key => {
        const el = document.getElementById('filter' + key.charAt(0).toUpperCase() + key.slice(1));
        el.className = key === f
          ? 'px-2.5 py-1 rounded-md bg-indigo-600 text-white font-medium'
          : 'px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-400 hover:text-white';
      });
      renderActivityFeed();
    }

    function togglePause() {
      isPaused = !isPaused;
      document.getElementById('pauseIcon').textContent = isPaused ? '▶' : '⏸';
      document.getElementById('pauseLabel').textContent = isPaused ? \`Resume (\${pausedQueue.length} queued)\` : 'Pause Feed';
      if (!isPaused && pausedQueue.length > 0) {
        while (pausedQueue.length > 0) {
          activityItems.unshift(pausedQueue.pop());
        }
        if (activityItems.length > 100) activityItems.length = 100;
        document.getElementById('streamCount').textContent = activityItems.length;
        renderActivityFeed();
      }
    }

    function toggleExpand(sig) {
      if (expandedSigs.has(sig)) expandedSigs.delete(sig);
      else expandedSigs.add(sig);
      renderActivityFeed();
    }

    function formatRelativeTime(iso) {
      if (!iso) return '--';
      const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
      if (diffSec < 60) return diffSec + 's ago';
      if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
      if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
      return Math.floor(diffSec / 86400) + 'd ago';
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Connect to Server-Sent Events (SSE) Stream
    function connectSse() {
      const eventSource = new EventSource('/api/stream');
      const statusEl = document.getElementById('sseStatus');

      eventSource.onopen = () => {
        statusEl.textContent = 'LaserStream SSE Connected (Live)';
        statusEl.className = 'text-emerald-400';
      };

      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TRANSACTION') {
            handleNewTransaction(msg.data);
          } else if (msg.type === 'GOVERNANCE') {
            handleGovernanceEvent(msg.data);
          } else if (msg.type === 'METRICS') {
            updateMetricsView(msg.data);
          } else if (msg.type === 'SLOT' && msg.data?.slot) {
            document.getElementById('liveSlotDisplay').textContent = Number(msg.data.slot).toLocaleString();
          } else if (msg.type === 'SOURCE_STATUS' && msg.data) {
            applyDataSourceStatus(msg.data.dataSource, msg.data.failoverReason);
          }
        } catch (e) {
          console.error('Failed to parse SSE payload', e);
        }
      };

      eventSource.onerror = () => {
        statusEl.textContent = 'Reconnecting to stream...';
        statusEl.className = 'text-amber-400';
      };
    }

    function handleNewTransaction(tx) {
      if (isPaused) {
        pausedQueue.unshift(tx);
        document.getElementById('pauseLabel').textContent = \`Resume (\${pausedQueue.length} queued)\`;
        return;
      }
      activityItems.unshift(tx);
      if (activityItems.length > 100) activityItems.pop();

      document.getElementById('streamCount').textContent = activityItems.length;
      renderActivityFeed();
    }

    function handleGovernanceEvent(gov) {
      const container = document.getElementById('governanceContainer');
      const el = document.createElement('div');
      el.className = 'p-3.5 rounded-lg bg-rose-950/20 border border-rose-800/40 text-xs flex items-start justify-between';
      el.innerHTML = \`
        <div>
          <span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 font-semibold text-[10px] mr-2">\${escapeHtml(gov.type)}</span>
          <span class="text-white font-medium">\${escapeHtml(gov.description)}</span>
          <div class="mono text-[11px] text-zinc-400 mt-1">Sig: <a href="https://explorer.solana.com/tx/\${gov.signature}${clusterSuffix}" target="_blank" class="text-indigo-400 hover:underline">\${gov.signature.slice(0, 16)}...</a> | Slot: \${gov.slot}</div>
        </div>
        <span class="text-[10px] text-zinc-500">\${new Date(gov.timestamp).toLocaleTimeString()}</span>
      \`;
      if (container.children[0] && container.children[0].textContent.includes('No governance')) {
        container.innerHTML = '';
      }
      container.prepend(el);
    }

    function renderActivityFeed() {
      const container = document.getElementById('activityContainer');
      const query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
      const targetFilter = (document.getElementById('programFilterSelect')?.value || '').trim();

      const filtered = activityItems.filter(tx => {
        const isSuccess = !tx.err;
        const decodedInsts = (tx.instructions || []).filter(i => i.decoded);
        if (activeFilter === 'success' && !isSuccess) return false;
        if (activeFilter === 'failed' && isSuccess) return false;
        if (activeFilter === 'decoded' && decodedInsts.length === 0) return false;
        if (targetFilter) {
          const allAddrs = [...(tx.accounts || []), ...(tx.instructions || []).map(i => i.programId)];
          if (!allAddrs.includes(targetFilter)) return false;
        }

        if (!query) return true;
        const progIds = (tx.instructions || []).map(i => i.programId || '').join(' ').toLowerCase();
        const instNames = decodedInsts.map(i => i.decoded?.name || '').join(' ').toLowerCase();
        return (
          (tx.signature || '').toLowerCase().includes(query) ||
          String(tx.slot || '').includes(query) ||
          progIds.includes(query) ||
          instNames.includes(query)
        );
      });

      if (filtered.length === 0) {
        container.innerHTML = \`
          <div class="p-8 text-center text-zinc-500 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
            <p class="text-sm">No transactions match the current filter.</p>
          </div>
        \`;
        return;
      }

      container.innerHTML = filtered.map(tx => {
        const isSuccess = !tx.err;
        const decodedInsts = (tx.instructions || []).filter(i => i.decoded);
        const decodedEvents = tx.decodedEvents || [];
        const cu = tx.computeUnitsConsumed || tx.compute_units_consumed || 0;
        const feeSol = ((tx.fee || 0) / 1e9).toFixed(6);
        const programs = [...new Set((tx.instructions || []).map(i => i.programId).filter(Boolean))];
        const isExpanded = expandedSigs.has(tx.signature);

        return \`
          <div class="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2 py-0.5 rounded font-mono text-[11px] font-semibold \${isSuccess ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
                  \${isSuccess ? 'SUCCESS' : 'FAILED'}
                </span>
                <span class="mono text-zinc-300">Slot \${Number(tx.slot).toLocaleString()}</span>
                <span class="text-zinc-600">•</span>
                <a href="https://explorer.solana.com/tx/\${tx.signature}${clusterSuffix}" target="_blank" class="mono text-indigo-400 hover:underline">
                  \${tx.signature.slice(0, 12)}...\${tx.signature.slice(-8)}
                </a>
                <span class="text-[11px] text-zinc-500">\${formatRelativeTime(tx.createdAt)}</span>
              </div>
              <div class="flex items-center space-x-2 text-[11px] text-zinc-400 mono">
                <span>\${feeSol} SOL</span>
                <span class="text-zinc-600">•</span>
                <span>\${cu ? cu.toLocaleString() + ' CU' : '0 CU'}</span>
                <button onclick="toggleExpand('\${tx.signature}')" class="ml-2 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-sans">
                  \${isExpanded ? 'Hide' : 'Inspect'}
                </button>
              </div>
            </div>

            <!-- Invoked Programs Pills -->
            <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="text-zinc-500">Programs:</span>
              \${programs.slice(0, 4).map(p => \`
                <span class="mono px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-300 border border-zinc-700/60" title="\${p}">\${p.slice(0, 6)}...\${p.slice(-4)}</span>
              \`).join('')}
              \${programs.length > 4 ? \`<span class="text-zinc-500">+\${programs.length - 4} more</span>\` : ''}
              <span class="text-zinc-600">•</span>
              <span class="text-zinc-400">\${(tx.accounts || []).length} accounts</span>
            </div>

            <!-- Decoded Anchor Instructions -->
            \${decodedInsts.length > 0 ? \`
              <div class="pt-1 space-y-1">
                \${decodedInsts.map(i => \`
                  <div class="px-2.5 py-1.5 rounded-lg bg-indigo-950/20 border border-indigo-800/30 text-xs">
                    <span class="text-indigo-400 font-semibold font-mono">\${escapeHtml(i.decoded.name)}</span>
                    <pre class="text-[11px] text-zinc-300 font-mono mt-1 overflow-x-auto">\${escapeHtml(JSON.stringify(i.decoded.args, null, 2))}</pre>
                  </div>
                \`).join('')}
              </div>
            \` : ''}

            <!-- Decoded Events -->
            \${decodedEvents.length > 0 ? \`
              <div class="pt-1 space-y-1">
                \${decodedEvents.map(e => \`
                  <div class="px-2.5 py-1.5 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-xs">
                    <span class="text-emerald-400 font-semibold font-mono">Event: \${escapeHtml(e.name)}</span>
                    <pre class="text-[11px] text-zinc-300 font-mono mt-0.5 overflow-x-auto">\${escapeHtml(JSON.stringify(e.data, null, 2))}</pre>
                  </div>
                \`).join('')}
              </div>
            \` : ''}

            <!-- Expandable Full Payload Inspector -->
            \${isExpanded ? \`
              <div class="mt-2 pt-2.5 border-t border-zinc-800 space-y-2.5 text-xs">
                \${tx.err ? \`
                  <div class="p-2 rounded bg-rose-950/30 border border-rose-800/40 mono text-[11px] text-rose-300">
                    Error: \${escapeHtml(typeof tx.err === 'string' ? tx.err : JSON.stringify(tx.err))}
                  </div>
                \` : ''}
                <div>
                  <div class="text-[11px] font-semibold text-zinc-400 mb-1">Instructions (\${(tx.instructions || []).length})</div>
                  <div class="space-y-1">
                    \${(tx.instructions || []).map((inst, idx) => \`
                      <div class="p-2 rounded bg-zinc-950 border border-zinc-800 mono text-[11px] text-zinc-300">
                        <span class="text-zinc-500">#\${idx + 1}</span> Program: <span class="text-indigo-400">\${inst.programId}</span>
                        <span class="text-zinc-500 ml-2">(\${(inst.accounts || []).length} accts)</span>
                        \${inst.data ? \`<div class="text-zinc-500 truncate mt-0.5">Data (b64): \${escapeHtml(inst.data)}</div>\` : ''}
                      </div>
                    \`).join('')}
                  </div>
                </div>
                \${(tx.logMessages || []).length > 0 ? \`
                  <div>
                    <div class="text-[11px] font-semibold text-zinc-400 mb-1">Program Logs (\${tx.logMessages.length})</div>
                    <pre class="p-2 rounded bg-zinc-950 border border-zinc-800 mono text-[11px] text-zinc-400 max-h-40 overflow-y-auto">\${escapeHtml(tx.logMessages.join('\\n'))}</pre>
                  </div>
                \` : ''}
              </div>
            \` : ''}
          </div>
        \`;
      }).join('');
    }

    function updateMetricsView(m) {
      document.getElementById('metricTotalTx').textContent = Number(m.totalTransactions || 0).toLocaleString();
      document.getElementById('metricTps').textContent = (m.tps || 0).toFixed(2) + ' TPS';
      document.getElementById('metricSuccessRate').textContent = (m.successRate ?? 100) + '%';
      document.getElementById('metricFailedTx').textContent = (m.totalFailed || 0) + ' failed';
      document.getElementById('metricAvgCu').textContent = Number(m.avgComputeUnits || 0).toLocaleString() + ' CU';
      document.getElementById('metricMaxCu').textContent = 'Max: ' + Number(m.maxComputeUnits || 0).toLocaleString();
      document.getElementById('metricGovCount').textContent = m.governanceEventsCount || 0;
      document.getElementById('metricAccountsCount').textContent = Number(m.accountsCount || 0).toLocaleString() + ' accounts';

      const totalSolFees = ((m.totalFeeLamports || 0) / 1e9).toFixed(4);
      document.getElementById('metricTotalFees').textContent = totalSolFees + ' SOL fees';
      document.getElementById('metricLastTx').textContent = 'Last tx: ' + formatRelativeTime(m.lastTxTimestamp);

      const sessionTx = m.sessionTransactions || 0;
      const badgeEl = document.getElementById('metricSessionBadge');
      badgeEl.textContent = '+' + sessionTx + ' live';
      badgeEl.className = sessionTx > 0
        ? 'text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono'
        : 'text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono';

      // Update diagnostic banner
      const diagBanner = document.getElementById('diagnosticBanner');
      const diagText = document.getElementById('diagnosticText');
      if (sessionTx > 0) {
        diagBanner.className = 'px-4 py-2.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2';
        diagText.innerHTML = \`Streaming live from <span class="font-semibold text-emerald-400">\${TARGET_NETWORK}</span> — <span class="mono text-white">\${sessionTx}</span> new transaction(s) indexed this session.\`;
      } else {
        diagBanner.className = 'px-4 py-3 rounded-xl bg-amber-950/20 border border-amber-800/40 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2';
        diagText.innerHTML = \`Showing <span class="font-semibold text-white">\${Number(m.totalTransactions || 0).toLocaleString()}</span> historical transactions from <span class="mono text-amber-300">indexer.db</span>. No new transactions observed yet in this session for <span class="mono text-amber-300">\${WATCHED_PROGRAM_ID.slice(0, 8)}...</span> on <span class="font-semibold">\${TARGET_NETWORK}</span> (low traffic on Devnet? Try <span class="mono text-zinc-200">NETWORK=mainnet</span> or <span class="mono text-zinc-200">TokenkegQfe...</span> in <span class="mono text-zinc-200">.env</span>).\`;
      }

      // Update Breakdown bars
      const breakdownEl = document.getElementById('instructionBars');
      const instEntries = Object.entries(m.instructionCounts || {});
      if (instEntries.length > 0) {
        const total = sessionTx || m.totalTransactions || 1;
        breakdownEl.innerHTML = instEntries.map(([name, count]) => {
          const pct = Math.min(100, ((count / total) * 100)).toFixed(1);
          return \`
            <div class="space-y-1">
              <div class="flex justify-between text-xs">
                <span class="font-mono text-zinc-300">\${escapeHtml(name)}</span>
                <span class="text-zinc-500">\${count} calls (\${pct}%)</span>
              </div>
              <div class="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div class="bg-indigo-500 h-full rounded-full" style="width: \${pct}%"></div>
              </div>
            </div>
          \`;
        }).join('');
      }
    }

    // IDL File Upload
    function uploadIdlFile(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const idl = JSON.parse(e.target.result);
          await submitIdl(idl);
        } catch {
          alert('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }

    async function promptPasteIdl() {
      const raw = prompt('Paste Anchor IDL JSON:');
      if (!raw) return;
      try {
        const idl = JSON.parse(raw);
        await submitIdl(idl);
      } catch {
        alert('Invalid JSON payload');
      }
    }

    async function submitIdl(idl) {
      const res = await fetch('/api/idl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(idl)
      });
      const data = await res.json();
      if (data.success) {
        applyIdlSummary(data);
        alert('Successfully loaded IDL for ' + data.name);
      } else {
        alert('Failed to load IDL: ' + data.error);
      }
    }

    function applyIdlSummary(idl) {
      if (!idl) return;
      document.getElementById('idlStatusBadge').textContent = 'IDL Active: ' + idl.name;
      document.getElementById('idlStatusBadge').className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
      document.getElementById('idlDescription').textContent = \`Loaded \${idl.instructions?.length || 0} instructions and \${idl.events?.length || 0} events. All incoming transactions will be decoded automatically.\`;
    }

    function applyDataSourceStatus(source, reason) {
      const badge = document.getElementById('dataSourceBadge');
      const dot = document.getElementById('dataSourceDot');
      const text = document.getElementById('dataSourceText');
      if (!badge || !dot || !text) return;

      if (source === 'rpc_failover') {
        badge.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium';
        badge.title = reason || 'Yellowstone gRPC unavailable, using JSON-RPC failover polling';
        dot.className = 'h-2 w-2 rounded-full bg-amber-400 live-pulse';
        text.textContent = 'RPC Failover Polling';
      } else {
        badge.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium';
        badge.title = 'Connected to Helius LaserStream Yellowstone gRPC';
        dot.className = 'h-2 w-2 rounded-full bg-emerald-400 live-pulse';
        text.textContent = 'LaserStream gRPC';
      }
    }

    function loadInitialInfo() {
      fetch('/api/info')
        .then(r => r.json())
        .then(info => {
          if (info?.idl) applyIdlSummary(info.idl);
          if (info?.dataSource) applyDataSourceStatus(info.dataSource, info.failoverReason);
        })
        .catch(() => {});
    }

    function loadInitialTransactions() {
      fetch('/api/transactions?limit=50')
        .then(r => r.json())
        .then(txs => {
          if (Array.isArray(txs) && txs.length > 0) {
            activityItems = txs;
            document.getElementById('streamCount').textContent = activityItems.length;
            renderActivityFeed();
          }
        })
        .catch(err => console.error('Failed to load initial transactions', err));
    }

    function loadInitialGovernance() {
      fetch('/api/governance')
        .then(r => r.json())
        .then(events => {
          if (Array.isArray(events) && events.length > 0) {
            events.forEach(handleGovernanceEvent);
          }
        })
        .catch(err => console.error('Failed to load initial governance', err));
    }

    // Initial load
    loadInitialInfo();
    fetch('/api/metrics').then(r => r.json()).then(updateMetricsView).catch(()=>{});
    loadInitialTransactions();
    loadInitialGovernance();
    connectSse();

    // Auto-poll metrics every 3 seconds to keep counters fresh
    setInterval(() => {
      fetch('/api/metrics').then(r => r.json()).then(updateMetricsView).catch(()=>{});
    }, 3000);
  </script>
</body>
</html>`;
}
