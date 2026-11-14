// The quarantine: one JSONL file with the submissions held for review — plus
// the CONFIRMATION mechanism that removes the human from the loop:
// every held entry carries a signed token; the sender confirms with one click
// (a link the site can put on its own thank-you page or mail) and the message
// is delivered without anyone reviewing anything. Entries nobody confirms
// within the TTL are presumed spam and swept away — no operator required.
// This is the newsletter double opt-in pattern, applied to contact forms.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBase64Url } from './crypto.js';
import type { Verdict } from './types.js';

export interface QuarantineEntry {
  id: string;
  receivedAt: string;
  /** The judged fields (stamp and honeypot stripped out) — enough to retrain. */
  fields: Record<string, string>;
  probability: number;
  phase: 'cold' | 'trained';
  /** Signed token: whoever holds it can confirm the message as delivered. */
  token: string;
  /** Set when the sender confirmed (or the site released it). */
  confirmedAt?: string;
}

export class QuarantineStore {
  constructor(
    readonly path: string,
    /** Unconfirmed entries older than this are swept as presumed spam. */
    readonly ttlMs = 7 * 24 * 60 * 60 * 1000,
  ) {}

  add(fields: Record<string, string>, verdict: Pick<Verdict, 'probability' | 'phase'>, token: string): QuarantineEntry {
    const entry: QuarantineEntry = {
      id: randomBase64Url(12),
      receivedAt: new Date().toISOString(),
      fields,
      probability: verdict.probability,
      phase: verdict.phase,
      token,
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
        // corrupt line: skip it, the rest stays usable
      }
    }
    return out;
  }

  /** Pending = not confirmed yet (the review page feeds on this). */
  listPending(): QuarantineEntry[] {
    return this.list().filter((e) => !e.confirmedAt);
  }

  /** Confirmed = delivered: the sender proved a human sent it. Newest first. */
  listConfirmed(): QuarantineEntry[] {
    return this.list()
      .filter((e) => !!e.confirmedAt)
      .sort((a, b) => (a.confirmedAt! < b.confirmedAt! ? 1 : -1));
  }

  /** Finds a PENDING entry by its confirmation token. */
  findByToken(token: string): QuarantineEntry | null {
    return this.list().find((e) => e.token === token && !e.confirmedAt) ?? null;
  }

  /** Marks an entry confirmed (delivered to the owner, readable in the panel). */
  markConfirmed(id: string): boolean {
    const entries = this.list();
    const entry = entries.find((e) => e.id === id);
    if (!entry || entry.confirmedAt) return false;
    entry.confirmedAt = new Date().toISOString();
    writeFileSync(this.path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  }

  /** Removes an entry (reviewed, or swept as presumed spam). */
  resolve(id: string): boolean {
    const entries = this.list();
    const rest = entries.filter((e) => e.id !== id);
    if (rest.length === entries.length) return false;
    writeFileSync(this.path, rest.map((e) => JSON.stringify(e)).join('\n') + (rest.length > 0 ? '\n' : ''), { encoding: 'utf8', mode: 0o600 });
    return true;
  }

  /**
   * Sweeps unconfirmed entries past the TTL: nobody confirmed them within the
   * window, so they're presumed spam and deleted WITHOUT training (mail
   * deliverability noise makes non-response a weak signal — sweeping without
   * learning keeps the corpus clean). Returns the removed entries.
   */
  sweepExpired(now = Date.now(), ttlMs = this.ttlMs): QuarantineEntry[] {
    const entries = this.list();
    const keep = entries.filter((e) => {
      if (e.confirmedAt) return true;
      const received = Date.parse(e.receivedAt);
      return !Number.isNaN(received) && now - received < ttlMs;
    });
    if (keep.length === entries.length) return [];
    writeFileSync(this.path, keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length > 0 ? '\n' : ''), { encoding: 'utf8', mode: 0o600 });
    return entries.filter((e) => !keep.includes(e));
  }
}
