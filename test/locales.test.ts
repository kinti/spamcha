import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, ruleText, translate } from '../src/locales.js';
import type { Rule } from '../src/types.js';

describe('locales', () => {
  it('born in English: default locale is en, es is the translation', () => {
    expect(translate('stamp:missing')).toContain('No stamp was attached');
    expect(translate('stamp:missing', { locale: 'es' })).toContain('Nadie trajo el sello');
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('an unknown code falls back to en, then to the code itself', () => {
    expect(translate('does-not-exist')).toBe('does-not-exist');
    expect(translate('does-not-exist', { locale: 'es' })).toBe('does-not-exist');
  });

  it('interpolates {variables}', () => {
    expect(translate('cli.train.done', { vars: { spam: 6, ham: 4 } })).toContain('6 spam document(s)');
    expect(translate('cli.train.done', { locale: 'es', vars: { spam: 6, ham: 4 } })).toContain('6 documento(s) spam');
  });

  it('isLocale guards the CLI', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('ruleText: the pack description is the English voice, es pulls the translation', () => {
    const rule: Rule = { id: 'spam-words', type: 'count', pattern: 'x', threshold: 1, weight: 3, description: 'Classic spam keywords' };
    expect(ruleText(rule)).toBe('Classic spam keywords');
    expect(ruleText(rule, 'en')).toBe('Classic spam keywords');
    expect(ruleText(rule, 'es')).toBe('Palabras típicas de spam');
  });

  it('ruleText: a custom rule without translation keeps the site voice', () => {
    const rule: Rule = { id: 'my-house-rule', type: 'count', pattern: 'x', threshold: 1, weight: 1, description: 'The house rule' };
    expect(ruleText(rule, 'es')).toBe('The house rule');
  });
});
