// The judge: bayes + rules fused into a verdict.
// - Cold (small corpus): the rules decide alone.
// - Trained: probabilities fused with configurable weights.
// - One public signature: judge(input, model) → verdict.

import { probability, train } from './bayes.js';
import type { BayesModel } from './bayes.js';
import { evaluateRules } from './rules.js';
import type { RulesOutcome } from './rules.js';
import { defaultRulePack } from './rules-default.js';
import { tokenize } from './tokenizer.js';
import type { Decision, Label, JudgeOptions, Reason, Verdict } from './types.js';

const DEFAULT_THRESHOLDS = { quarantine: 0.5, reject: 0.85 };
/** A rule weight of 6 saturates near 0.63; 12 points, near 0.86. */
const WEIGHT_SATURATION = 6;
/** Documents per class before the bayes is considered trained. */
export const MIN_DOCS_DEFAULT = 5;
/**
 * The bayes earns its voice as its corpus matures: under DOCS_TARGET documents
 * per class it weighs proportionally less and the rules carry the verdict.
 * A 12-document corpus must never veto a rule that just saw six links.
 */
const DOCS_TARGET = 50;

/** Accepts a bare string or the form fields object as it arrives. */
export function toFields(input: string | Record<string, string>): Record<string, string> {
  if (typeof input === 'string') return { message: input };
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && v.trim().length > 0) fields[k] = v;
  }
  return fields;
}

export function toText(fields: Record<string, string>): string {
  return Object.values(fields).join('\n');
}

function rulesProbability(weight: number): number {
  return 1 - Math.exp(-weight / WEIGHT_SATURATION);
}

export function judge(
  input: string | Record<string, string>,
  model: BayesModel,
  options: JudgeOptions = {},
): Verdict {
  const pack = options.rulePack === undefined ? defaultRulePack : options.rulePack;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const bayesWeight = options.bayesWeight ?? 0.5;
  const minDocs = options.minDocs ?? MIN_DOCS_DEFAULT;

  const maxFieldLength = options.maxFieldLength ?? 20_000;
  const rawFields = toFields(input);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFields)) {
    fields[k] = v.length > maxFieldLength ? v.slice(0, maxFieldLength) : v;
  }
  const tokens = tokenize(toText(fields));
  const reasons: Reason[] = [];

  let rulesOutcome: RulesOutcome = { weight: 0, reasons: [] };
  if (pack && pack.rules.length > 0) {
    rulesOutcome = evaluateRules(fields, pack, { locale: options.locale });
  }
  reasons.push(...rulesOutcome.reasons);

  const trained = model.docs.spam >= minDocs && model.docs.ham >= minDocs;
  let bayesProbability: number | null = null;
  const bothClassesSeen = model.docs.spam > 0 && model.docs.ham > 0;
  if (trained || bothClassesSeen) {
    bayesProbability = probability(model, tokens);
    if (bayesProbability !== null) {
      reasons.push({ code: 'bayes', detail: bayesProbability.toFixed(3) });
    }
  }

  const rulesProbability_ = rulesProbability(rulesOutcome.weight);
  if (rulesOutcome.weight > 0) {
    reasons.push({ code: 'rules', detail: `${rulesOutcome.weight} pt(s) → ${rulesProbability_.toFixed(3)}` });
  }

  const effectiveBayesWeight =
    trained && bayesProbability !== null
      ? bayesWeight * Math.min(1, Math.min(model.docs.spam, model.docs.ham) / DOCS_TARGET)
      : 0;
  let fused =
    effectiveBayesWeight > 0
      ? Math.min(1, Math.max(0, effectiveBayesWeight * bayesProbability! + (1 - effectiveBayesWeight) * rulesProbability_))
      : rulesProbability_;
  reasons.push({ code: 'fusion', detail: `${fused.toFixed(3)} (bayes weight ${effectiveBayesWeight.toFixed(2)})` });

  let decision: Decision = 'pass';
  if (fused >= thresholds.reject) decision = 'reject';
  else if (fused >= thresholds.quarantine) decision = 'quarantine';

  // Green-phase booster: a small but CONVINCED bayes quarantines even without
  // rules (novel spam family: 2-3 marked examples + the site's own ham history
  // already present). Quarantine is reviewable — a false positive costs one
  // click; a false negative costs another month of the same slop in the inbox.
  // El suelo del bayes convencido aplica en TODAS las fases: con 4 documentos o
  // con 4.000, si el clasificador está convencido (p ≥ floor) y las reglas no
  // alcanzaron cuarentena, el envío se retiene para revisión. Sin este suelo,
  // aprender (salir de fase verde) DEGRADABA la protección — la regresión que
  // la revisión externa reprodujo con la tabla 4/5/50 documentos.
  const convincedFloor = options.greenQuarantine ?? 0.9;
  let boosted = false;
  if (bayesProbability !== null && bayesProbability >= convincedFloor && decision === 'pass') {
    decision = 'quarantine';
    fused = Math.max(fused, bayesProbability);
    boosted = true;
    reasons.push({
      code: 'bayes-convinced',
      detail: `bayes convencido (${bayesProbability.toFixed(3)}) → cuarentena revisable`,
    });
  }

  return {
    decision,
    probability: fused,
    bayes: bayesProbability,
    rules: rulesOutcome.weight,
    phase: trained ? 'trained' : 'cold',
    reasons,
    meta: { tokens: tokens.length, fields: Object.keys(fields).length },
  };
}

/** Same as `judge`, but trains: the owner's "this was garbage" button. */
export function trainFields(
  model: BayesModel,
  input: string | Record<string, string>,
  label: Label,
): BayesModel {
  return train(model, tokenize(toText(toFields(input))), label);
}
