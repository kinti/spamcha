import { describe, expect, it } from 'vitest';
import { verifyAltchaSolution } from '../src/altcha.js';
import { toBase64Url, digestHex, hmacHex } from '../src/crypto.js';

const SECRET = 'secret-shared-with-the-altcha-challenge';

/** Replicates what the ALTCHA server does when creating the challenge, for test solutions. */
async function createSolution(
  options: { salt?: string; number?: number; algorithm?: 'SHA-256' | 'SHA-384' | 'SHA-512'; expires?: number } = {},
): Promise<string> {
  const salt = options.expires !== undefined
    ? toBase64Url(new TextEncoder().encode(JSON.stringify({ ExpiresAt: options.expires })))
    : options.salt ?? 'test-salt';
  const number = options.number ?? 12345;
  const algorithm = options.algorithm ?? 'SHA-256';
  const challenge = await digestHex(algorithm, salt + number);
  const signature = await hmacHex(SECRET, challenge);
  return toBase64Url(new TextEncoder().encode(JSON.stringify({ algorithm, challenge, number, salt, signature })));
}

describe('ALTCHA adapter', () => {
  it('verifies a legitimate solution', async () => {
    const v = await verifyAltchaSolution(await createSolution(), SECRET);
    expect(v).toEqual({ ok: true });
  });

  it('accepts the three algorithms of the ALTCHA ecosystem', async () => {
    for (const algorithm of ['SHA-256', 'SHA-384', 'SHA-512'] as const) {
      const v = await verifyAltchaSolution(await createSolution({ algorithm }), SECRET);
      expect(v).toEqual({ ok: true });
    }
  });

  it('another secret invalidates the challenge signature', async () => {
    const v = await verifyAltchaSolution(await createSolution(), 'other-secret');
    expect(v).toEqual({ ok: false, reason: 'altcha:invalid' });
  });

  it('a wrong number is an unsolved challenge', async () => {
    const solution = await createSolution({ number: 999 });
    // We change the declared number: the signature still holds but the hash mismatches.
    const payload = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(solution.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    )) as { number: number };
    payload.number = 1;
    const tampered = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const v = await verifyAltchaSolution(tampered, SECRET);
    expect(v).toEqual({ ok: false, reason: 'altcha:unsolved' });
  });

  it('respects the expiry embedded in the salt', async () => {
    const old = await verifyAltchaSolution(await createSolution({ expires: Date.now() - 1_000 }), SECRET);
    expect(old).toEqual({ ok: false, reason: 'altcha:expired' });
    const fresh = await verifyAltchaSolution(await createSolution({ expires: Date.now() + 60_000 }), SECRET);
    expect(fresh).toEqual({ ok: true });
  });

  it('missing or garbage tokens get rejected', async () => {
    expect(await verifyAltchaSolution(undefined, SECRET)).toEqual({ ok: false, reason: 'altcha:invalid' });
    expect(await verifyAltchaSolution('not-valid-base64!!!', SECRET)).toEqual({ ok: false, reason: 'altcha:invalid' });
  });
});
