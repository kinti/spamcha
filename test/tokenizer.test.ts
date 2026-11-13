import { describe, expect, it } from 'vitest';
import { normalize, tokenize } from '../src/tokenizer.js';

describe('normalize', () => {
  it('lowercases, collapses whitespace and trims', () => {
    expect(normalize('  HOLA   MUNDO\n')).toBe('hola mundo');
  });
});

describe('tokenize', () => {
  it('splits words and keeps accents', () => {
    expect(tokenize('¡Hola! ¿Qué tal?')).toEqual(['hola', 'qué', 'tal']);
  });

  it('decomposes unicode ligatures (NFKC)', () => {
    expect(tokenize('ﬁna')).toContain('fina');
  });

  it('a URL becomes a base-domain token and stays out of the text', () => {
    const t = tokenize('mira https://blog.ejemplo.es/articulo?id=7 y comenta');
    expect(t).toContain('url:ejemplo.es');
    expect(t).toContain('mira');
    expect(t).not.toContain('https');
  });

  it('a bare www domain is captured too', () => {
    expect(tokenize('visita www.ejemplo.es')).toContain('url:ejemplo.es');
  });

  it('an email becomes a domain token', () => {
    const t = tokenize('escribe a ana@correo.example porfa');
    expect(t).toContain('email:correo.example');
    expect(t).toContain('escribe');
    expect(t).not.toContain('ana');
  });

  it('non-latin alphabets tokenize word by word', () => {
    expect(tokenize('привет мир')).toEqual(['привет', 'мир']);
  });

  it('repeats are kept: density is signal', () => {
    const t = tokenize('gratis gratis gratis');
    expect(t.filter((x) => x === 'gratis')).toHaveLength(3);
  });
});
