// The locale system, following the guild's pattern (SpamAssassin `lang xx
// describe`, ALTCHA i18n, gettext): immutable codes + per-locale string packs.
// spamcha is born in ENGLISH: the API, the CLI default and the pack
// descriptions. Spanish ships as a first-class translation (--locale es).
// Resolution priority: the site pack's own text → locale pack → the code itself
// (it never fails).

import type { Rule } from './types.js';
import { stringsEs } from './strings-es.js';
import { stringsEn } from './strings-en.js';

export type Locale = 'es' | 'en';
export const LOCALES: Locale[] = ['es', 'en'];
export const DEFAULT_LOCALE: Locale = 'en';

const PACKS: Record<Locale, Record<string, string>> = { es: stringsEs, en: stringsEn };

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as string[]).includes(value);
}

export function stringsFor(locale: Locale): Record<string, string> {
  return PACKS[locale];
}

/** Translates a code with `{variable}` interpolation. Falls back to the code itself. */
export function translate(
  code: string,
  options: { locale?: Locale; vars?: Record<string, string | number> } = {},
): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  let text = PACKS[locale][code] ?? PACKS[DEFAULT_LOCALE][code] ?? code;
  if (options.vars) {
    for (const [key, value] of Object.entries(options.vars)) {
      text = text.replaceAll(`{${key}}`, String(value));
    }
  }
  return text;
}

/**
 * A rule's human text: the pack's own description (site data) is the owner's
 * voice; if another locale is requested and a translation exists, it wins.
 */
export function ruleText(rule: Rule, locale?: Locale): string | undefined {
  if (locale !== undefined && locale !== DEFAULT_LOCALE) {
    const translation = PACKS[locale][`rule.${rule.id}`];
    if (translation !== undefined) return translation;
  }
  return rule.description;
}
