import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../src/rules.js';
import type { RulePack } from '../src/types.js';

describe('evaluateRules', () => {
  it('count: fires when the threshold is reached', () => {
    const pack: RulePack = {
      name: 't',
      rules: [{ id: 'r', type: 'count', pattern: 'spam', threshold: 2, weight: 3, description: 'd' }],
    };
    const out = evaluateRules({ message: 'spam spam spam' }, pack);
    expect(out.weight).toBe(3);
    expect(out.reasons[0]?.code).toBe('rule:r');
    expect(out.reasons[0]?.field).toBe('message');
    expect(out.reasons[0]?.detail).toBe('3/2');
  });

  it('count: below the threshold it stays silent', () => {
    const pack: RulePack = {
      name: 't',
      rules: [{ id: 'r', type: 'count', pattern: 'spam', threshold: 2, weight: 3 }],
    };
    expect(evaluateRules({ message: 'un spam suelto' }, pack).weight).toBe(0);
  });

  it('ratio: share of matched characters', () => {
    const pack: RulePack = {
      name: 't',
      rules: [{ id: 'caps', type: 'ratio', pattern: '\\p{Lu}', threshold: 0.5, weight: 2 }],
    };
    expect(evaluateRules({ message: 'GRITOS TOTALMENTE' }, pack).weight).toBe(2);
    expect(evaluateRules({ message: 'Grito normal y corriente con matices' }, pack).weight).toBe(0);
  });

  it('density: matches per 1000 chars, with a length floor', () => {
    const pack: RulePack = {
      name: 't',
      rules: [{ id: 'dense', type: 'density', pattern: 'https?://', threshold: 4, minLength: 300, weight: 3 }],
    };
    // One link in a short 200-char text: not even evaluated (minLength).
    const short = `mira ${'palabra '.repeat(38)}https://x.example`;
    expect(evaluateRules({ message: short }, pack).weight).toBe(0);
    // One link every ~200 chars in a long text: fires.
    const link = 'https://enlace.example/abc ';
    const long = `${'palabra relleno '.repeat(8)}${link}${'palabra relleno '.repeat(8)}${link}${'palabra relleno '.repeat(8)}${link}`;
    expect(long.length).toBeGreaterThan(300);
    expect(evaluateRules({ message: long }, pack).weight).toBe(3);
  });

  it('field: a bound rule ignores the rest', () => {
    const pack: RulePack = {
      name: 't',
      rules: [{ id: 'r', type: 'count', pattern: 'https?', threshold: 1, weight: 3, field: 'message' }],
    };
    const out = evaluateRules({ website: 'https://mi-sitio.example', message: 'hola' }, pack);
    expect(out.weight).toBe(0);
  });

  it('accumulates weights across rules and fields', () => {
    const pack: RulePack = {
      name: 't',
      rules: [
        { id: 'a', type: 'count', pattern: 'gratis', threshold: 1, weight: 2 },
        { id: 'b', type: 'count', pattern: 'https?://', threshold: 5, weight: 3 },
      ],
    };
    const out = evaluateRules(
      { message: 'GRATIS gratis ahora mismo y con muchos enlaces https://a.example https://b.example https://c.example https://d.example https://e.example' },
      pack,
    );
    expect(out.weight).toBe(5);
    expect(out.reasons).toHaveLength(2);
  });

  it('an invalid pattern throws naming the rule', () => {
    const pack: RulePack = {
      name: 't',
      rules: [{ id: 'broken', type: 'count', pattern: '([mal', threshold: 1, weight: 1 }],
    };
    expect(() => evaluateRules({ message: 'x' }, pack)).toThrow(/broken/);
  });
});
