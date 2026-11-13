// The guard: the installed gatekeeper. One factory, one object — the shape of
// "npm install spamcha + 5 lines". It owns the model (load-or-create, autosave
// on review), the quarantine store (the "this was garbage" button's memory),
// the rate limiter and the stamp issuer. node:fs is why this file exists
// separate from gatekeeper.ts (which stays isomorphic).

import { existsSync } from 'node:fs';
import { createModel } from './bayes.js';
import type { BayesModel } from './bayes.js';
import { trainFields } from './judge.js';
import { translate } from './locales.js';
import type { Locale } from './locales.js';
import { QuarantineStore } from './quarantine.js';
import { createRateLimiter } from './rate-limit.js';
import type { RateLimiter } from './rate-limit.js';
import { verifySubmission } from './gatekeeper.js';
import { issueStamp, stampFieldsHtml } from './stamp.js';
import { loadModel, saveModel } from './storage.js';
import type { Label } from './types.js';
import type { GatekeeperOptions, SubmissionVerdict } from './gatekeeper.js';

export interface GatekeeperConfig extends GatekeeperOptions {
  /** Model file: loaded if it exists, created if not, autosaved on review. */
  modelPath?: string;
  /** Quarantine JSONL: when set, held submissions are stored for review. */
  quarantinePath?: string;
  /** Per-IP rate limit for `review`. */
  rateLimit?: { max: number; windowMs: number };
  /** Stamp lifetime (default 30 minutes). */
  ttlMs?: number;
}

export interface ReviewMeta {
  /** Caller IP, for the rate limiter. */
  ip?: string;
  /** Server clock, injectable for tests. */
  now?: number;
}

export function createGatekeeper(config: GatekeeperConfig) {
  const locale: Locale | undefined = config.locale;
  const voice = (code: string): string => translate(code, { locale });

  let model: BayesModel = createModel();
  if (config.modelPath && existsSync(config.modelPath)) {
    model = loadModel(config.modelPath);
  }

  const quarantine = config.quarantinePath ? new QuarantineStore(config.quarantinePath) : null;
  const limiter: RateLimiter | null = config.rateLimit ? createRateLimiter(config.rateLimit) : null;

  const stripOwnFields = (fields: Record<string, string>): Record<string, string> => {
    const stampField = config.stampField ?? 'spamcha';
    const honeypotField = config.honeypotField ?? 'website';
    const rest: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k !== stampField && k !== honeypotField) rest[k] = v;
    }
    return rest;
  };

  return {
    /** The live model (mutations via resolveQuarantine mutate this object). */
    model,

    /** Issues the stamp to embed in the form at render time. */
    stampToken(): Promise<string> {
      return issueStamp(config.secret, { formId: config.formId, ttlMs: config.ttlMs });
    },

    /** Same, ready-made as the two hidden inputs for the form HTML. */
    async stampHtml(): Promise<string> {
      const token = await this.stampToken();
      return stampFieldsHtml(token, {
        stampField: config.stampField,
        honeypotField: config.honeypotField,
      });
    },

    /** The full pipeline for one submission: rate limit → gates → judge. */
    async review(fields: Record<string, string>, meta: ReviewMeta = {}): Promise<SubmissionVerdict> {
      if (limiter && meta.ip !== undefined && !limiter.check(meta.ip, meta.now)) {
        return {
          decision: 'reject',
          probability: 1,
          bayes: null,
          rules: 0,
          phase: 'trained',
          reasons: [],
          signals: [{ code: 'rate:limited', text: voice('rate:limited') }],
          meta: { tokens: 0, fields: Object.keys(fields).length },
        };
      }

      const verdict = await verifySubmission(fields, model, { ...config, now: meta.now });
      if (verdict.decision === 'quarantine' && quarantine) {
        quarantine.add(stripOwnFields(fields), verdict);
      }
      return verdict;
    },

    /** Pending held submissions (the review page feeds on this). */
    listQuarantine(): ReturnType<QuarantineStore['list']> {
      return quarantine?.list() ?? [];
    },

    /**
     * The "this was garbage" button: trains the live model with the held
     * submission's fields, autosaves the model (if modelPath) and removes
     * the entry. Returns whether the entry existed.
     */
    resolveQuarantine(id: string, label: Label): boolean {
      if (!quarantine) return false;
      const entry = quarantine.list().find((e) => e.id === id);
      if (!entry) return false;
      trainFields(model, entry.fields, label);
      if (config.modelPath) saveModel(model, config.modelPath);
      quarantine.resolve(id);
      return true;
    },

    /** Removes an entry WITHOUT training (the plain "delete" button). */
    discardQuarantine(id: string): boolean {
      return quarantine?.resolve(id) ?? false;
    },
  };
}

export type Gatekeeper = ReturnType<typeof createGatekeeper>;
