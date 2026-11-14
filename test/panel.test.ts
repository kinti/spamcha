import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createModel, train } from '../src/bayes.js';
import { createGatekeeper } from '../src/guard.js';
import { tokenize } from '../src/tokenizer.js';
import { panelHtml } from '../src/panel.js';

const SECRET = 'long-random-phrase-for-panel-tests';

describe('panel', () => {
  it('renders empty without data but with the sections', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-panel-'));
    const guard = createGatekeeper({
      secret: SECRET,
      modelPath: join(dir, 'spamcha.json'),
      minAgeMs: 0,
    });
    const html = panelHtml(guard);
    expect(html).toContain('Panel — what arrived');
    expect(html).toContain('No submissions yet.');
    expect(html).toContain('Quarantine is empty.');
  });

  it('shows the arrival: stats, codes and quarantined entries with buttons', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-panel-'));
    const guard = createGatekeeper({
      secret: SECRET,
      quarantinePath: join(dir, 'cuarentena.jsonl'),
      logPath: join(dir, 'spamcha-log.jsonl'),
      minAgeMs: 0,
    });
    const token = await guard.stampToken();
    await guard.review(
      { nombre: 'Carmen', mensaje: 'Hola, quería preguntar el precio', spamcha: token, website: '' },
      { ip: '10.7.0.1', now: Date.now() + 4_000 },
    );
    const token2 = await guard.stampToken();
    await guard.review(
      {
        nombre: 'Anna',
        mensaje: 'aumente su posicion en google con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
        spamcha: token2,
        website: '',
      },
      { ip: '10.7.0.2', now: Date.now() + 4_000 },
    );

    const html = panelHtml(guard);
    expect(html).toContain('Total 2');
    expect(html).toContain('last 24h: 2');
    expect(html).toContain('rule:spam-words');
    expect(html).toContain('rule:many-links');
    expect(html).toContain('a.xyz'); // a domain seen in filtered content
    expect(html).toContain('It is garbage (train spam)');
    // user content is escaped (no raw HTML in the panel)
    expect(html).not.toContain('<script>');
  });

  it('speaks Spanish when asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-panel-'));
    const guard = createGatekeeper({
      secret: SECRET,
      quarantinePath: join(dir, 'cuarentena.jsonl'),
      logPath: join(dir, 'spamcha-log.jsonl'),
      minAgeMs: 0,
    });
    const token = await guard.stampToken();
    await guard.review(
      {
        nombre: 'Anna',
        mensaje: 'aumente su posicion en google con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
        spamcha: token,
        website: '',
      },
      { ip: '10.7.0.3', now: Date.now() + 4_000 },
    );
    const html = panelHtml(guard, { locale: 'es' });
    expect(html).toContain('Panel — qué ha llegado');
    expect(html).toContain('Total 1');
    expect(html).toContain('Es basura (entrenar spam)');
  });

  it('no log configured: the panel still renders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-panel-'));
    const guard = createGatekeeper({ secret: SECRET, modelPath: join(dir, 'm.json') });
    expect(panelHtml(guard)).toContain('Panel — what arrived');
  });

  it('confirmed entries show up as verified leads with mailto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-leads-'));
    const guard = createGatekeeper({
      secret: SECRET,
      quarantinePath: join(dir, 'cuarentena.jsonl'),
      logPath: join(dir, 'spamcha-log.jsonl'),
      minAgeMs: 0,
    });
    // sembrar corpus: 2 ham + 3 spam de una familia (el booster verde la retiene)
    train(guard.model, tokenize('hola quería saber el precio del curso gracias'), 'ham');
    train(guard.model, tokenize('buenas tardes me gustaría pedir presupuesto saludos'), 'ham');
    for (let i = 0; i < 3; i++) {
      train(guard.model, tokenize(`contenido unico para tu blog ${i} enlaces guest`), 'spam');
    }

    const token = await guard.stampToken();
    await guard.review(
      {
        nombre: 'Carmen',
        email: 'carmen@empresa.example',
        mensaje: 'Buenas! Contenido unico para tu blog con enlaces sin coste http://guest-zoo.example',
        spamcha: token,
        website: '',
      },
      { ip: '10.9.1.1', now: Date.now() + 4_000 },
    );

    // el remitente confirma: entregada y convertida en lead verificado
    const pendiente = guard.listQuarantine().at(-1)!;
    expect(guard.confirmSubmission(pendiente.token)).not.toBeNull();

    const html = panelHtml(guard);
    expect(html).toContain('Verified leads (confirmed) (1)');
    expect(html).toContain('carmen@empresa.example');
    expect(html).toContain('mailto:carmen@empresa.example');
    // el spam pendiente NO confirmado no aparece como lead
    expect(html).not.toContain('premium backlinks');
  });

  it('does not leak unconfirmed spam as leads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-pending-'));
    const guard = createGatekeeper({
      secret: SECRET,
      quarantinePath: join(dir, 'cuarentena.jsonl'),
      logPath: join(dir, 'spamcha-log.jsonl'),
    });
    const token = await guard.stampToken();
    await guard.review(
      { nombre: 'Spammer', mensaje: 'posible slop con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz', spamcha: token, website: '' },
      { ip: '10.9.2.1', now: Date.now() + 4_000 },
    );
    const html = panelHtml(guard);
    // pendiente de confirmar: NO es lead verificado todavía
    expect(html).toContain('Quarantine pending: 1');
    expect(html).not.toContain('mailto:');
  });
});
