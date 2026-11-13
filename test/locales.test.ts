import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, ruleText, translate } from '../src/locales.js';
import type { Rule } from '../src/types.js';

describe('locales', () => {
  it('translates codes to es (native) and en', () => {
    expect(translate('stamp:missing')).toContain('Nadie trajo el sello');
    expect(translate('stamp:missing', { locale: 'en' })).toContain('No stamp was attached');
  });

  it('an unknown code falls back to es, then to the code itself', () => {
    expect(translate('no-existe')).toBe('no-existe');
    expect(translate('no-existe', { locale: 'en' })).toBe('no-existe');
  });

  it('interpolates {variables}', () => {
    expect(translate('cli.train.done', { vars: { spam: 6, ham: 4 } })).toContain('6 documento(s) spam');
    expect(translate('cli.train.done', { locale: 'en', vars: { spam: 6, ham: 4 } })).toContain('6 spam document(s)');
  });

  it('isLocale guards the CLI', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(DEFAULT_LOCALE).toBe('es');
  });

  it('ruleText: the pack description wins in es, the translation in en', () => {
    const rule: Rule = { id: 'spam-words', type: 'count', pattern: 'x', threshold: 1, weight: 3, description: 'Palabras típicas de spam' };
    expect(ruleText(rule)).toBe('Palabras típicas de spam');
    expect(ruleText(rule, 'es')).toBe('Palabras típicas de spam');
    expect(ruleText(rule, 'en')).toBe('Classic spam keywords');
  });

  it('ruleText: a custom rule without translation keeps the site voice', () => {
    const rule: Rule = { id: 'mi-regla', type: 'count', pattern: 'x', threshold: 1, weight: 1, description: 'Regla de la casa' };
    expect(ruleText(rule, 'en')).toBe('Regla de la casa');
  });
});
