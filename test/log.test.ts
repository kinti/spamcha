import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VerdictLog } from '../src/log.js';

function logDe(maxEntries?: number): VerdictLog {
  const dir = mkdtempSync(join(tmpdir(), 'spamcha-log-'));
  return new VerdictLog(join(dir, 'spamcha-log.jsonl'), maxEntries);
}

describe('verdict log', () => {
  it('records every submission outcome, newest first', () => {
    const log = logDe();
    log.add({ mensaje: 'hola' }, { decision: 'pass', probability: 0.1, phase: 'trained' }, []);
    log.add({ mensaje: 'viagra' }, { decision: 'quarantine', probability: 0.6, phase: 'trained' }, ['rule:spam-words']);
    log.add({ mensaje: 'bot' }, { decision: 'reject', probability: 1, phase: 'trained' }, ['stamp:missing']);

    const recientes = log.recent(10);
    expect(recientes).toHaveLength(3);
    expect(recientes[0]?.decision).toBe('reject');
    expect(recientes[2]?.decision).toBe('pass');
    expect(recientes[1]?.codes).toEqual(['rule:spam-words']);
  });

  it('rotates: keeps only the newest max entries', () => {
    const log = logDe(3);
    for (let i = 0; i < 5; i++) {
      log.add({ mensaje: `envio ${i}` }, { decision: 'pass', probability: 0, phase: 'cold' }, []);
    }
    const quedan = log.list();
    expect(quedan).toHaveLength(3);
    expect(quedan[0]?.fields.mensaje).toBe('envio 2');
    expect(quedan[2]?.fields.mensaje).toBe('envio 4');
  });

  it('an empty or nonexistent log lists empty', () => {
    expect(logDe().list()).toEqual([]);
  });
});
