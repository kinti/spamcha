import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import type { Verdict } from '../src/types.js';

const fixtures = (sub: string): string => fileURLToPath(new URL(`./fixtures/${sub}`, import.meta.url));

describe('cli', () => {
  it('init creates model and rules; a second init steps on nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-'));
    const first = await run(['init', '--dir', dir]);
    expect(first).toContain('Created');
    expect(existsSync(join(dir, 'spamcha.json'))).toBe(true);
    expect(existsSync(join(dir, 'rules.json'))).toBe(true);
    expect(existsSync(join(dir, 'spamcha.config.json'))).toBe(true);
    expect(first).toMatch(/stampField/); // nombres stealth generados por sitio

    const second = await run(['init', '--dir', dir]);
    expect(second).toContain('Skipped');
  });

  it('train trains on the fixtures and leaves the model on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-'));
    const model = join(dir, 'spamcha.json');
    const out = await run([
      'train', '--model', model,
      '--spam', fixtures('spam'), '--ham', fixtures('ham'),
    ]);
    expect(out).toContain('Trained: 6 spam document(s), 6 ham document(s)');
    expect(JSON.parse(readFileSync(model, 'utf8'))).toMatchObject({ docs: { spam: 6, ham: 6 } });
  });

  it('train speaks Spanish with --locale es', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-'));
    const model = join(dir, 'spamcha.json');
    const out = await run([
      'train', '--model', model, '--locale', 'es',
      '--spam', fixtures('spam'), '--ham', fixtures('ham'),
    ]);
    expect(out).toContain('Entrenado: 6 documento(s) spam');
    expect(out).toContain('vocabulario');
  });

  it('eval measures against an unseen corpus without mistakes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-'));
    const model = join(dir, 'spamcha.json');
    await run(['train', '--model', model, '--spam', fixtures('spam'), '--ham', fixtures('ham')]);
    const out = await run([
      'eval', '--model', model,
      '--spam', fixtures('eval-spam'), '--ham', fixtures('eval-ham'),
    ]);
    expect(out).toContain('False positives (ham thrown away): 0');
    expect(out).toContain('False negatives (spam passed): 0');
  });

  it('judge returns a reasoned JSON verdict (alias: juzgar)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spamcha-'));
    const model = join(dir, 'spamcha.json');
    await run(['train', '--model', model, '--spam', fixtures('spam'), '--ham', fixtures('ham')]);
    const out = await run([
      'judge', '--model', model,
      'Cheap viagra casino bonus http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
    ]);
    const v = JSON.parse(out) as Verdict;
    expect(v.decision === 'quarantine' || v.decision === 'reject').toBe(true);
    expect(v.bayes).not.toBeNull();
    expect(v.reasons.length).toBeGreaterThan(0);

    const alias = await run([
      'juzgar', '--model', model,
      'Cheap viagra casino bonus http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
    ]);
    const va = JSON.parse(alias) as Verdict;
    expect(va.decision).toBe(v.decision);
  });

  it('version answers', async () => {
    expect(await run(['version'])).toMatch(/^spamcha v/);
  });

  it('unknown command: clear error', async () => {
    await expect(run(['pepito'])).rejects.toThrow(/Unknown command/);
  });

  it('unsupported locale: clear error', async () => {
    await expect(run(['version', '--locale', 'fr'])).rejects.toThrow(/Unsupported language/);
  });
});
