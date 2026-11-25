import { GovernanceEvent, ParsedTransaction } from '../types';

export const BPF_LOADER_UPGRADEABLE_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const SQUADS_V4_PROGRAM_ID = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
export const SQUADS_V3_PROGRAM_ID = 'SMPLecH534NA9acposbV4Kx1o2N71Z88FSp4rX4u96i';

export class MicroscopeGovernanceTracker {
  private events: GovernanceEvent[] = [];

  public initFromDatabase(events: GovernanceEvent[]) {
    this.events = [...events];
  }

  /**
   * Scans a confirmed transaction for BPF Upgradeable Loader, Squads Multisig,
   * and monitored multisig/vault address actions across all watched programs.
   */
  public analyzeTransaction(
    tx: ParsedTransaction,
    watchedProgramIds: string | string[],
    multisigAddresses: string[] = []
  ): GovernanceEvent | null {
    const accounts = tx.accounts || [];
    const logs = tx.logMessages || [];
    const programs = Array.isArray(watchedProgramIds) ? watchedProgramIds : [watchedProgramIds];

    // 1. Check for BPF Upgradeable Loader actions on any watched program
    const matchedProgram = programs.find((p) => accounts.includes(p));
    if (accounts.includes(BPF_LOADER_UPGRADEABLE_ID) && matchedProgram) {
      const isUpgrade = logs.some((l) => l.includes('Upgrade') || l.includes('Instruction: Upgrade'));
      const isSetAuthority = logs.some((l) => l.includes('SetAuthority') || l.includes('Instruction: SetAuthority'));

      if (isUpgrade) {
        const event: GovernanceEvent = {
          type: 'PROGRAM_UPGRADE',
          signature: tx.signature,
          slot: tx.slot,
          description: `Executable buffer upgrade committed for program ${matchedProgram.slice(0, 10)}...`,
          details: {
            programId: matchedProgram,
            fee: tx.fee,
            computeUnits: tx.computeUnitsConsumed,
          },
          timestamp: tx.createdAt || new Date().toISOString(),
        };
        this.addEvent(event);
        return event;
      }

      if (isSetAuthority) {
        const event: GovernanceEvent = {
          type: 'AUTHORITY_CHANGE',
          signature: tx.signature,
          slot: tx.slot,
          description: `Upgrade authority modified for program ${matchedProgram.slice(0, 10)}...`,
          details: {
            programId: matchedProgram,
            signers: accounts.slice(0, 2),
          },
          timestamp: tx.createdAt || new Date().toISOString(),
        };
        this.addEvent(event);
        return event;
      }
    }

    // 2. Check for Squads Multisig interactions or explicitly monitored multisig addresses
    const isSquadsV4 = accounts.includes(SQUADS_V4_PROGRAM_ID);
    const isSquadsV3 = accounts.includes(SQUADS_V3_PROGRAM_ID);
    const matchedMultisig = multisigAddresses.find((m) => accounts.includes(m));

    if (isSquadsV4 || isSquadsV3 || matchedMultisig) {
      const isExecution = logs.some((l) => l.toLowerCase().includes('execute') || l.toLowerCase().includes('executed'));
      const isProposal = logs.some((l) => l.toLowerCase().includes('proposal') || l.toLowerCase().includes('create'));

      const type = isExecution ? 'MULTISIG_EXECUTE' : isProposal ? 'MULTISIG_PROPOSAL' : 'MULTISIG_EXECUTE';
      const version = isSquadsV4 ? 'v4' : isSquadsV3 ? 'v3' : 'monitored';

      const event: GovernanceEvent = {
        type,
        signature: tx.signature,
        slot: tx.slot,
        description: matchedMultisig
          ? `Multisig ${matchedMultisig.slice(0, 10)}... activity (${version})`
          : `Squads ${version} multisig action touching watched program state`,
        details: {
          version,
          multisigAddress: matchedMultisig || null,
          matchedProgram: matchedProgram || null,
          accountsInvolved: accounts.length,
          status: tx.err ? 'FAILED' : 'SUCCESS',
        },
        timestamp: tx.createdAt || new Date().toISOString(),
      };
      this.addEvent(event);
      return event;
    }

    return null;
  }

  private addEvent(event: GovernanceEvent) {
    this.events.unshift(event);
    if (this.events.length > 200) {
      this.events.pop();
    }
  }

  public getRecentEvents(limit: number = 50): GovernanceEvent[] {
    return this.events.slice(0, limit);
  }

  public getEventCount(): number {
    return this.events.length;
  }
}
