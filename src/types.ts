// Shared types. Everything that crosses modules lives here.
// Naming convention (public repo, international): identifiers in English,
// human-facing strings resolved through the locale packs (see locales.ts).

/** The two classes of the judge. */
export type Label = 'spam' | 'ham';

/** Final decision over a submission. Humans never participate. */
export type Decision = 'pass' | 'quarantine' | 'reject';

/** One reason behind the verdict: stable code + optional human text. */
export interface Reason {
  /** Stable code, never translated: `rule:dense-links`, `bayes`, `fusion`… */
  code: string;
  /** Human text (locale pack or the site's own rule description). */
  text?: string;
  /** Form field that triggered it, if any. */
  field?: string;
  /** Numeric detail, locale-neutral: `3/1`, `68%`, `4.2/1000`. */
  detail?: string;
}

export interface Verdict {
  decision: Decision;
  /** Final spam probability (bayes + rules fused), 0..1. */
  probability: number;
  /** The Bayesian classifier's probability; `null` without enough data. */
  bayes: number | null;
  /** Summed weight of the rules that fired. */
  rules: number;
  /** `cold` = small corpus (rules decide); `trained` = fused. */
  phase: 'cold' | 'trained';
  reasons: Reason[];
  meta: { tokens: number; fields: number };
}

/** Decision thresholds over the fused probability. */
export interface Thresholds {
  /** ≥ quarantine → don't process right away (e.g. double opt-in). */
  quarantine: number;
  /** ≥ reject → drop it. */
  reject: number;
}

export interface JudgeOptions {
  thresholds?: Partial<Thresholds>;
  /** Rule pack. Defaults to `defaultRulePack`; `null` disables rules. */
  rulePack?: RulePack | null;
  /** Bayes weight in the fusion (0..1); the rest goes to the rules. */
  bayesWeight?: number;
  /** Minimum documents per class to consider the model trained. */
  minDocs?: number;
  /** Locale for the human-facing texts of the verdict (default `es`). */
  locale?: 'es' | 'en';
}

/** One declarative rule of a pack. Three types, all regex-based: */
export interface Rule {
  /** Stable identifier, e.g. `dense-links`. */
  id: string;
  type: 'count' | 'ratio' | 'density';
  /** Regex source (compiled with `gu` flags by default). */
  pattern: string;
  flags?: string;
  /**
   * `count`: minimum number of matches.
   * `ratio`: matched character share (0..1).
   * `density`: matches per 1000 characters.
   */
  threshold: number;
  /** If set, the rule only evaluates that field. */
  field?: string;
  /** Skip the rule for texts shorter than this. */
  minLength?: number;
  /** Points added when it fires. */
  weight: number;
  description?: string;
}

export interface RulePack {
  name: string;
  rules: Rule[];
}
