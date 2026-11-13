// ALTCHA adapter: the plug into the PoW layer. The ALTCHA widget solves the
// challenge and posts its solution; this verifies it against your secret,
// without altcha-lib and without ALTCHA's servers. Format per altcha-lib
// (verifySolution):
// token = base64(JSON { algorithm, challenge, number, salt, signature })
//   signature = HMAC-SHA256(secret, challenge)      → the challenge is yours
//   challenge = SHA-256(salt + number)              → the bot actually solved it
//   (if the salt embeds ExpiresAt, checked against your clock)

import { constantTimeEquals, fromBase64, digestHex, hmacHex } from './crypto.js';

export interface AltchaPayload {
  algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512';
  challenge: string;
  number: number;
  salt: string;
  signature: string;
  took?: number;
}

export type AltchaVerification =
  | { ok: true }
  | { ok: false; reason: 'altcha:invalid' | 'altcha:unsolved' | 'altcha:expired' };

export interface AltchaOptions {
  now?: number;
}

export async function verifyAltchaSolution(
  token: string | undefined,
  secret: string,
  options: AltchaOptions = {},
): Promise<AltchaVerification> {
  if (!token || token.length === 0) return { ok: false, reason: 'altcha:invalid' };

  let payload: AltchaPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64(token))) as AltchaPayload;
  } catch {
    return { ok: false, reason: 'altcha:invalid' };
  }
  if (
    !payload ||
    typeof payload.challenge !== 'string' ||
    typeof payload.salt !== 'string' ||
    typeof payload.number !== 'number' ||
    typeof payload.signature !== 'string'
  ) {
    return { ok: false, reason: 'altcha:invalid' };
  }

  const signature = await hmacHex(secret, payload.challenge);
  if (!constantTimeEquals(payload.signature, signature)) return { ok: false, reason: 'altcha:invalid' };

  const solved = await digestHex(payload.algorithm, payload.salt + payload.number);
  if (!constantTimeEquals(payload.challenge, solved)) return { ok: false, reason: 'altcha:unsolved' };

  // altcha-lib embeds expiry in the salt: base64 of JSON { ExpiresAt: ms }
  if (payload.salt.length > 0 && !payload.salt.includes(' ')) {
    try {
      const raw = JSON.parse(new TextDecoder().decode(fromBase64(payload.salt))) as { ExpiresAt?: number };
      if (typeof raw?.ExpiresAt === 'number' && (options.now ?? Date.now()) >= raw.ExpiresAt) {
        return { ok: false, reason: 'altcha:expired' };
      }
    } catch {
      // plain salt: nothing to check
    }
  }

  return { ok: true };
}
