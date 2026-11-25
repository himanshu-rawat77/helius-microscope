import { ParsedTransaction } from '../types';

export class MicroscopeMetrics {
  public totalTransactions = 0;
  public sessionTransactions = 0;
  public totalFailed = 0;
  public totalFeeLamports = 0;
  public totalComputeUnits = 0;
  public maxComputeUnits = 0;
  public accountsCount = 0;
  public instructionCounts: Record<string, number> = {};
  public governanceEventsCount = 0;
  public lastTxTimestamp: string | null = null;

  // Windowed throughput tracking (last 60 seconds)
  private timestampWindow: number[] = [];

  public initFromDatabase(stats: {
    transactionsCount: number;
    governanceCount?: number;
    failedCount?: number;
    totalFeeLamports?: number;
    totalComputeUnits?: number;
    maxComputeUnits?: number;
    accountsCount?: number;
    lastTxAt?: string | null;
  }) {
    this.totalTransactions = stats.transactionsCount || 0;
    this.governanceEventsCount = stats.governanceCount || 0;
    this.totalFailed = stats.failedCount || 0;
    this.totalFeeLamports = stats.totalFeeLamports || 0;
    this.totalComputeUnits = stats.totalComputeUnits || 0;
    this.maxComputeUnits = stats.maxComputeUnits || 0;
    this.accountsCount = stats.accountsCount || 0;
    this.lastTxTimestamp = stats.lastTxAt || null;
  }

  public recordTransaction(tx: ParsedTransaction, decodedNames: string[]) {
    this.totalTransactions++;
    this.sessionTransactions++;
    this.lastTxTimestamp = tx.createdAt || new Date().toISOString();
    if (tx.err) this.totalFailed++;

    this.totalFeeLamports += tx.fee || 0;

    const cu = tx.computeUnitsConsumed || 0;
    this.totalComputeUnits += cu;
    if (cu > this.maxComputeUnits) {
      this.maxComputeUnits = cu;
    }

    if (decodedNames.length > 0) {
      for (const name of decodedNames) {
        this.instructionCounts[name] = (this.instructionCounts[name] || 0) + 1;
      }
    } else {
      this.instructionCounts['unparsed'] = (this.instructionCounts['unparsed'] || 0) + 1;
    }

    const now = Date.now();
    this.timestampWindow.push(now);
    // Prune entries older than 60 seconds
    const cutoff = now - 60000;
    while (this.timestampWindow.length > 0 && this.timestampWindow[0] < cutoff) {
      this.timestampWindow.shift();
    }
  }

  public recordGovernanceEvent() {
    this.governanceEventsCount++;
  }

  public getTps(): number {
    const now = Date.now();
    const cutoff = now - 60000;
    while (this.timestampWindow.length > 0 && this.timestampWindow[0] < cutoff) {
      this.timestampWindow.shift();
    }
    return Number((this.timestampWindow.length / 60).toFixed(2));
  }

  public getSummary() {
    const avgCu =
      this.totalTransactions > 0 ? Math.round(this.totalComputeUnits / this.totalTransactions) : 0;
    const successRate =
      this.totalTransactions > 0
        ? Number((((this.totalTransactions - this.totalFailed) / this.totalTransactions) * 100).toFixed(2))
        : 100;

    return {
      totalTransactions: this.totalTransactions,
      sessionTransactions: this.sessionTransactions,
      totalFailed: this.totalFailed,
      successRate,
      tps: this.getTps(),
      totalFeeLamports: this.totalFeeLamports,
      avgComputeUnits: avgCu,
      maxComputeUnits: this.maxComputeUnits,
      accountsCount: this.accountsCount,
      instructionCounts: this.instructionCounts,
      governanceEventsCount: this.governanceEventsCount,
      lastTxTimestamp: this.lastTxTimestamp,
    };
  }

  /**
   * Serializes metrics into standard Prometheus exposition format.
   */
  public toPrometheus(): string {
    const summary = this.getSummary();
    let p = '';

    p += `# HELP solana_microscope_tx_total Total transactions processed by Microscope\n`;
    p += `# TYPE solana_microscope_tx_total counter\n`;
    p += `solana_microscope_tx_total ${summary.totalTransactions}\n\n`;

    p += `# HELP solana_microscope_tx_failed_total Total failed or reverted transactions\n`;
    p += `# TYPE solana_microscope_tx_failed_total counter\n`;
    p += `solana_microscope_tx_failed_total ${summary.totalFailed}\n\n`;

    p += `# HELP solana_microscope_tps Current windowed transactions per second\n`;
    p += `# TYPE solana_microscope_tps gauge\n`;
    p += `solana_microscope_tps ${summary.tps}\n\n`;

    p += `# HELP solana_microscope_cu_avg Average compute units consumed per transaction\n`;
    p += `# TYPE solana_microscope_cu_avg gauge\n`;
    p += `solana_microscope_cu_avg ${summary.avgComputeUnits}\n\n`;

    p += `# HELP solana_microscope_cu_max Maximum compute units consumed by a single transaction\n`;
    p += `# TYPE solana_microscope_cu_max gauge\n`;
    p += `solana_microscope_cu_max ${summary.maxComputeUnits}\n\n`;

    p += `# HELP solana_microscope_fee_lamports_total Total transaction fees paid in lamports\n`;
    p += `# TYPE solana_microscope_fee_lamports_total counter\n`;
    p += `solana_microscope_fee_lamports_total ${summary.totalFeeLamports}\n\n`;

    p += `# HELP solana_microscope_governance_events_total Total governance and BPF upgrades detected\n`;
    p += `# TYPE solana_microscope_governance_events_total counter\n`;
    p += `solana_microscope_governance_events_total ${summary.governanceEventsCount}\n\n`;

    p += `# HELP solana_microscope_instruction_count Instruction invocation distribution\n`;
    p += `# TYPE solana_microscope_instruction_count counter\n`;
    for (const [inst, count] of Object.entries(this.instructionCounts)) {
      const cleanInst = inst.replace(/[^a-zA-Z0-9_]/g, '_');
      p += `solana_microscope_instruction_count{instruction="${cleanInst}"} ${count}\n`;
    }

    return p;
  }
}
