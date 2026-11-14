import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGatekeeper } from '../src/guard.js';

const SECRET = 'long-random-phrase-for-the-guard-tests';

function guardDePrueba() {
  const dir = mkdtempSync(join(tmpdir(), 'spamcha-guard-'));
  const guard = createGatekeeper({
    secret: SECRET,
    modelPath: join(dir, 'spamcha.json'),
    quarantinePath: join(dir, 'cuarentena.jsonl'),
    rateLimit: { max: 3, windowMs: 60_000 },
  });
  return { guard, dir };
}

describe('createGatekeeper', () => {
  it('issues stamps and passes a real human through', async () => {
    const { guard } = guardDePrueba();
    const token = await guard.stampToken();
    const v = await guard.review(
      { nombre: 'Carmen', mensaje: 'Hola, quería preguntar el precio', spamcha: token, website: '' },
      { ip: '10.0.0.2', now: Date.now() + 4_000 },
    );
    expect(v.decision).toBe('pass');
    expect(v.signals.map((s) => s.code)).toEqual(['stamp:valid', 'honeypot:empty']);
  });

  it('a quarantined submission is stored for review', async () => {
    const { guard } = guardDePrueba();
    const token = await guard.stampToken();
    const v = await guard.review(
      {
        nombre: 'Anna',
        mensaje: 'aumente su posicion en google con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
        spamcha: token,
        website: '',
      },
      { ip: '10.0.0.3', now: Date.now() + 4_000 },
    );
    expect(v.decision).toBe('quarantine');
    const pendientes = guard.listQuarantine();
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]?.fields.mensaje).toContain('backlinks');
    expect(pendientes[0]?.fields.spamcha).toBeUndefined(); // the stamp never enters the corpus
  });

  it('the "this was garbage" button trains and autosaves the model', async () => {
    const { guard, dir } = guardDePrueba();
    const token = await guard.stampToken();
    await guard.review(
      {
        nombre: 'Anna',
        mensaje: 'aumente su posicion en google con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
        spamcha: token,
        website: '',
      },
      { ip: '10.0.0.4', now: Date.now() + 4_000 },
    );
    const docsSpamAntes = guard.model.docs.spam;
    const [entry] = guard.listQuarantine();

    expect(guard.resolveQuarantine(entry!.id, 'spam')).toBe(true);
    expect(guard.model.docs.spam).toBe(docsSpamAntes + 1);
    expect(guard.listQuarantine()).toHaveLength(0);
    expect(existsSync(join(dir, 'spamcha.json'))).toBe(true);

    // y lo aprendido ya pesa: el mismo slop sin enlaces nuevos baja de cuarentena
    const token2 = await guard.stampToken();
    const repetido = await guard.review(
      { nombre: 'Anna', mensaje: 'aumente su posicion en google con backlinks premium', spamcha: token2, website: '' },
      { ip: '10.0.0.5', now: Date.now() + 4_000 },
    );
    expect(repetido.decision).toBe('pass'); // sin las 6 urls, las reglas solas no bastan; el bayes verde apenas pesa
  });

  it('discard removes without training', async () => {
    const { guard } = guardDePrueba();
    const token = await guard.stampToken();
    await guard.review(
      { nombre: 'x', mensaje: 'cheap viagra casino payday http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz', spamcha: token, website: '' },
      { ip: '10.0.0.6', now: Date.now() + 4_000 },
    );
    const [entry] = guard.listQuarantine();
    const docsAntes = guard.model.docs.spam + guard.model.docs.ham;
    expect(guard.discardQuarantine(entry!.id)).toBe(true);
    expect(guard.listQuarantine()).toHaveLength(0);
    expect(guard.model.docs.spam + guard.model.docs.ham).toBe(docsAntes);
  });

  it('a replayed stamp (same nonce twice) gets rejected', async () => {
    const { guard } = guardDePrueba();
    const token = await guard.stampToken();
    const campos = { mensaje: 'hola', spamcha: token, website: '' };
    const primero = await guard.review(campos, { ip: '10.8.8.1', now: Date.now() + 4_000 });
    expect(primero.decision).toBe('pass');
    const repetido = await guard.review(campos, { ip: '10.8.8.1', now: Date.now() + 5_000 });
    expect(repetido.decision).toBe('reject');
    expect(repetido.signals[0]?.code).toBe('stamp:replayed');
    // un sello FRESCO del mismo formulario sigue funcionando
    const token2 = await guard.stampToken();
    const deNuevo = await guard.review(
      { mensaje: 'hola', spamcha: token2, website: '' },
      { ip: '10.8.8.1', now: Date.now() + 6_000 },
    );
    expect(deNuevo.decision).toBe('pass');
  });

  it('the rate limiter answers with a synthetic verdict', async () => {
    const { guard } = guardDePrueba();
    for (let i = 0; i < 3; i++) {
      const token = await guard.stampToken(); // fresh stamp: replay gate stays out of the way
      await guard.review(
        { mensaje: 'hola', spamcha: token, website: '' },
        { ip: '10.9.9.9', now: Date.now() + 4_000 },
      );
    }
    const token4 = await guard.stampToken();
    const v = await guard.review(
      { mensaje: 'hola', spamcha: token4, website: '' },
      { ip: '10.9.9.9', now: Date.now() + 4_000 },
    );
    expect(v.decision).toBe('reject');
    expect(v.signals[0]?.code).toBe('rate:limited');
    // otra IP, sin problema
    const token5 = await guard.stampToken();
    const otra = await guard.review(
      { mensaje: 'hola', spamcha: token5, website: '' },
      { ip: '10.9.9.8', now: Date.now() + 4_000 },
    );
    expect(otra.decision).not.toBe('reject');
  });

  it('auto-ham (opt-in): a clean pass trains the ham side by itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-autoham-'));
    const guard = createGatekeeper({
      secret: SECRET,
      modelPath: join(dir, 'spamcha.json'),
      autoHam: true,
      minAgeMs: 0,
    });
    const token = await guard.stampToken();
    const antes = guard.model.docs.ham;
    const v = await guard.review(
      { nombre: 'Carmen', mensaje: 'Hola, quería preguntar el precio', spamcha: token, website: '' },
      { ip: '10.6.6.1', now: Date.now() + 4_000 },
    );
    expect(v.decision).toBe('pass');
    expect(guard.model.docs.ham).toBe(antes + 1);
    expect(JSON.parse(readFileSync(join(dir, 'spamcha.json'), 'utf8'))).toMatchObject({ docs: { ham: antes + 1 } });
  });

  it('auto-ham stays OFF by default: a clean pass does not train anything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-noautoham-'));
    const guard = createGatekeeper({
      secret: SECRET,
      modelPath: join(dir, 'spamcha.json'),
      minAgeMs: 0,
    });
    const token = await guard.stampToken();
    await guard.review(
      { nombre: 'Carmen', mensaje: 'Hola, quería preguntar el precio', spamcha: token, website: '' },
      { ip: '10.8.0.1', now: Date.now() + 4_000 },
    );
    expect(guard.model.docs.ham).toBe(0);
  });

  it('stampHtml paints the two hidden fields', async () => {
    const { guard } = guardDePrueba();
    const html = await guard.stampHtml();
    expect(html).toContain('name="spamcha"');
    expect(html).toContain('name="website"');
  });

  it('the model file persists and reloads with memory', async () => {
    const { guard, dir } = guardDePrueba();
    const token = await guard.stampToken();
    await guard.review(
      { nombre: 'x', mensaje: 'cheap viagra casino payday http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz', spamcha: token, website: '' },
      { ip: '10.0.0.7', now: Date.now() + 4_000 },
    );
    guard.resolveQuarantine(guard.listQuarantine()[0]!.id, 'spam');

    const renovado = createGatekeeper({
      secret: SECRET,
      modelPath: join(dir, 'spamcha.json'),
      quarantinePath: join(dir, 'cuarentena.jsonl'),
    });
    expect(renovado.model.docs.spam).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, 'spamcha.json'), 'utf8'))).toMatchObject({ docs: { spam: 1, ham: 0 } });
  });
});

describe('double opt-in (sin humanos)', () => {
  it('quarantine → confirmToken → confirmSubmission entrega sin entrenar ham', async () => {
    const { guard } = guardDePrueba();
    const token = await guard.stampToken();
    const v = await guard.review(
      {
        nombre: 'Anna',
        mensaje: 'aumente su posicion en google con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
        spamcha: token,
        website: '',
      },
      { ip: '10.7.7.1', now: Date.now() + 4_000 },
    );
    expect(v.decision).toBe('quarantine');
    expect(v.confirmToken).toBeTruthy();

    // el remitente confirma: entregado al panel (Confirmados), sin entrenar ham
    const antes = guard.model.docs.ham;
    const entregada = guard.confirmSubmission(v.confirmToken!);
    expect(entregada).not.toBeNull();
    expect(guard.model.docs.ham).toBe(antes); // confirmar NO entrena (poisoning vector)
    expect(guard.listQuarantine()).toHaveLength(0);
    expect(guard.listConfirmed()).toHaveLength(1);

    // token falso → nada
    expect(guard.confirmSubmission('falso')).toBeNull();
  });
});
