// Model persistence: one readable, portable, git-friendly JSON file.
// Only node:fs: the browser never trains, it just queries (and there you use
// bayes.ts directly, feeding the model JSON over the wire).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BayesModel } from './bayes.js';

export function saveModel(model: BayesModel, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(model, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function loadModel(path: string): BayesModel {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as BayesModel;
  if (!raw || typeof raw !== 'object' || !raw.counts || !raw.docs) {
    throw new Error(`File ${path} is not a spamcha model`);
  }
  return raw;
}
