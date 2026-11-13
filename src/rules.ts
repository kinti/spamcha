// Declarative rule engine: mosparo's idea ported to TS, editable per site.
// Three types (count, ratio, density), all regex-based. Rules are JSON;
// reasons carry stable codes so a quarantine can explain itself.
// Human texts resolve through the locale layer (see locales.ts).

import { ruleText } from './locales.js';
import type { Locale } from './locales.js';
import type { Reason, Rule, RulePack } from './types.js';

const cache = new Map<string, RegExp>();

function regexFor(rule: Rule): RegExp {
  const key = `${rule.pattern}::${rule.flags ?? 'gu'}`;
  let re = cache.get(key);
  if (!re) {
    try {
      re = new RegExp(rule.pattern, rule.flags ?? 'gu');
    } catch {
      throw new Error(`Rule "${rule.id}" has an invalid pattern: ${rule.pattern}`);
    }
    cache.set(key, re);
  }
  return re;
}

export interface RulesOutcome {
  /** Summed weight of the rules that fired. */
  weight: number;
  reasons: Reason[];
}

/** Evaluates the pack over each field of the submission. */
export function evaluateRules(
  fields: Record<string, string>,
  pack: RulePack,
  options: { locale?: Locale } = {},
): RulesOutcome {
  const reasons: Reason[] = [];
  let weight = 0;

  for (const rule of pack.rules) {
    for (const [field, text] of Object.entries(fields)) {
      if (rule.field && rule.field !== field) continue;
      const length = text.length;
      if (length === 0) continue;
      if (rule.minLength && length < rule.minLength) continue;

      const matches = text.match(regexFor(rule));
      const n = matches ? matches.length : 0;
      let fired = false;
      let detail = '';

      if (rule.type === 'count') {
        fired = n >= rule.threshold;
        detail = `${n}/${rule.threshold}`;
      } else if (rule.type === 'density') {
        const d = (n * 1000) / length;
        fired = d >= rule.threshold;
        detail = `${d.toFixed(1)}/1000`;
      } else {
        const matched = matches ? matches.reduce((s, m) => s + m.length, 0) : 0;
        const ratio = matched / length;
        fired = ratio >= rule.threshold;
        detail = `${Math.round(ratio * 100)}%`;
      }

      if (fired) {
        weight += rule.weight;
        reasons.push({
          code: `rule:${rule.id}`,
          text: ruleText(rule, options.locale),
          field,
          detail,
        });
      }
    }
  }

  return { weight, reasons };
}
