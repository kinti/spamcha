// The verdict log: one JSONL file with EVERY submission's outcome — pass,
// quarantine and reject. The panel reads this; the owner finally SEES what
// arrives. Same privacy rule as everything else: the file lives on the
// owner's disk and nowhere else. Rotates: keeps only the newest max entries.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBase64Url } from './crypto.js';
import type { Decision } from './types.js';

export interface LogEntry {
  id: string;
  receivedAt: string;
  decision: Decision;
  probability: number;
  phase: 'cold' | 'trained';
  /** The judged fields (stamp and honeypot stripped out). */
  fields: Record<string, string>;
  /** Stable codes: signals + fired rules. Human text via the locale layer. */
  codes: string[];
}

export class VerdictLog {
  constructor(
    readonly path: string,
    /** Keep only the newest N entries (default 1.000). */
    readonly maxEntries = 1_000,
  ) {}

  add(fields: Record<string, string>, verdict: { decision: Decision; probability: number; phase: 'cold' | 'trained' }, codes: string[]): LogEntry {
    const entry: LogEntry = {
      id: randomBase64Url(12),
      receivedAt: new Date().toISOString(),
      decision: verdict.decision,
      probability: verdict.probability,
      phase: verdict.phase,
      fields,
      codes,
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
    this.rotate();
    return entry;
  }

  list(): LogEntry[] {
    if (!existsSync(this.path)) return [];
    const out: LogEntry[] = [];
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        out.push(JSON.parse(line) as LogEntry);
      } catch {
        // corrupt line: skip, the rest stays usable
      }
    }
    return out;
  }

  /** Newest first, limited. */
  recent(limit = 50): LogEntry[] {
    return this.list().slice(-limit).reverse();
  }

  private rotate(): void {
    const entries = this.list();
    if (entries.length <= this.maxEntries) return;
    writeFileSync(this.path, entries.slice(-this.maxEntries).map((e) => JSON.stringify(e)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  }
}
