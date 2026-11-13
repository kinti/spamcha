// The stamp: an HMAC-SHA256-signed envelope the server hands out when rendering
// the form and demands back when the submission arrives. Format:
// `payloadB64url.signatureB64url` (hand-rolled JWT-lite, zero dependencies).
//
// The time floor lives HERE and is unfakeable: the issue timestamp is INSIDE
// the signature, so the server compares against its own clock on arrival.
// A bot that solves in 2 seconds stands naked with zero client cooperation —
// which is exactly how real spam works (POST straight at the handler).

import { toBase64Url, randomBase64Url, constantTimeEquals, fromBase64, hmacHex } from './crypto.js';

export interface StampPayload {
  v: 1;
  /** Form id, if the stamp is bound to one specific form. */
  f?: string;
  /** Issued at (epoch ms). */
  i: number;
  /** Expires at (epoch ms). */
  e: number;
  /** Random nonce. */
  n: string;
}

export type StampReason =
  | 'stamp:missing'
  | 'stamp:invalid'
  | 'stamp:expired'
  | 'stamp:wrong-form'
  | 'time:too-fast';

export type StampVerification = { ok: true; payload: StampPayload } | { ok: false; reason: StampReason };

export interface VerifyStampOptions {
  formId?: string;
  /** Minimum ms between issue and submission (the time floor). Default 3.000. */
  minAgeMs?: number;
  /** Server clock, injectable for tests. */
  now?: number;
}

export interface IssueStampOptions {
  formId?: string;
  /** Stamp lifetime (default 30 minutes). */
  ttlMs?: number;
  now?: number;
}

const DEFAULT_TTL = 30 * 60_000;
const DEFAULT_MIN_AGE = 3_000;

/** Issues a signed stamp to embed in the form at render time. */
export async function issueStamp(secret: string, options: IssueStampOptions = {}): Promise<string> {
  const now = options.now ?? Date.now();
  const payload: StampPayload = {
    v: 1,
    ...(options.formId ? { f: options.formId } : {}),
    i: now,
    e: now + (options.ttlMs ?? DEFAULT_TTL),
    n: randomBase64Url(),
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacHex(secret, body);
  return `${body}.${signature}`;
}

/**
 * Verifies a stamp against the server clock: valid signature, not expired,
 * right form and, if demanded, minimum human time since issue.
 */
export async function verifyStamp(
  token: string | undefined,
  secret: string,
  options: VerifyStampOptions = {},
): Promise<StampVerification> {
  if (!token || token.length === 0) return { ok: false, reason: 'stamp:missing' };

  const dot = token.indexOf('.');
  if (dot < 0) return { ok: false, reason: 'stamp:invalid' };
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = await hmacHex(secret, body);
  if (!constantTimeEquals(signature, expected)) return { ok: false, reason: 'stamp:invalid' };

  let payload: StampPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64(body))) as StampPayload;
  } catch {
    return { ok: false, reason: 'stamp:invalid' };
  }
  if (!payload || typeof payload !== 'object' || typeof payload.i !== 'number' || typeof payload.e !== 'number') {
    return { ok: false, reason: 'stamp:invalid' };
  }

  const now = options.now ?? Date.now();
  if (now >= payload.e) return { ok: false, reason: 'stamp:expired' };
  if (options.formId !== undefined && payload.f !== options.formId) {
    return { ok: false, reason: 'stamp:wrong-form' };
  }
  if (now - payload.i < (options.minAgeMs ?? DEFAULT_MIN_AGE)) {
    return { ok: false, reason: 'time:too-fast' };
  }
  return { ok: true, payload };
}

/** The two hidden fields, ready to embed in the form HTML. */
export function stampFieldsHtml(
  token: string,
  options: { stampField?: string; honeypotField?: string } = {},
): string {
  const stampField = options.stampField ?? 'spamcha';
  const honeypotField = options.honeypotField ?? 'website';
  return (
    `<input type="hidden" name="${stampField}" value="${token}">` +
    `<input type="text" name="${honeypotField}" value="" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">`
  );
}
