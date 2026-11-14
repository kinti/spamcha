import { describe, expect, it } from 'vitest';
import { generateFeedKeyPair } from '../src/feed.js';
import { jwkFromPublicB64url, parseSignatureInput, verifyWebBotAuth } from '../src/wba.js';
import { toBase64Url } from '../src/crypto.js';

// Ed25519 sign helper over the RFC 9421 signature base.
async function signBase(privateKeyB64url: string, base: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', toB64(privateKeyB64url), { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(base));
  return toBase64Url(new Uint8Array(sig));
}
function toB64(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

const AUTHORITY = 'mipagina.es';
const NOW = new Date('2026-11-14T12:00:00Z');
const created = Math.floor(NOW.getTime() / 1000);

async function buildHeaders(privateKey: string, overrides: Partial<{ created: number; expires: number | null; authority: string; agent: string }> = {}) {
  const keys = privateKey ? { private: privateKey } : await generateFeedKeyPair();
  const c = overrides.created ?? created;
  const params = `("@authority");created=${c}${overrides.expires === null ? '' : `;expires=${overrides.expires ?? c + 600}`};keyid="test"`;
  const input = `webbotauth=("@authority");${params}`;
  const base = `"@authority": ${overrides.authority ?? AUTHORITY}\n"@signature-params": ${params}`;
  const sig = await signBase(keys.private, base);
  return {
    headers: {
      'signature-agent': overrides.agent ?? 'https://agent.example',
      'signature-input': input,
      signature: `webbotauth:${sig}`,
    },
    keys,
  };
}

describe('web-bot-auth verifier (experimental)', () => {
  it('verifies a well-formed signed agent', async () => {
    const keys = await generateFeedKeyPair();
    const { headers } = await buildHeaders(keys.private);
    const v = await verifyWebBotAuth(headers, {
      authority: AUTHORITY,
      now: NOW,
      fetchDirectory: async () => ({ keys: [jwkFromPublicB64url(keys.public, 'test')] }),
    });
    expect(v).toEqual({ ok: true, agent: 'https://agent.example' });
  });

  it('rejects a signature over a different authority', async () => {
    const keys = await generateFeedKeyPair();
    const { headers } = await buildHeaders(keys.private, { authority: 'otrapagina.es' });
    const v = await verifyWebBotAuth(headers, {
      authority: AUTHORITY,
      now: NOW,
      fetchDirectory: async () => ({ keys: [jwkFromPublicB64url(keys.public, 'test')] }),
    });
    expect(v).toEqual({ ok: false, reason: 'wba:invalid' });
  });

  it('rejects unknown agents (directory unreachable)', async () => {
    const keys = await generateFeedKeyPair();
    const { headers } = await buildHeaders(keys.private, { agent: 'https://desconocido.example' });
    const v = await verifyWebBotAuth(headers, {
      authority: AUTHORITY,
      now: NOW,
      fetchDirectory: async () => { throw new Error('dns fail'); },
    });
    expect(v).toEqual({ ok: false, reason: 'wba:unknown-agent' });
  });

  it('rejects stale signatures', async () => {
    const keys = await generateFeedKeyPair();
    const { headers } = await buildHeaders(keys.private, { created: created - 3_600 });
    const v = await verifyWebBotAuth(headers, {
      authority: AUTHORITY,
      now: NOW,
      fetchDirectory: async () => ({ keys: [jwkFromPublicB64url(keys.public, 'test')] }),
    });
    expect(v).toEqual({ ok: false, reason: 'wba:expired' });
  });

  it('http:// agents are rejected (SSRF guard)', async () => {
    const keys = await generateFeedKeyPair();
    const { headers } = await buildHeaders(keys.private, { agent: 'http://interno.local' });
    const v = await verifyWebBotAuth(headers, {
      authority: AUTHORITY,
      now: NOW,
      fetchDirectory: async () => { throw new Error('NO DEBE LLEGAR A FETCH'); },
    });
    expect(v).toEqual({ ok: false, reason: 'wba:invalid' });
  });

  it('absent headers → wba:absent', async () => {
    const keys = await generateFeedKeyPair();
    const v = await verifyWebBotAuth({}, {
      authority: AUTHORITY,
      now: NOW,
      fetchDirectory: async () => ({ keys: [jwkFromPublicB64url(keys.public, 'test')] }),
    });
    expect(v).toEqual({ ok: false, reason: 'wba:absent' });
  });

  it('parseSignatureInput extracts components, params and keyid', () => {
    const parsed = parseSignatureInput('webbotauth=("@authority");created=1700000000;expires=1700000600;keyid="test"');
    expect(parsed?.components).toBe('"@authority"');
    expect(parsed?.params).toContain('created=1700000000');
    expect(parsed?.keyid).toBe('test');
    expect(parseSignatureInput('otracosa=("@authority")')).toBeNull();
  });
});
