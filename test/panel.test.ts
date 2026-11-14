import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGatekeeper } from '../src/guard.js';
import { panelHtml } from '../src/panel.js';

const SECRET = 'long-random-phrase-for-panel-tests';

function guardConPanel() {
  const dir = mkdtempSync(join(tmpdir(), 'spamcha-panel-'));
  const guard = createGatekeeper({
    secret: SECRET,
    modelPath: join(dir, 'spamcha.json'),
    quarantinePath: join(dir, 'cuarentena.jsonl'),
    logPath: join(dir, 'spamcha-log.jsonl'),
    minAgeMs: 0,
  });
  return { guard, dir };
}

describe('panel', () => {
  it('renders empty without data but with the sections', () => {
    const { guard } = guardConPanel();
    const html = panelHtml(guard);
    expect(html).toContain('Panel — qué ha llegado');
    expect(html).toContain('Sin envíos todavía.');
    expect(html).toContain('Cuarentena vacía.');
  });

  it('shows the arrival: stats, codes and quarantined entries with buttons', async () => {
    const { guard } = guardConPanel();
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
    expect(html).toContain('últimas 24h: 2');
    expect(html).toContain('rule:spam-words');
    expect(html).toContain('rule:many-links');
    expect(html).toContain('a.xyz'); // dominio visto en lo filtrado
    expect(html).toContain('Es basura (entrenar spam)');
    // el contenido del usuario se escapa (sin HTML crudo en el panel)
    expect(html).not.toContain('<script>');
  });

  it('speaks English when asked', () => {
    const { guard } = guardConPanel();
    const html = panelHtml(guard, { locale: 'en' });
    expect(html).toContain('Panel — what arrived');
    expect(html).toContain('No submissions yet.');
  });

  it('no log configured: the panel still renders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-panel-'));
    const guard = createGatekeeper({ secret: SECRET, modelPath: join(dir, 'm.json') });
    expect(panelHtml(guard)).toContain('Panel — qué ha llegado');
  });
});
