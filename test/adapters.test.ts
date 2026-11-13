import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGatekeeper } from '../src/guard.js';
import { middlewareExpress, middlewareHono } from '../src/adapters.js';
import type { Verdict } from '../src/types.js';

const SECRET = 'long-random-phrase-for-adapter-tests';

function guard() {
  const dir = mkdtempSync(join(tmpdir(), 'spamcha-adapters-'));
  // minAgeMs 0: los tests no quieren esperar el suelo humano de 3s del sello
  return createGatekeeper({ secret: SECRET, modelPath: join(dir, 'spamcha.json'), minAgeMs: 0 });
}

describe('express adapter', () => {
  it('reject answers 403 and the handler never runs', async () => {
    const g = guard();
    const mw = middlewareExpress(g);
    let siguiente = false;
    let respuesta: { status?: number; body?: unknown } = {};
    await mw(
      { body: { nombre: 'bot', mensaje: 'hola' }, ip: '10.1.1.1' },
      { status(code: number) { respuesta.status = code; return { json(b: unknown) { respuesta.body = b; return b; } }; } },
      () => { siguiente = true; },
    );
    expect(siguiente).toBe(false);
    expect(respuesta.status).toBe(403);
    expect((respuesta.body as Verdict).decision).toBe('reject');
  });

  it('pass attaches the verdict and calls next', async () => {
    const g = guard();
    const mw = middlewareExpress(g);
    const token = await g.stampToken();
    const req: Record<string, unknown> = {
      body: { nombre: 'Carmen', mensaje: 'hola', spamcha: token, website: '' },
      ip: '10.1.1.2',
    };
    let siguiente = false;
    await mw(req, { status: () => ({ json: () => null }) }, () => { siguiente = true; });
    expect(siguiente).toBe(true);
    expect((req.spamcha as Verdict).decision).toBe('pass');
  });

  it('a urlencoded string body gets parsed', async () => {
    const g = guard();
    const mw = middlewareExpress(g);
    let siguiente = false;
    await mw(
      { body: 'nombre=bot&mensaje=hola', ip: '10.1.1.3' },
      { status: () => ({ json: () => null }) },
      () => { siguiente = true; },
    );
    expect(siguiente).toBe(false); // sin sello → reject, pero el body se leyó bien
  });
});

describe('hono adapter', () => {
  function contextOf(body: Record<string, unknown> | null, ip?: string) {
    const almacen: Record<string, unknown> = {};
    let respuesta: { status?: number; body?: unknown } = {};
    return {
      c: {
        req: {
          parseBody: async () => body ?? (() => { throw new Error('sin body'); })(),
          header: (name: string) => (name === 'x-forwarded-for' ? ip : undefined),
        },
        set: (k: string, v: unknown) => { almacen[k] = v; },
        json: (b: unknown, status?: number) => { respuesta = { status, body: b }; return b; },
      },
      get almacen() { return almacen; },
      get respuesta() { return respuesta; },
    };
  }

  it('reject answers 403 without calling next', async () => {
    const g = guard();
    const mw = middlewareHono(g);
    const ctx = contextOf({ nombre: 'bot', mensaje: 'hola' }, '10.2.2.2');
    let siguiente = false;
    await mw(ctx.c as Parameters<typeof mw>[0], async () => { siguiente = true; });
    expect(siguiente).toBe(false);
    expect(ctx.respuesta.status).toBe(403);
    expect((ctx.respuesta.body as Verdict).decision).toBe('reject');
  });

  it('pass stores the verdict and continues', async () => {
    const g = guard();
    const mw = middlewareHono(g);
    const token = await g.stampToken();
    const ctx = contextOf({ nombre: 'Carmen', mensaje: 'hola', spamcha: token, website: '' }, '10.2.2.3');
    let siguiente = false;
    await mw(ctx.c as Parameters<typeof mw>[0], async () => { siguiente = true; });
    expect(siguiente).toBe(true);
    expect((ctx.almacen.spamcha as Verdict).decision).toBe('pass');
  });
});
