import { createServer, type AddressInfo } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createGatekeeper } from '../src/guard.js';
import { createServeServer } from '../src/serve.js';
import type { Server } from 'node:http';
import type { Verdict } from '../src/types.js';

const SECRET = 'long-random-phrase-for-serve-tests';

const guard = createGatekeeper({
  secret: SECRET,
  modelPath: join(mkdtempSync(join(tmpdir(), 'spamcha-serve-')), 'spamcha.json'),
  minAgeMs: 0,
});

const servers: Server[] = [];
function listen(server: Server): number {
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  servers.push(server);
  return port;
}
afterAll(() => servers.forEach((s) => s.close()));

const serve = createServeServer(guard);
const PORT = listen(serve);
const BASE = `http://127.0.0.1:${PORT}`;

describe('spamcha serve', () => {
  it('/health answers with model state', async () => {
    const res = await fetch(`${BASE}/health`);
    const body = (await res.json()) as { ok: boolean; model: { docs: { spam: number; ham: number } } };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.model.docs).toEqual({ spam: 0, ham: 0 });
  });

  it('/stamp issues a token (and HTML with format=html)', async () => {
    const json = await (await fetch(`${BASE}/stamp`)).json() as { token: string };
    expect(json.token.split('.')).toHaveLength(2);

    const html = await (await fetch(`${BASE}/stamp?format=html`)).json() as { html: string };
    expect(html.html).toContain('name="spamcha"');
    expect(html.html).toContain('name="website"');
  });

  it('/verdict judges urlencoded fields without a stamp → reject', async () => {
    const res = await fetch(`${BASE}/verdict`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'nombre=bot&mensaje=hola',
    });
    const v = (await res.json()) as Verdict;
    expect(res.status).toBe(200);
    expect(v.decision).toBe('reject');
    expect(v.signals[0]?.code).toBe('stamp:missing');
  });

  it('/verdict accepts JSON {fields, now} → pass for a real human', async () => {
    const token = (await (await fetch(`${BASE}/stamp`)).json() as { token: string }).token;
    const res = await fetch(`${BASE}/verdict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: { nombre: 'Carmen', mensaje: 'Hola, quería preguntar el precio', spamcha: token, website: '' },
        ip: '10.4.4.4',
        now: Date.now() + 4_000,
      }),
    });
    const v = (await res.json()) as Verdict;
    expect(v.decision).toBe('pass');
    expect(v.signals.map((s) => s.code)).toEqual(['stamp:valid', 'honeypot:empty']);
  });

  it('/panel renders the page', async () => {
    const res = await fetch(`${BASE}/panel`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Panel — what arrived');
  });

  it('/feeds lists channels in force', async () => {
    const res = await fetch(`${BASE}/feeds`);
    const body = (await res.json()) as { feeds: unknown[] };
    expect(body.feeds).toEqual([]);
  });

  it('404 for unknown paths', async () => {
    expect((await fetch(`${BASE}/nope`)).status).toBe(404);
  });

  it('oversized bodies get 413', async () => {
    const grande = 'x'.repeat(300_000);
    const res = await fetch(`${BASE}/verdict`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `mensaje=${grande}`,
    });
    expect(res.status).toBe(413);
  });

  it('cross-site /revision POSTs (CSRF) get 403', async () => {
    const res = await fetch(`${BASE}/revision`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://malo.example' },
      body: 'id=x&accion=spam',
    });
    expect(res.status).toBe(403);
  });

  it('same-origin and curl-style (no Origin) POSTs are allowed', async () => {
    const res = await fetch(`${BASE}/revision`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://127.0.0.1:${PORT}` },
      body: 'id=x&accion=spam',
    });
    expect([303, 200]).toContain(res.status);
  });
});
