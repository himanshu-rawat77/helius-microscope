import { Connection, PublicKey, VersionedTransactionResponse } from '@solana/web3.js';
import { CommitmentLevel } from 'helius-laserstream';
import { DatabaseManager } from './db';
import { IndexerConfig, ParsedInstruction, ParsedTransaction } from './types';
import { MicroscopeIdlDecoder } from './microscope/idlDecoder';
import { MicroscopeGovernanceTracker } from './microscope/governance';
import { MicroscopeMetrics } from './microscope/metrics';
import { MicroscopeServer } from './microscope/server';

export interface RpcFailoverContext {
  idlDecoder: MicroscopeIdlDecoder;
  governance: MicroscopeGovernanceTracker;
  metrics: MicroscopeMetrics;
  server: MicroscopeServer;
}

function toWeb3Commitment(level: CommitmentLevel): 'processed' | 'confirmed' | 'finalized' {
  switch (level) {
    case CommitmentLevel.PROCESSED:
      return 'processed';
    case CommitmentLevel.FINALIZED:
      return 'finalized';
    case CommitmentLevel.CONFIRMED:
    default:
      return 'confirmed';
  }
}

export function resolveHeliusRpcEndpoint(config: IndexerConfig): string {
  if (config.rpcEndpoint) {
    return config.rpcEndpoint;
  }
  const cluster = config.network === 'mainnet' ? 'mainnet' : 'devnet';
  return `https://${cluster}.helius-rpc.com/?api-key=${config.heliusApiKey}`;
}

/**
 * Automatic JSON-RPC Failover Poller.
 * Activates when Yellowstone/LaserStream gRPC is unavailable or disconnects,
 * polling watched programs & multisig addresses via Solana JSON-RPC.
 */
export class RpcFailoverPoller {
  private connection: Connection;
  private config: IndexerConfig;
  private db: DatabaseManager;
  private microscope?: RpcFailoverContext;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pollingInFlight = false;
  private lastSignatureByAddress = new Map<string, string>();
  private seenSignatures = new Set<string>();
  private watchedAddresses: string[];
  private watchedPrograms: string[];
  private multisigs: string[];
  public readonly rpcEndpoint: string;

  constructor(config: IndexerConfig, db: DatabaseManager, microscope?: RpcFailoverContext) {
    this.config = config;
    this.db = db;
    this.microscope = microscope;
    this.rpcEndpoint = resolveHeliusRpcEndpoint(config);
    this.connection = new Connection(this.rpcEndpoint, toWeb3Commitment(config.commitment));

    this.watchedPrograms =
      config.programIds && config.programIds.length > 0 ? config.programIds : [config.programId];
    this.multisigs = config.multisigAddresses || [];
    this.watchedAddresses = Array.from(new Set([...this.watchedPrograms, ...this.multisigs]));
  }

  public isActive(): boolean {
    return this.running;
  }

  public start(reason?: string): void {
    if (this.running) return;
    if (this.config.rpcFailoverEnabled === false) {
      console.warn('[RPC Failover] Disabled via RPC_FAILOVER_ENABLED=false.');
      return;
    }

    this.running = true;
    const intervalMs = this.config.rpcPollIntervalMs || 3000;
    const safeUrl = this.rpcEndpoint.replace(/api-key=[^&]+/i, 'api-key=***');

    console.warn(
      `\x1b[33m[RPC Failover]\x1b[0m Activating JSON-RPC polling (${safeUrl}) every ${intervalMs}ms` +
        (reason ? ` — Reason: ${reason}` : '')
    );

    if (this.microscope) {
      this.microscope.server.setDataSource('rpc_failover', reason || 'LaserStream gRPC unavailable');
    }

    // Immediate first poll, then interval
    void this.pollOnce();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  public stop(recoveredToLaserstream: boolean = false): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (recoveredToLaserstream && this.microscope) {
      this.microscope.server.setDataSource('laserstream');
      console.log('\x1b[32m[RPC Failover]\x1b[0m LaserStream gRPC recovered — stopping RPC failover polling.');
    } else {
      console.log('[RPC Failover] Polling stopped.');
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.running || this.pollingInFlight) return;
    this.pollingInFlight = true;

    try {
      const commitment = toWeb3Commitment(this.config.commitment);
      const currentSlot = await this.connection.getSlot(commitment);
      this.db.updateLatestSlot(currentSlot);
      if (this.microscope) {
        this.microscope.server.broadcastSlot(currentSlot);
      }

      for (const addr of this.watchedAddresses) {
        if (!this.running) break;

        let pubkey: PublicKey;
        try {
          pubkey = new PublicKey(addr);
        } catch {
          continue;
        }

        const until = this.lastSignatureByAddress.get(addr);
        const sigInfos = await this.connection.getSignaturesForAddress(
          pubkey,
          { limit: until ? 20 : 5, until },
          commitment === 'processed' ? 'confirmed' : commitment
        );

        if (sigInfos.length === 0) continue;

        // Track newest signature so next poll only fetches newer txs
        this.lastSignatureByAddress.set(addr, sigInfos[0].signature);

        // Process oldest -> newest
        const ordered = [...sigInfos].reverse();
        for (const info of ordered) {
          if (this.seenSignatures.has(info.signature)) continue;
          this.rememberSignature(info.signature);

          const rawTx = await this.connection.getTransaction(info.signature, {
            commitment: commitment === 'processed' ? 'confirmed' : commitment,
            maxSupportedTransactionVersion: 0,
          });

          if (!rawTx) continue;
          const parsed = this.normalizeRpcTransaction(info.signature, rawTx);
          if (!parsed) continue;

          const inserted = this.db.saveTransaction(parsed);
          if (!inserted) continue;

          if (this.microscope) {
            const govEvent = this.microscope.governance.analyzeTransaction(
              parsed,
              this.watchedPrograms,
              this.multisigs
            );
            if (govEvent) {
              this.db.saveGovernanceEvent(govEvent);
              this.microscope.metrics.recordGovernanceEvent();
              this.microscope.server.broadcastGovernance(govEvent);
              console.log(`\x1b[33m[Microscope Governance]\x1b[0m ${govEvent.type}: ${govEvent.description}`);
            }

            const decodedNames = parsed.instructions.map((i) => i.decoded?.name).filter(Boolean) as string[];
            this.microscope.metrics.recordTransaction(parsed, decodedNames);
            this.microscope.server.broadcastTransaction(parsed);
          }

          const status = parsed.err ? `FAILED (${parsed.err})` : 'SUCCESS';
          console.log(
            `[RPC-TX] Slot ${parsed.slot} | Sig: ${parsed.signature.slice(0, 16)}... | Fee: ${parsed.fee} | Status: ${status}`
          );
        }
      }
    } catch (err: any) {
      console.error('[RPC Failover] Poll error:', err?.message || err);
    } finally {
      this.pollingInFlight = false;
    }
  }

  private rememberSignature(sig: string): void {
    this.seenSignatures.add(sig);
    if (this.seenSignatures.size > 2000) {
      const first = this.seenSignatures.values().next().value;
      if (first) this.seenSignatures.delete(first);
    }
  }

  private normalizeRpcTransaction(
    signature: string,
    tx: VersionedTransactionResponse
  ): ParsedTransaction | null {
    const message: any = tx.transaction.message;
    const staticKeys: PublicKey[] = message.staticAccountKeys || message.accountKeys || [];
    const loadedWritable: PublicKey[] = tx.meta?.loadedAddresses?.writable || [];
    const loadedReadonly: PublicKey[] = tx.meta?.loadedAddresses?.readonly || [];
    const accountKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly].map((k) => k.toBase58());

    const compiledInstructions: any[] = message.compiledInstructions || message.instructions || [];
    const instructions: ParsedInstruction[] = compiledInstructions.map((inst) => {
      const progIdx = inst.programIdIndex ?? -1;
      const programId = progIdx >= 0 && progIdx < accountKeys.length ? accountKeys[progIdx] : `idx:${progIdx}`;
      const accountIdxs: number[] = inst.accountKeyIndexes || inst.accounts || [];
      const instAccounts = accountIdxs.map((idx) =>
        idx >= 0 && idx < accountKeys.length ? accountKeys[idx] : `idx:${idx}`
      );
      const dataStr = inst.data ? Buffer.from(inst.data).toString('base64') : '';

      let decoded = null;
      if (
        this.microscope?.idlDecoder &&
        (this.watchedPrograms.length === 0 || this.watchedPrograms.includes(programId))
      ) {
        decoded = this.microscope.idlDecoder.decodeInstruction(dataStr);
      }

      return {
        programId,
        accounts: instAccounts,
        data: dataStr,
        decoded,
      };
    });

    const logMessages = tx.meta?.logMessages || [];
    const decodedEvents = this.microscope?.idlDecoder
      ? this.microscope.idlDecoder.decodeEvents(logMessages)
      : [];

    return {
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      err: tx.meta?.err ? JSON.stringify(tx.meta.err) : null,
      fee: tx.meta?.fee ?? 0,
      computeUnitsConsumed: tx.meta?.computeUnitsConsumed ?? null,
      recentBlockhash: message.recentBlockhash || '',
      accounts: accountKeys,
      instructions,
      logMessages,
      decodedEvents: decodedEvents.length > 0 ? decodedEvents : undefined,
      createdAt: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString(),
    };
  }
}
