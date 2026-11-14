import { createServer, type AddressInfo } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';

// El ciclo completo del canal: keygen → firmar → servir por HTTP → add →
// update (verifica firma) → juzgar con el feed fusionado → manipulación → FIRMA INVÁLIDA.

const dir = mkdtempSync(join(tmpdir(), 'spamcha-feed-cli-'));
const PRIVATE = join(dir, 'k.priv.b64');
const PUBLIC = join(dir, 'k.pub.b64');
const CANAL = join(dir, 'oficial-es.json');
const FEEDS_DIR = join(dir, 'feeds');
const CONFIG = join(dir, 'spamcha.feeds.json');
const MODELO = join(dir, 'spamcha.json');
const FIXTURES = (sub: string): string => fileURLToPath(new URL(`./fixtures/${sub}`, import.meta.url));

// El archivo se lee EN CADA petición: manipularlo cambia lo que se sirve.
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(readFileSync(CANAL, 'utf8'));
});
server.listen(0);
const puerto = (server.address() as AddressInfo).port;
const url = `http://127.0.0.1:${puerto}/canal`;
afterAll(() => server.close());

describe('feed CLI (HTTP real)', () => {
  it('keygen → sign → add → update → judge learns the channel rule', async () => {
    await run(['feed', 'keygen', '--privada', PRIVATE, '--publica', PUBLIC]);

    writeFileSync(
      CANAL,
      JSON.stringify({
        channel: 'oficial/es',
        version: 1,
        updatedAt: '2026-11-14T00:00:00Z',
        expiresAt: '2027-05-13T00:00:00Z',
        description: 'canal de prueba',
        rules: [{ id: 'seo-slop', type: 'count', pattern: 'backlinks\\s+premium', threshold: 1, weight: 3 }],
        domains: ['slop.example'],
      }),
      'utf8',
    );
    const firmado = await run(['feed', 'sign', '--archivo', CANAL, '--privada', PRIVATE]);
    expect(firmado).toContain('versión 1');

    await run(['feed', 'add', '--nombre', 'oficial', '--url', url, '--publica', PUBLIC, '--config', CONFIG]);
    const update = await run(['feed', 'update', '--config', CONFIG, '--dir', FEEDS_DIR]);
    expect(update).toContain('versión 1');
    expect(update).toContain('1 dominios');
    expect(existsSync(join(FEEDS_DIR, 'oficial.json'))).toBe(true);

    // el juez fusiona el feed: un dominio del canal cuarentena con razón trazable
    await run(['train', '--model', MODELO, '--spam', FIXTURES('spam'), '--ham', FIXTURES('ham')]);
    const salida = await run([
      'judge', '--model', MODELO, '--feeds-dir', FEEDS_DIR,
      'Hola, visite http://slop.example/oferta',
    ]);
    expect(salida).toContain('feed:oficial/es:domains');
  }, 20_000);

  it('a tampered channel gets FIRMA INVÁLIDA on update', async () => {
    const crudo = JSON.parse(readFileSync(CANAL, 'utf8')) as { version: number; rules: { id: string }[] };
    crudo.version += 1; // sin volver a firmar: la manipulación clásica
    crudo.rules[0]!.id = 'regla-venenosa';
    writeFileSync(CANAL, JSON.stringify(crudo), 'utf8');

    const update = await run(['feed', 'update', '--config', CONFIG, '--dir', FEEDS_DIR]);
    expect(update).toContain('FIRMA INVÁLIDA');
    // y lo manipulado NUNCA entra en caché:
    const cache = JSON.parse(readFileSync(join(FEEDS_DIR, 'oficial.json'), 'utf8')) as { version: number };
    expect(cache.version).toBe(1);
  }, 20_000);
});
