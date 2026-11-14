import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QuarantineStore } from '../src/quarantine.js';

function tienda(): QuarantineStore {
  const dir = mkdtempSync(join(tmpdir(), 'spamcha-quarantine-'));
  return new QuarantineStore(join(dir, 'cuarentena.jsonl'));
}

describe('quarantine store', () => {
  it('adds, lists and resolves (the review loop)', () => {
    const q = tienda();
    expect(q.list()).toEqual([]);

    const a = q.add({ mensaje: 'slop uno' }, { probability: 0.6, phase: 'cold' });
    const b = q.add({ mensaje: 'slop dos' }, { probability: 0.7, phase: 'trained' });
    expect(q.list()).toHaveLength(2);
    expect(a.id).not.toBe(b.id);

    expect(q.resolve(a.id)).toBe(true);
    const restantes = q.list();
    expect(restantes).toHaveLength(1);
    expect(restantes[0]?.id).toBe(b.id);
    expect(q.resolve(a.id)).toBe(false);
  });

  it('the stored entry keeps everything needed to retrain', () => {
    const q = tienda();
    q.add({ nombre: 'x', mensaje: 'slop' }, { probability: 0.66, phase: 'trained' });
    const [entry] = q.list();
    expect(entry?.fields).toEqual({ nombre: 'x', mensaje: 'slop' });
    expect(entry?.receivedAt).toBeTruthy();
    expect(entry?.probability).toBeCloseTo(0.66);
  });

  it('an empty or nonexistent file lists empty', () => {
    const q = tienda();
    expect(q.list()).toEqual([]);
    q.add({ mensaje: 'algo' }, { probability: 0.5, phase: 'cold' });
    expect(q.resolve('id-inexistente')).toBe(false);
  });

  it('a corrupt line does not sink the rest of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-quarantine-'));
    const q = new QuarantineStore(join(dir, 'cuarentena.jsonl'));
    q.add({ mensaje: 'bueno' }, { probability: 0.5, phase: 'cold' });
    // alguien escribe basura a mano en el archivo:
    const { appendFileSync } = require('node:fs') as typeof import('node:fs');
    appendFileSync(q.path, 'ESTA LINEA NO ES JSON\n', 'utf8');
    q.add({ mensaje: 'otro' }, { probability: 0.6, phase: 'cold' });
    expect(q.list()).toHaveLength(2);
  });
});

describe('confirmation (double opt-in, sin humanos)', () => {
  it('token → confirm → delivered, sin entrenar nada por sí solo', () => {
    const q = tienda();
    q.add({ mensaje: 'posible spam' }, { probability: 0.6, phase: 'cold' }, 'token-abc');
    const [entry] = q.listPending();
    expect(entry?.token).toBe('token-abc');

    // el "remitente" confirma con el token: entregado, NO entrenado
    expect(q.markConfirmed(entry!.id)).toBe(true);
    expect(q.listPending()).toHaveLength(0);
    expect(q.listConfirmed()).toHaveLength(1);
    expect(q.listConfirmed()[0]?.fields.mensaje).toBe('posible spam');
  });

  it('un token desconocido no confirma nada', () => {
    const q = tienda();
    q.add({ mensaje: 'x' }, { probability: 0.5, phase: 'cold' }, 'buen-token');
    expect(q.findByToken('falso')).toBeNull();
    expect(q.markConfirmed('falso')).toBe(false);
    expect(q.listPending()).toHaveLength(1);
  });

  it('sweep: lo no confirmado caduca, lo confirmado se queda', () => {
    const q = tienda();
    const viejo = q.add({ mensaje: 'viejo sin confirmar' }, { probability: 0.5, phase: 'cold' }, 'tok-viejo');
    const confirmado = q.add({ mensaje: 'confirmado a tiempo' }, { probability: 0.5, phase: 'cold' }, 'tok-bueno');
    q.markConfirmed(confirmado.id);
    const borrados = q.sweepExpired(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(borrados.map((e) => e.id)).toEqual([viejo.id]);
    expect(q.listConfirmed()).toHaveLength(1);
  });
});
