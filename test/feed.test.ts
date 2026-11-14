import { describe, expect, it } from 'vitest';
import {
  canonical,
  createModel,
  generateFeedKeyPair,
  judge,
  mergeFeedChannels,
  signFeed,
  verifyFeed,
} from '../src/index.js';
import { tokenize } from '../src/tokenizer.js';
import { train } from '../src/bayes.js';
import type { FeedChannel, FeedToSign } from '../src/feed.js';

function canalBase(): FeedToSign {
  return {
    channel: 'oficial/es',
    version: 1,
    updatedAt: '2026-11-14T00:00:00Z',
    expiresAt: '2027-05-13T00:00:00Z',
    description: 'canal de prueba',
    rules: [{ id: 'seo-slop', type: 'count', pattern: 'backlinks\\s+premium', threshold: 1, weight: 3, description: 'canal de prueba' }],
    domains: ['slop.example', 'pillshop.icu'],
  };
}

describe('feed channels', () => {
  it('canonical serialization ignores key order', () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });

  it('sign and verify: an intact channel passes', async () => {
    const keys = await generateFeedKeyPair();
    const firmado = await signFeed(canalBase(), keys.private);
    expect(firmado.signature.startsWith('ed25519:')).toBe(true);
    const v = await verifyFeed(firmado, keys.public, { now: new Date('2026-11-14') });
    expect(v).toEqual({ ok: true });
  });

  it('a tampered channel fails the signature', async () => {
    const keys = await generateFeedKeyPair();
    const firmado = await signFeed(canalBase(), keys.private);
    const manipulado: FeedChannel = { ...firmado, version: firmado.version + 1 };
    const v = await verifyFeed(manipulado, keys.public, { now: new Date('2026-11-14') });
    expect(v).toEqual({ ok: false, reason: 'feed:firma-invalida' });
  });

  it('another key cannot validate a channel', async () => {
    const keys = await generateFeedKeyPair();
    const otras = await generateFeedKeyPair();
    const firmado = await signFeed(canalBase(), keys.private);
    const v = await verifyFeed(firmado, otras.public, { now: new Date('2026-11-14') });
    expect(v).toEqual({ ok: false, reason: 'feed:firma-invalida' });
  });

  it('an unsigned channel with a pinned key is rejected', async () => {
    const keys = await generateFeedKeyPair();
    const sinFirma: FeedChannel = { ...canalBase(), signature: '' };
    const v = await verifyFeed(sinFirma, keys.public, { now: new Date('2026-11-14') });
    expect(v).toEqual({ ok: false, reason: 'feed:sin-firma' });
  });

  it('expired channels are rejected even with a good signature', async () => {
    const keys = await generateFeedKeyPair();
    const viejo = await signFeed({ ...canalBase(), expiresAt: '2026-01-01T00:00:00Z' }, keys.private);
    const v = await verifyFeed(viejo, keys.public, { now: new Date('2026-11-14') });
    expect(v).toEqual({ ok: false, reason: 'feed:caducado' });
  });

  it('a shapeless channel is invalid', async () => {
    const keys = await generateFeedKeyPair();
    const v = await verifyFeed({ channel: 'x' } as unknown as FeedChannel, keys.public, { now: new Date('2026-11-14') });
    expect(v).toEqual({ ok: false, reason: 'feed:invalido' });
  });

  it('merge prefixes feed rule ids and turns domains into a rule', async () => {
    const keys = await generateFeedKeyPair();
    const firmado = await signFeed(canalBase(), keys.private);
    const pack = mergeFeedChannels({ name: 'base', rules: [] }, [firmado]);
    const ids = pack.rules.map((r) => r.id);
    expect(ids).toContain('feed:oficial/es:seo-slop');
    expect(ids).toContain('feed:oficial/es:domains');
    expect(pack.rules[0]?.description).toBe('canal de prueba');
  });

  it('a fed judge catches a spam link domain from the channel', async () => {
    const keys = await generateFeedKeyPair();
    const firmado = await signFeed(canalBase(), keys.private);
    const pack = mergeFeedChannels({ name: 'base', rules: [] }, [firmado]);

    const m = createModel();
    for (let i = 0; i < 6; i++) {
      train(m, tokenize(`consulta normal numero ${i} gracias`), 'ham');
      train(m, tokenize(`oferta viagra casino numero ${i}`), 'spam');
    }
    const v = judge('Hola, visite https://slop.example/oferta y ahorre', m, { rulePack: pack });
    expect(v.decision).toBe('quarantine');
    expect(v.reasons.some((r) => r.code === 'rule:feed:oficial/es:domains')).toBe(true);
  });
});
