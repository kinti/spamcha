// The quarantine: one JSONL file with the submissions held for review.
// This is the "this was garbage" button's memory: the site owner opens the
// review page, marks each held submission spam or ham, and the judge trains
// on the spot. The file never leaves the server — it IS the private corpus
// in the making.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomBase64Url } from './crypto.js';
import type { Verdict } from './types.js';

export interface QuarantineEntry {
  id: string;
  receivedAt: string;
  /** The judged fields (stamp and honeypot stripped out) — enough to retrain. */
  fields: Record<string, string>;
  probability: number;
  phase: 'cold' | 'trained';
}

export class QuarantineStore {
  constructor(readonly path: string) {}

  add(fields: Record<string, string>, verdict: Pick<Verdict, 'probability' | 'phase'>): QuarantineEntry {
    const entry: QuarantineEntry = {
      id: randomBase64Url(12),
      receivedAt: new Date().toISOString(),
      fields,
      probability: verdict.probability,
      phase: verdict.phase,
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
    return entry;
  }

  list(): QuarantineEntry[] {
    if (!existsSync(this.path)) return [];
    const out: QuarantineEntry[] = [];
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        out.push(JSON.parse(line) as QuarantineEntry);
      } catch {
        // corrupt line: skip it, the rest of the file stays usable
      }
    }
    return out;
  }

  /** Removes an entry (it was reviewed). Returns whether it existed. */
  resolve(id: string): boolean {
    const entries = this.list();
    const rest = entries.filter((e) => e.id !== id);
    if (rest.length === entries.length) return false;
    writeFileSync(this.path, rest.map((e) => JSON.stringify(e)).join('\n') + (rest.length > 0 ? '\n' : ''), { encoding: 'utf8', mode: 0o600 });
    return true;
  }
}
