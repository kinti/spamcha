// Feed channels, the OpenWRT-feeds pattern applied to spam intelligence:
// signed JSON files at a URL, pulled with `spamcha feed update`, verified
// against a locally-pinned Ed25519 public key, merged into the judge's pack.
//
// What travels: curated RULES and spam LINK DOMAINS — knowledge of the guild,
// never user data, never bayes counts, never content. That's the line between
// "local learning" and "isolated learning" (see README, what goes public).

import { fromBase64, toBase64Url } from './crypto.js';
import type { Rule, RulePack } from './types.js';

export interface FeedChannel {
  /** Channel name, e.g. `oficial/es`. */
  channel: string;
  /** Monotonic: receivers ignore anything not newer than what they have. */
  version: number;
  updatedAt: string;
  /** Feeds expire on purpose — stale intel poisons judges. */
  expiresAt: string;
  description?: string;
  /** Curated rules; ids get the `feed:<channel>:` prefix on merge. */
  rules: Rule[];
  /** Spam link domains (registrable, lowercase). One generated rule each channel. */
  domains?: string[];
  /** `ed25519:<base64url>` over the canonical JSON of everything above. */
  signature: string;
}

export type FeedToSign = Omit<FeedChannel, 'signature'>;

// ─── Canonical serialization ────────────────────────────────────────────────
// Signatures only hold if signer and verifier serialize identically:
// sorted keys, no undefined, stable numbers.

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
}

// ─── Ed25519 keys and signatures (WebCrypto; server-side runtime) ──────────

const ENCODER = new TextEncoder();

type KeyPair = {
  privateKey: Parameters<typeof crypto.subtle.exportKey>[1];
  publicKey: Parameters<typeof crypto.subtle.exportKey>[1];
};

export async function generateFeedKeyPair(): Promise<{ private: string; public: string }> {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as unknown as KeyPair;
  const privateBytes = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
  const publicBytes = await crypto.subtle.exportKey('raw', keys.publicKey);
  return { private: toBase64Url(new Uint8Array(privateBytes)), public: toBase64Url(new Uint8Array(publicBytes)) };
}

async function importPrivate(base64url: string) {
  return crypto.subtle.importKey('pkcs8', fromBase64(base64url), { name: 'Ed25519' }, false, ['sign']);
}

async function importPublic(base64url: string) {
  return crypto.subtle.importKey('raw', fromBase64(base64url), { name: 'Ed25519' }, false, ['verify']);
}

/** Signs a channel (adds the `signature` field) with a private key (base64url PKCS#8). */
export async function signFeed(channel: FeedToSign, privateKeyB64url: string): Promise<FeedChannel> {
  const key = await importPrivate(privateKeyB64url);
  const data = ENCODER.encode(canonical(channel));
  const firma = await crypto.subtle.sign('Ed25519', key, data);
  return { ...channel, signature: 'ed25519:' + toBase64Url(new Uint8Array(firma)) };
}

export type FeedVerification =
  | { ok: true }
  | { ok: false; reason: 'feed:invalid' | 'feed:unsigned' | 'feed:bad-signature' | 'feed:expired' };

/** Verifies signature (against the pinned public key, if any) and expiry, against your clock. */
export async function verifyFeed(
  channel: FeedChannel,
  publicKeyB64url: string | undefined,
  options: { now?: Date } = {},
): Promise<FeedVerification> {
  if (!channel || typeof channel.channel !== 'string' || !Array.isArray(channel.rules)) {
    return { ok: false, reason: 'feed:invalid' };
  }
  const { signature, ...rest } = channel;
  if (publicKeyB64url) {
    if (!signature || !signature.startsWith('ed25519:')) {
      return { ok: false, reason: 'feed:unsigned' };
    }
    const key = await importPublic(publicKeyB64url);
    const signatureBytes = fromBase64(signature.slice('ed25519:'.length));
    const valid = await crypto.subtle.verify('Ed25519', key, signatureBytes, ENCODER.encode(canonical(rest)));
    if (!valid) return { ok: false, reason: 'feed:bad-signature' };
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(Date.parse(channel.expiresAt)) || now >= new Date(channel.expiresAt)) {
    return { ok: false, reason: 'feed:expired' };
  }
  return { ok: true };
}

// ─── Merge: base pack + channels → the effective pack ──────────────────────

const DOMAINS_WEIGHT = 5; // a curated domain quarantines alone (reviewable, never auto-reject)
// A feed channel is EXTERNAL input even when signed: sanitize everything.
// Defense in depth — the signature authenticates the producer, not their care.
const MAX_RULES_PER_CHANNEL = 100;
const MAX_PATTERN_LENGTH = 500;
const MAX_WEIGHT = 6;

/** Validates and clamps a channel rule: compiles, bounded, sane numbers. */
function safeRule(channelName: string, raw: Rule): Rule | null {
  const cleanId = String(raw.id ?? '').replace(/[^a-z0-9/_-]/gi, '');
  if (!cleanId) return null;
  if (typeof raw.pattern !== 'string' || raw.pattern.length === 0 || raw.pattern.length > MAX_PATTERN_LENGTH) return null;
  const type = raw.type === 'count' || raw.type === 'ratio' || raw.type === 'density' ? raw.type : null;
  if (!type) return null;
  const threshold = Number(raw.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  // ReDoS guard: a quantifier immediately before `)` (nested quantifiers like
  // (a+)+) is the classic catastrophic-backtracking shape. Compile check too.
  if (/[+*}]\s*\)/.test(raw.pattern)) return null;
  try {
    new RegExp(raw.pattern, raw.flags ?? 'gu'); // must compile, or the judge would throw per submission
  } catch {
    return null;
  }
  return {
    id: `feed:${channelName}:${cleanId}`,
    type,
    pattern: raw.pattern,
    flags: raw.flags,
    threshold,
    field: typeof raw.field === 'string' && raw.field.length <= 64 ? raw.field : undefined,
    minLength: Number.isFinite(raw.minLength) && (raw.minLength as number) > 0 ? raw.minLength : undefined,
    weight: Math.min(MAX_WEIGHT, Math.max(1, Math.round(Number(raw.weight) || 1))),
    description: typeof raw.description === 'string' ? raw.description.slice(0, 200) : undefined,
  };
}

/** Turns a channel's domain list into one rule (escaped alternation, substring match). */
function domainRule(channelName: string, domains: string[]): Rule | null {
  const clean = domains
    .map((d) => d.trim().toLowerCase().replace(/\.$/, ''))
    .filter((d) => d.length > 0 && /^[a-z0-9.-]+$/.test(d))
    .slice(0, MAX_RULES_PER_CHANNEL);
  if (clean.length === 0) return null;
  return {
    id: `feed:${channelName}:domains`,
    type: 'count',
    pattern: clean.map((d) => d.replace(/\./g, '\\.')).join('|'),
    flags: 'gi',
    threshold: 1,
    weight: DOMAINS_WEIGHT,
  };
}

/**
 * Merges the site's base pack with verified feed channels. Feed rule ids get
 * prefixed `feed:<channel>:` so a quarantine reason always says who sent it.
 * Every channel rule passes `safeRule`: a signed but sloppy channel must not
 * break the judge (uncompilable regex), slow it down (ReDoS) or pin every
 * submission to reject (unbounded weight).
 */
export function mergeFeedChannels(base: RulePack, channels: FeedChannel[]): RulePack {
  const rules: Rule[] = [...base.rules];
  for (const ch of channels) {
    const channelName = ch.channel.replace(/[^a-z0-9/_-]/gi, '');
    for (const raw of ch.rules.slice(0, MAX_RULES_PER_CHANNEL)) {
      const rule = safeRule(channelName, raw);
      if (rule) rules.push(rule);
    }
    const domainsRule = domainRule(channelName, ch.domains ?? []);
    if (domainsRule) rules.push(domainsRule);
  }
  return { name: base.name + (channels.length > 0 ? ` +${channels.length} feed(s)` : ''), rules };
}
