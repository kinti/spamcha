// The guard: the installed gatekeeper. One factory, one object — the shape of
// "npm install spamcha + 5 lines". It owns the model (load-or-create, autosave
// on review), the quarantine store (the "this was garbage" button's memory),
// the rate limiter and the stamp issuer. node:fs is why this file exists
// separate from gatekeeper.ts (which stays isomorphic).

import { existsSync } from 'node:fs';
import { createModel } from './bayes.js';
import type { BayesModel } from './bayes.js';
import { mergeFeedChannels } from './feed.js';
import { hmacHex } from './crypto.js';
import { randomBase64Url } from './crypto.js';
import { loadCachedFeeds } from './feed-cache.js';
import { MIN_DOCS_DEFAULT, trainFields } from './judge.js';
import { VerdictLog } from './log.js';
import { translate } from './locales.js';
import type { Locale } from './locales.js';
import { defaultRulePack } from './rules-default.js';
import { QuarantineStore } from './quarantine.js';
import type { QuarantineEntry } from './quarantine.js';
import { createRateLimiter } from './rate-limit.js';
import type { RateLimiter } from './rate-limit.js';
import { verifySubmission } from './gatekeeper.js';
import { issueStamp, stampFieldsHtml } from './stamp.js';
import { loadModel, saveModel } from './storage.js';
import type { Label, RulePack } from './types.js';
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
  /**
   * Directory with downloaded feed channels (feeds/*.json, from
   * `spamcha feed update`). Expired channels are skipped; signatures were
   * already verified at download time against the pinned key.
   */
  feedsDir?: string;
  /** Verdict log JSONL: every submission's outcome, for the panel. */
  logPath?: string;
  /** Single-use stamps (default true): replayed nonces get rejected in-memory. */
  singleUseStamps?: boolean;
  /** Truncate each field before judging (default 20.000 chars). */
  maxFieldLength?: number;
  /** Log rotation: keep only the newest N entries (default 1.000). */
  logMaxEntries?: number;
  /** Days an unconfirmed quarantined submission waits before being swept as
   *  presumed spam (default 7). The confirmation is the double-opt-in click
   *  that removes the human from the loop. */
  confirmTtlDays?: number;
  /** Weak-train clean passes as ham automatically. OFF by default: unknown
   *  spam can also pass on day 0, and training it as ham poisons the corpus.
   *  Enable once you trust the rules+feeds to catch most incoming slop. */
  autoHam?: boolean;
}

export interface ReviewMeta {
  /** Caller IP, for the rate limiter. */
  ip?: string;
  /** Server clock, injectable for tests. */
  now?: number;
  /** Request headers (lowercased) — for the experimental web-bot-auth gate. */
  headers?: Record<string, string>;
}

/** Loads downloaded channels; expired ones are skipped (signatures verified at download). */
function loadFeedChannels(dir: string | undefined) {
  return loadCachedFeeds(dir).channels;
}

export function createGatekeeper(config: GatekeeperConfig) {
  const locale: Locale | undefined = config.locale;
  const voice = (code: string): string => translate(code, { locale });

  let model: BayesModel = createModel();
  if (config.modelPath && existsSync(config.modelPath)) {
    model = loadModel(config.modelPath);
  }

  const replayCache = new Map<string, number>();
  const confirmTtlMs = (config.confirmTtlDays ?? 7) * 24 * 60 * 60 * 1000;
  const quarantine = config.quarantinePath ? new QuarantineStore(config.quarantinePath, confirmTtlMs) : null;
  const log = config.logPath ? new VerdictLog(config.logPath, config.logMaxEntries ?? 1_000) : null;
  const limiter: RateLimiter | null = config.rateLimit ? createRateLimiter(config.rateLimit) : null;

  /** Base pack (site's own, or the default) fused with downloaded feed channels. */
  const loadedChannels = loadFeedChannels(config.feedsDir);
  const effectivePack: RulePack | undefined = config.feedsDir
    ? mergeFeedChannels(config.rulePack ?? defaultRulePack, loadedChannels)
    : (config.rulePack ?? undefined);

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

    /** The downloaded feed channels in force (empty when feedsDir unset). */
    feeds: loadedChannels,

    /** The verdict log, if logPath was configured (the panel feeds on this). */
    log,

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

      const verdict = await verifySubmission(fields, model, {
    ...config,
    rulePack: effectivePack,
    now: meta.now,
    replayCache: config.singleUseStamps === false ? undefined : replayCache,
    maxFieldLength: config.maxFieldLength ?? 20_000,
  }, { headers: meta.headers });
      // auto-ham: a pass with zero fired rules is near-certainly real mail —
      // the site's own traffic builds the ham corpus without anyone clicking.
      if (config.autoHam === true && verdict.decision === 'pass' && verdict.rules === 0) {
        trainFields(model, stripOwnFields(fields), 'ham');
        if (config.modelPath) saveModel(model, config.modelPath);
      }
      let confirmToken: string | undefined;
      if (verdict.decision === 'quarantine' && quarantine) {
        // Double opt-in, sin humanos: el token permite al propio remitente
        // confirmar su mensaje (un clic — los bots no confirman enlaces).
        // La confirmación ENTREGA el mensaje; no entrena (poisoning vector).
        confirmToken = randomBase64Url(24);
        quarantine.add(stripOwnFields(fields), verdict, confirmToken);
      }
      if (verdict.decision === 'quarantine') {
        (verdict as SubmissionVerdict).confirmToken = confirmToken;
      }
      if (log) {
        const codes = [
          ...verdict.signals.map((s) => s.code),
          ...verdict.reasons.filter((r) => r.code.startsWith('rule:')).map((r) => r.code),
        ];
        log.add(stripOwnFields(fields), verdict, codes);
      }
      return verdict;
    },

    /** Pending held submissions (the review page feeds on this). */
    listQuarantine(): ReturnType<QuarantineStore['list']> {
      quarantine?.sweepExpired();
      return quarantine?.listPending() ?? [];
    },

    /** Confirmed (delivered) submissions, newest first. */
    listConfirmed(): ReturnType<QuarantineStore['listConfirmed']> {
      return quarantine?.listConfirmed() ?? [];
    },

    /**
     * Double opt-in sin humanos: el remitente confirma su mensaje con el
     * enlace (el sitio lo entrega por mail o lo muestra en su página de
     * gracias). Delivered ≠ trained: confirmar NO entrena ham (un spammer
     * con buzón monitorizado confirmaría — vector de envenenamiento).
     * Devuelve la entrada entregada, o null si el token no vale.
     */
    confirmSubmission(token: string): QuarantineEntry | null {
      if (!quarantine) return null;
      const entry = quarantine.findByToken(token);
      if (!entry) return null;
      quarantine.markConfirmed(entry.id);
      return entry;
    },

    /** Removes a held entry WITHOUT training (the plain "delete" button). */
    discardQuarantine(id: string): boolean {
      return quarantine?.resolve(id) ?? false;
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
  };
}

export type Gatekeeper = ReturnType<typeof createGatekeeper>;
