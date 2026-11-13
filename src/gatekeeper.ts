// The gatekeeper: the full pipeline for one form submission.
// GATES (any failure → instant reject, nothing else runs):
//   1. signed, unexpired stamp (HMAC + server clock)
//   2. time floor: issued→received ≥ minAge (unfakeable)
//   3. honeypot present and empty (its absence = POST without rendering)
// Past the gates, the judge (rules + bayes) reads the content.
// It accepts EVERY field of the form as they arrive — that's the point: a
// middleware hands it the body and it just works.

import type { BayesModel } from './bayes.js';
import { judge } from './judge.js';
import { translate } from './locales.js';
import { verifyStamp } from './stamp.js';
import type { VerifyStampOptions } from './stamp.js';
import type { JudgeOptions, Reason, Verdict } from './types.js';

const MIN_DOCS_DEFAULT = 5;

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
}

export interface SubmissionVerdict extends Verdict {
  /** Reasons from the silent signals (stamp, honeypot, timing). */
  signals: Reason[];
}

function phaseOf(model: BayesModel, minDocs?: number): 'cold' | 'trained' {
  const threshold = minDocs ?? MIN_DOCS_DEFAULT;
  return model.docs.spam >= threshold && model.docs.ham >= threshold ? 'trained' : 'cold';
}

export async function verifySubmission(
  fields: Record<string, string>,
  model: BayesModel,
  options: GatekeeperOptions,
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

  // Gates 1+2: signed stamp, unexpired, with human time since issue.
  const stampCheck = await verifyStamp(fields[stampField], options.secret, {
    formId: options.formId,
    minAgeMs: options.minAgeMs,
    now: options.now,
  } satisfies VerifyStampOptions);
  if (!stampCheck.ok) {
    return quickReject({ code: stampCheck.reason, text: voice(stampCheck.reason) });
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
