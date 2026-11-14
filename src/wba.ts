// web-bot-auth verifier: EXPERIMENTAL.
// Implements the Ed25519 profile of draft-ietf-webbotauth-httpsig-protocol
// (HTTP Message Signatures for automated traffic, IETF WG; authors
// Cloudflare + Google). A signed AI agent proves which operator runs it, so
// the gatekeeper can skip the stamp gates and let the judge score content.
//
//   Signature-Agent: "https://agent.example"
//   Signature-Input: webbotauth=("@authority");created=…;expires=…;keyid="…"
//   Signature: webbotauth:<base64url>
// Key directory: https://<agent>/.well-known/http-message-signatures-directory
//
// EXPERIMENTAL: the draft is a moving target (WG adopted 2026-10). The
// verifier covers the Ed25519 / @authority profile; treat breaking changes as
// expected until the draft becomes an RFC.

import { fromBase64, toBase64Url } from './crypto.js';

const ENCODER = new TextEncoder();

export interface WebBotAuthHeaders {
  'signature-agent'?: string;
  signature?: string;
  'signature-input'?: string;
}

export interface WbaOptions {
  /** The host this request targets (the @authority covered component). */
  authority: string;
  /** Signature younger than this (seconds) counts as fresh. Default 300. */
  maxAgeSeconds?: number;
  /** Server clock, injectable for tests. */
  now?: Date;
  /** Directory fetcher: injectable for tests; default: global fetch. */
  fetchDirectory?: (url: string) => Promise<unknown>;
}

export type WbaVerification =
  | { ok: true; agent: string }
  | { ok: false; reason: 'wba:absent' | 'wba:invalid' | 'wba:expired' | 'wba:unknown-agent' };

interface JwkOkp {
  kty?: string;
  crv?: string;
  alg?: string;
  x?: string;
  kid?: string;
}

/** Ed25519 public key (base64url raw) as an OKP JWK, for directory fixtures. */
export function jwkFromPublicB64url(publicKeyB64url: string, kid = 'default'): Record<string, string> {
  return { kty: 'OKP', crv: 'Ed25519', alg: 'Ed25519', x: publicKeyB64url, kid };
}

async function importPublicJwk(jwk: JwkOkp) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x: jwk.x } as never,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
}

/** Parses `webbotauth=("@authority");created=…;keyid="…" → {components, params, keyid?}` */
export function parseSignatureInput(raw: string | undefined): { components: string; params: string; keyid?: string } | null {
  if (!raw) return null;
  const match = raw.match(/webbotauth\s*=\s*\(([^)]*)\);(.*)$/);
  if (!match) return null;
  const [, components, params] = match;
  const keyid = params.match(/keyid\s*=\s*"([^"]+)"/)?.[1];
  return { components: components.trim(), params: params.trim(), keyid };
}

export async function verifyWebBotAuth(
  headers: WebBotAuthHeaders,
  options: WbaOptions,
): Promise<WbaVerification> {
  const agent = headers['signature-agent']?.replace(/^"|"$/g, '');
  if (!agent || !headers.signature || !headers['signature-input']) {
    return { ok: false, reason: 'wba:absent' };
  }
  // SSRF guard: the directory fetch goes where the ATTACKER says: https only.
  if (!agent.startsWith('https://')) {
    return { ok: false, reason: 'wba:invalid' };
  }

  const parsed = parseSignatureInput(headers['signature-input']);
  if (!parsed || !parsed.components.includes('@authority')) {
    return { ok: false, reason: 'wba:invalid' };
  }

  const now = options.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const created = Number(parsed.params.match(/created\s*=\s*(\d+)/)?.[1]);
  const expires = Number(parsed.params.match(/expires\s*=\s*(\d+)/)?.[1]);
  const maxAge = options.maxAgeSeconds ?? 300;
  if (!Number.isFinite(created) || nowSec - created > maxAge) return { ok: false, reason: 'wba:expired' };
  if (Number.isFinite(expires) && nowSec >= expires) return { ok: false, reason: 'wba:expired' };

  const directoryUrl = `${agent.replace(/\/$/, '')}/.well-known/http-message-signatures-directory`;
  let directory: unknown;
  try {
    directory = options.fetchDirectory
      ? await options.fetchDirectory(directoryUrl)
      : await fetch(directoryUrl).then((r) => r.json());
  } catch {
    return { ok: false, reason: 'wba:unknown-agent' };
  }
  const keys = ((directory as { keys?: JwkOkp[] })?.keys ?? []).filter((k) => k.crv === 'Ed25519' || k.alg === 'Ed25519');
  const jwk = parsed.keyid ? keys.find((k) => k.kid === parsed.keyid) ?? keys[0] : keys[0];
  if (!jwk?.x) return { ok: false, reason: 'wba:unknown-agent' };

  // RFC 9421 signature base for the covered @authority component:
  const base = `"@authority": ${options.authority}\n"@signature-params": ${parsed.params}`;
  try {
    const key = await importPublicJwk(jwk);
    const signatureBytes = fromBase64(headers.signature.replace(/^webbotauth:/, ''));
    const valid = await crypto.subtle.verify('Ed25519', key, signatureBytes, ENCODER.encode(base));
    if (!valid) return { ok: false, reason: 'wba:invalid' };
  } catch {
    return { ok: false, reason: 'wba:invalid' };
  }
  return { ok: true, agent };
}

/** Convenience for producers/tests: signs a base string with a raw public-format key. */
export { toBase64Url };
