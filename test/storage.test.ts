import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createModel, train } from '../src/bayes.js';
import { loadModel, saveModel } from '../src/storage.js';
import { tokenize } from '../src/tokenizer.js';

describe('model storage', () => {
  it('survives a round trip without losing anything', () => {
    const m = createModel();
    train(m, tokenize('viagra casino'), 'spam');
    train(m, tokenize('hola gracias'), 'ham');

    const dir = mkdtempSync(join(tmpdir(), 'spamcha-'));
    const path = join(dir, 'models', 'spamcha.json'); // also exercises recursive mkdir
    saveModel(m, path);

    const fresh = loadModel(path);
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(m));
    // contiene datos de usuarios: nada legible para group/other
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it('rejects files that are not a model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-'));
    const path = join(dir, 'garbage.json');
    writeFileSync(path, '{"hola": 1}', 'utf8');
    expect(() => loadModel(path)).toThrow(/not a spamcha model/);
  });
});
