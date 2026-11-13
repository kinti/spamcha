import { describe, expect, it } from 'vitest';
import { issueStamp, stampFieldsHtml, verifyStamp } from '../src/stamp.js';

const SECRET = 'long-random-phrase-for-tests';

describe('stamp', () => {
  it('issues and verifies an intact envelope', async () => {
    const token = await issueStamp(SECRET, { now: 1_000_000 });
    const v = await verifyStamp(token, SECRET, { now: 1_000_000 + 5_000 });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.v).toBe(1);
      expect(v.payload.i).toBe(1_000_000);
      expect(v.payload.e).toBeGreaterThan(v.payload.i);
      expect(v.payload.n).toBeTruthy();
    }
  });

  it('another secret cannot forge the stamp', async () => {
    const token = await issueStamp(SECRET);
    const v = await verifyStamp(token, 'another-secret-entirely', { now: Date.now() + 60_000 });
    expect(v).toEqual({ ok: false, reason: 'stamp:invalid' });
  });

  it('a tampered payload invalidates the stamp', async () => {
    const token = await issueStamp(SECRET);
    const [body, signature] = token.split('.');
    const tampered = `${body!.slice(0, -2)}AA.${signature}`;
    const v = await verifyStamp(tampered, SECRET, { now: Date.now() + 60_000 });
    expect(v).toEqual({ ok: false, reason: 'stamp:invalid' });
  });

  it('expires against the server clock', async () => {
    const token = await issueStamp(SECRET, { ttlMs: 1_000, now: 1_000_000 });
    const v = await verifyStamp(token, SECRET, { now: 1_000_000 + 2_000 });
    expect(v).toEqual({ ok: false, reason: 'stamp:expired' });
  });

  it('the time floor: solving too fast gets noticed', async () => {
    const token = await issueStamp(SECRET, { now: 1_000_000 });
    const fast = await verifyStamp(token, SECRET, { now: 1_000_000 + 1_000 });
    expect(fast).toEqual({ ok: false, reason: 'time:too-fast' });
    const human = await verifyStamp(token, SECRET, { now: 1_000_000 + 3_000 });
    expect(human.ok).toBe(true);
  });

  it('the stamp can be bound to one specific form', async () => {
    const token = await issueStamp(SECRET, { formId: 'contact', now: 1_000_000 });
    const other = await verifyStamp(token, SECRET, { formId: 'newsletter', now: 1_000_000 + 5_000 });
    expect(other).toEqual({ ok: false, reason: 'stamp:wrong-form' });
    const its = await verifyStamp(token, SECRET, { formId: 'contact', now: 1_000_000 + 5_000 });
    expect(its.ok).toBe(true);
  });

  it('missing or garbage tokens get a clear reason', async () => {
    expect(await verifyStamp(undefined, SECRET)).toEqual({ ok: false, reason: 'stamp:missing' });
    expect(await verifyStamp('', SECRET)).toEqual({ ok: false, reason: 'stamp:missing' });
    expect(await verifyStamp('xyz', SECRET)).toEqual({ ok: false, reason: 'stamp:invalid' });
  });

  it('stampFieldsHtml renders the two hidden fields', () => {
    const html = stampFieldsHtml('TOKEN.123', { honeypotField: 'company' });
    expect(html).toContain('name="spamcha" value="TOKEN.123"');
    expect(html).toContain('name="company"');
    expect(html).toContain('display:none');
    expect(html).toContain('tabindex="-1"');
  });
});
