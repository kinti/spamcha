import { describe, expect, it } from 'vitest';
import { createModel } from '../src/bayes.js';
import type { BayesModel } from '../src/bayes.js';
import { issueStamp, verifySubmission } from '../src/index.js';

const SECRET = 'long-random-phrase-for-the-gatekeeper-tests';

async function freshStamp(): Promise<string> {
  return issueStamp(SECRET);
}

function options(): Parameters<typeof verifySubmission>[2] {
  return { secret: SECRET, now: Date.now() + 4_000 }; // arrived 4s later: human
}

describe('gatekeeper', () => {
  it('a real human passes all three gates', async () => {
    const model: BayesModel = createModel();
    const token = await freshStamp();
    const v = await verifySubmission(
      { nombre: 'Carmen', mensaje: 'Hola, quería preguntar el precio del curso', spamcha: token, website: '' },
      model,
      options(),
    );
    expect(v.decision).toBe('pass');
    expect(v.signals.map((s) => s.code)).toEqual(['stamp:valid', 'honeypot:empty']);
  });

  it('spam content quarantines even with the gates passed', async () => {
    const model: BayesModel = createModel();
    const token = await freshStamp();
    const v = await verifySubmission(
      {
        nombre: 'Anna',
        mensaje: 'aumente su posicion en google con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
        spamcha: token,
        website: '',
      },
      model,
      options(),
    );
    expect(v.decision).toBe('quarantine');
    expect(v.rules).toBeGreaterThanOrEqual(6);
  });

  it('a bot POSTing directly falls on stamp:missing', async () => {
    const model: BayesModel = createModel();
    const v = await verifySubmission({ nombre: 'bot', mensaje: 'hola' }, model, options());
    expect(v.decision).toBe('reject');
    expect(v.signals[0]?.code).toBe('stamp:missing');
    expect(v.signals[0]?.text).toBeTruthy(); // locale text attached
  });

  it('a tampered stamp opens no door', async () => {
    const model: BayesModel = createModel();
    const token = await freshStamp();
    const v = await verifySubmission(
      { mensaje: 'hola', spamcha: token + 'x', website: '' },
      model,
      options(),
    );
    expect(v.decision).toBe('reject');
    expect(v.signals[0]?.code).toBe('stamp:invalid');
  });

  it('a fast bot (under 3s since issue) falls into the time floor', async () => {
    const model: BayesModel = createModel();
    const token = await issueStamp(SECRET, { now: Date.now() });
    const v = await verifySubmission(
      { mensaje: 'hola', spamcha: token, website: '' },
      model,
      { secret: SECRET }, // now = real: under 3s since issue
    );
    expect(v.decision).toBe('reject');
    expect(v.signals[0]?.code).toBe('time:too-fast');
  });

  it('a filled honeypot betrays the bot even with a valid stamp', async () => {
    const model: BayesModel = createModel();
    const token = await freshStamp();
    const v = await verifySubmission(
      { mensaje: 'hola', spamcha: token, website: 'http://spam.xyz' },
      model,
      options(),
    );
    expect(v.decision).toBe('reject');
    expect(v.signals.map((s) => s.code)).toEqual(['stamp:valid', 'honeypot:filled']);
  });

  it('a missing honeypot (POST without rendering) betrays too', async () => {
    const model: BayesModel = createModel();
    const token = await freshStamp();
    const v = await verifySubmission(
      { mensaje: 'hola', spamcha: token },
      model,
      options(), // requireHoneypot by default: yes
    );
    expect(v.decision).toBe('reject');
    expect(v.signals.map((s) => s.code)).toEqual(['stamp:valid', 'honeypot:missing']);
  });

  it('requireHoneypot can be turned off for integrations without honeypot', async () => {
    const model: BayesModel = createModel();
    const token = await freshStamp();
    const v = await verifySubmission(
      { mensaje: 'hola', spamcha: token },
      model,
      { ...options(), requireHoneypot: false },
    );
    expect(v.decision).toBe('pass');
    expect(v.signals.map((s) => s.code)).toEqual(['stamp:valid', 'honeypot:empty']);
  });

  it('the stamp and honeypot never reach the judge as content', async () => {
    const model: BayesModel = createModel();
    const token = await freshStamp();
    const v = await verifySubmission(
      { spamcha: token, website: '' },
      model,
      options(),
    );
    expect(v.decision).toBe('pass');
    expect(v.meta.fields).toBe(0);
  });

  it('signals speak the requested locale', async () => {
    const model: BayesModel = createModel();
    const v = await verifySubmission({ nombre: 'bot', mensaje: 'hola' }, model, { ...options(), locale: 'en' });
    expect(v.signals[0]?.code).toBe('stamp:missing');
    expect(v.signals[0]?.text).toBe('No stamp was attached: POST straight at the server without rendering the form');
  });
});
