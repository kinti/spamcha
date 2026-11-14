// The gatekeeper: the full pipeline for one form submission.
// GATES (any failure → instant reject, nothing else runs):
//   0. web-bot-auth (EXPERIMENTAL, optional): a request signed by a known AI
//      agent skips the stamp gates: content still gets judged.
//   1. signed, unexpired stamp (HMAC + server clock)
//   2. time floor: issued→received ≥ minAge (unfakeable)
//   3. honeypot present and empty (its absence = POST without rendering)
// Past the gates, the judge (rules + bayes) reads the content.
// It accepts EVERY field of the form as they arrive: that's the point: a
// middleware hands it the body and it just works.

import type { BayesModel } from './bayes.js';
import { judge } from './judge.js';
import { MIN_DOCS_DEFAULT } from './judge.js';
import { translate } from './locales.js';
import { verifyStamp } from './stamp.js';
import type { VerifyStampOptions } from './stamp.js';
import { verifyWebBotAuth } from './wba.js';
import type { WebBotAuthHeaders } from './wba.js';
import type { JudgeOptions, Reason, Verdict } from './types.js';

export interface GatekeeperOptions extends JudgeOptions {
  /** Site HMAC secret. Long and random: a whole sentence works. */
  secret: string;
  /** Minimum ms between issue and submission (default 3.000). */
  minAgeMs?: number;
  /** Stamp field name (default `spamcha`). */
  stampField?: string;
  /** Honeypot field name (default `website`). */
  honeypotField?: string;
  /** Demand the honeypot exists even if empty (default true). */
  requireHoneypot?: boolean;
  /** Expected form id, if the stamp was bound to one. */
  formId?: string;
  /** Server clock, injectable for tests. */
  now?: number;
  /**
   * web-bot-auth (EXPERIMENTAL, draft-ietf-webbotauth): a request carrying a
   * valid agent signature skips the stamp gates: the judge still reads the
   * content. `authority` defaults to the request's Host header.
   */
  webBotAuth?: { authority?: string; maxAgeSeconds?: number; fetchDirectory?: (url: string) => Promise<unknown> };
  /** Replay cache: seen stamp nonces get rejected until their stamp expires.
   *  The guard provides its in-memory map; without it stamps are reusable. */
  replayCache?: Map<string, number>;
  /** Truncate each field to this many characters before judging (DoS bound). */
  maxFieldLength?: number;
  /** Fires when a submission is held in quarantine (webhook for owner
   *  notification: mail digests, chats, automations). Failures are swallowed:
   *  a broken notification never changes a verdict. */
  notify?: (event: QuarantineNotification) => void | Promise<void>;
}

export interface QuarantineNotification {
  /** The judged fields (stamp and honeypot stripped out). */
  fields: Record<string, string>;
  verdict: SubmissionVerdict;
  /** The confirmation token, so the notification can carry a one-click
   *  "this was me, deliver it" link for the sender. */
  confirmToken?: string;
}

export interface SubmissionVerdict extends Verdict {
  /** Reasons from the silent signals (agent, stamp, honeypot, timing). */
  signals: Reason[];
  /** Confirmation token for held submissions (double opt-in): the site puts
   *  the link in front of the sender; confirming delivers the message. */
  confirmToken?: string;
}

export interface VerifySubmissionMeta {
  /** Request headers (lowercased, as Node provides them): for web-bot-auth. */
  headers?: Record<string, string>;
}

function phaseOf(model: BayesModel, minDocs?: number): 'cold' | 'trained' {
  const threshold = minDocs ?? MIN_DOCS_DEFAULT;
  return model.docs.spam >= threshold && model.docs.ham >= threshold ? 'trained' : 'cold';
}

export async function verifySubmission(
  fields: Record<string, string>,
  model: BayesModel,
  options: GatekeeperOptions,
  meta: VerifySubmissionMeta = {},
): Promise<SubmissionVerdict> {
  const stampField = options.stampField ?? 'spamcha';
  const honeypotField = options.honeypotField ?? 'website';
  const signals: Reason[] = [];
  const voice = (code: string): string => translate(code, { locale: options.locale });

  const quickReject = (reason: Reason): SubmissionVerdict => ({
    decision: 'reject',
    probability: 1,
    bayes: null,
    rules: 0,
    phase: phaseOf(model, options.minDocs),
    reasons: [],
    signals: [...signals, reason],
    meta: { tokens: 0, fields: Object.keys(fields).length },
  });

  // Gate 0 (EXPERIMENTAL): web-bot-auth. A request signed by a known AI agent
  // proves its operator: the stamp gates exist to make agents prove exactly
  // that, so a valid signature replaces them. The judge still scores content.
  if (options.webBotAuth) {
    const headers: WebBotAuthHeaders = {
      'signature-agent': meta.headers?.['signature-agent'],
      signature: meta.headers?.['signature'],
      'signature-input': meta.headers?.['signature-input'],
    };
    if (headers['signature-agent']) {
      const authority = options.webBotAuth.authority ?? meta.headers?.['host'] ?? '';
      const wba = await verifyWebBotAuth(headers, {
        authority,
        maxAgeSeconds: options.webBotAuth.maxAgeSeconds,
        fetchDirectory: options.webBotAuth.fetchDirectory,
        now: options.now !== undefined ? new Date(options.now) : undefined,
      });
      if (!wba.ok) {
        return quickReject({ code: wba.reason, text: voice(wba.reason) });
      }
      signals.push({ code: 'wba:verified', text: voice('wba:verified'), detail: wba.agent });
    }
  }

  if (!signals.some((s) => s.code === 'wba:verified')) {
    // Gates 1+2: signed stamp, unexpired, with human time since issue.
    const stampCheck = await verifyStamp(fields[stampField], options.secret, {
      formId: options.formId,
      minAgeMs: options.minAgeMs,
      now: options.now,
    } satisfies VerifyStampOptions);
    if (!stampCheck.ok) {
      return quickReject({ code: stampCheck.reason, text: voice(stampCheck.reason) });
    }
    // Gate 2½: replay. The nonce is random but reusable until the stamp expires:
    // a replay cache turns the stamp into single-use while it lives.
    if (options.replayCache) {
      const nonce = stampCheck.payload.n;
      const cache = options.replayCache;
      const nowMs = options.now ?? Date.now();
      for (const [seen, expiry] of cache) {
        if (nowMs >= expiry) cache.delete(seen);
      }
      if (cache.has(nonce)) {
        return quickReject({ code: 'stamp:replayed', text: voice('stamp:replayed') });
      }
      cache.set(nonce, stampCheck.payload.e);
    }
    signals.push({ code: 'stamp:valid', text: voice('stamp:valid') });

    // Gate 3: honeypot. If the whole field is missing, nobody rendered the page.
    const honeypot = fields[honeypotField];
    if (honeypot !== undefined && honeypot.trim().length > 0) {
      return quickReject({
        code: 'honeypot:filled',
        text: voice('honeypot:filled'),
        field: honeypotField,
        detail: honeypot.slice(0, 80),
      });
    }
    if (honeypot === undefined && (options.requireHoneypot ?? true)) {
      return quickReject({ code: 'honeypot:missing', text: voice('honeypot:missing'), field: honeypotField });
    }
    signals.push({ code: 'honeypot:empty', text: voice('honeypot:empty') });

    // Content: the judge decides over the remaining fields.
    const rest: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k !== stampField && k !== honeypotField) rest[k] = v;
    }
    const verdict = judge(rest, model, options);
    return { ...verdict, signals };
  }

  // Trusted-agent path: judge the content, keep the verified-agent signal.
  const rest: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k !== stampField && k !== honeypotField) rest[k] = v;
  }
  const verdict = judge(rest, model, options);
  return { ...verdict, signals };
}
