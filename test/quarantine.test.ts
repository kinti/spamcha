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
