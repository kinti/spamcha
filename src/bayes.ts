// Hand-rolled Naive Bayes classifier — no dependencies to drag around.
// The bogofilter/SpamProbe pattern from email, applied to forms for the first time.

import type { Label } from './types.js';

export interface BayesModel {
  version: number;
  createdAt: string;
  trainedAt: string | null;
  /** Documents (submissions) trained per class. */
  docs: Record<Label, number>;
  /** Token → counts per class. */
  counts: Record<string, Record<Label, number>>;
  /** Total token counts per class. */
  totals: Record<Label, number>;
  vocabulary: number;
}

export function createModel(): BayesModel {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    trainedAt: null,
    docs: { spam: 0, ham: 0 },
    counts: {},
    totals: { spam: 0, ham: 0 },
    vocabulary: 0,
  };
}

const SMOOTHING = 0.5;
/** Log-odds ceiling so `exp` never overflows on very long texts. */
const LOG_ODDS_CAP = 40;

/**
 * Trains the model with one document (mutates and returns the same model,
 * so calls can chain). `tokens` is what `tokenize` produced.
 */
export function train(model: BayesModel, tokens: string[], label: Label): BayesModel {
  model.docs[label] += 1;
  for (const t of tokens) {
    const entry = model.counts[t];
    if (entry) {
      entry[label] += 1;
    } else {
      model.counts[t] = { spam: label === 'spam' ? 1 : 0, ham: label === 'ham' ? 1 : 0 };
    }
    model.totals[label] += 1;
  }
  model.vocabulary = Object.keys(model.counts).length;
  model.trainedAt = new Date().toISOString();
  return model;
}

/**
 * P(spam | tokens). `null` while either class has zero documents
 * (the judge then decides on rules alone, `cold` phase).
 *
 * Each token contributes its own smoothed probability (Graham-style, "A Plan
 * for Spam" — not raw multinomial): `(s+a)/(s+h+2a)` is independent of the
 * class totals, so a completely unseen text stays neutral at the prior instead
 * of drifting toward whichever class saw more tokens during training.
 * In-document multiplicity amplifies each token's voice (repeats push).
 */
export function probability(model: BayesModel, tokens: string[]): number | null {
  if (model.docs.spam === 0 || model.docs.ham === 0) return null;

  let logOdds = Math.log(model.docs.spam / model.docs.ham);

  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

  for (const [t, n] of counts) {
    const entry = model.counts[t];
    const s = entry?.spam ?? 0;
    const h = entry?.ham ?? 0;
    const p = (s + SMOOTHING) / (s + h + 2 * SMOOTHING);
    logOdds += n * Math.log(p / (1 - p));
  }

  if (logOdds > LOG_ODDS_CAP) logOdds = LOG_ODDS_CAP;
  if (logOdds < -LOG_ODDS_CAP) logOdds = -LOG_ODDS_CAP;
  return 1 / (1 + Math.exp(-logOdds));
}
