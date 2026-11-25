import { BorshInstructionCoder, BorshEventCoder, Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import fs from 'fs';
import { DecodedInstruction, DecodedEvent } from '../types';

export class MicroscopeIdlDecoder {
  private instructionCoder: BorshInstructionCoder | null = null;
  private eventCoder: BorshEventCoder | null = null;
  public idl: Idl | null = null;

  /**
   * Loads an IDL from a local JSON file path.
   */
  public loadIdlFromFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`[Microscope IDL] File not found: ${filePath}`);
        return false;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Idl;
      return this.loadIdl(parsed);
    } catch (err: any) {
      console.error(`[Microscope IDL] Failed to load IDL from file ${filePath}:`, err.message);
      return false;
    }
  }

  /**
   * Initializes instruction and event coders from an IDL object.
   */
  public loadIdl(idl: Idl): boolean {
    try {
      this.idl = idl;
      try {
        this.instructionCoder = new BorshInstructionCoder(this.idl);
      } catch (err: any) {
        console.warn('[Microscope IDL] Could not initialize instruction coder:', err.message);
        this.instructionCoder = null;
      }

      try {
        if ((this.idl as any).events && Array.isArray((this.idl as any).events) && (this.idl as any).types) {
          this.eventCoder = new BorshEventCoder(this.idl);
        } else {
          this.eventCoder = null;
        }
      } catch (err: any) {
        console.warn('[Microscope IDL] Could not initialize event coder:', err.message);
        this.eventCoder = null;
      }

      const name = (this.idl as any).name || (this.idl as any).metadata?.name || 'CustomProgram';
      const instCount = (this.idl as any).instructions?.length || 0;
      const eventCount = (this.idl as any).events?.length || 0;
      console.log(`[Microscope IDL] Successfully loaded IDL "${name}" (${instCount} instructions, ${eventCount} events)`);
      return Boolean(this.instructionCoder || this.eventCoder);
    } catch (err: any) {
      console.error('[Microscope IDL] Failed to initialize Anchor coders:', err.message);
      return false;
    }
  }

  /**
   * Decodes raw base64 instruction data into a named Anchor instruction with structured arguments.
   */
  public decodeInstruction(dataBase64: string): DecodedInstruction | null {
    if (!this.instructionCoder || !dataBase64) return null;
    try {
      const buffer = Buffer.from(dataBase64, 'base64');
      if (buffer.length < 8) return null; // Anchor requires at least 8-byte discriminator

      const decoded = this.instructionCoder.decode(buffer);
      if (!decoded) return null;

      return {
        name: decoded.name,
        args: this.formatBorshValues(decoded.data),
      };
    } catch {
      return null;
    }
  }

  /**
   * Scans log messages for Anchor events emitted via `emit!` ("Program data: <base64>")
   */
  public decodeEvents(logMessages: string[]): DecodedEvent[] {
    if (!this.eventCoder || !logMessages || logMessages.length === 0) return [];
    const events: DecodedEvent[] = [];

    for (const log of logMessages) {
      if (typeof log === 'string' && log.startsWith('Program data: ')) {
        try {
          const rawBase64 = log.slice('Program data: '.length).trim();
          const decoded = this.eventCoder.decode(rawBase64);
          if (decoded) {
            events.push({
              name: decoded.name,
              data: this.formatBorshValues(decoded.data),
            });
          }
        } catch {
          // Ignore unparsable event lines
        }
      }
    }
    return events;
  }

  /**
   * Recursively converts Borsh BN numbers, PublicKeys, and Buffers into clean JSON types.
   */
  private formatBorshValues(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof PublicKey) return obj.toBase58();
    if (typeof obj === 'object' && obj._bn) return obj.toString(); // Anchor BN
    if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
      return Buffer.from(obj).toString('hex');
    }
    if (Array.isArray(obj)) {
      return obj.map((i) => this.formatBorshValues(i));
    }
    if (typeof obj === 'object') {
      const formatted: Record<string, any> = {};
      for (const [key, val] of Object.entries(obj)) {
        formatted[key] = this.formatBorshValues(val);
      }
      return formatted;
    }
    return obj;
  }

  public getSummary() {
    if (!this.idl) return null;
    return {
      name: (this.idl as any).name || (this.idl as any).metadata?.name || 'Unknown',
      version: (this.idl as any).version || (this.idl as any).metadata?.version || '0.1.0',
      instructions: ((this.idl as any).instructions || []).map((i: any) => i.name),
      events: ((this.idl as any).events || []).map((e: any) => e.name),
    };
  }
}
