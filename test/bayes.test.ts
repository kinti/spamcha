import { describe, expect, it } from 'vitest';
import { createModel, probability, train } from '../src/bayes.js';
import type { BayesModel } from '../src/bayes.js';
import { tokenize } from '../src/tokenizer.js';
import type { Label } from '../src/types.js';

const SPAM = [
  'cheap viagra casino links http://spam.xyz',
  'best casino bonus viagra http://pills.top',
  'viagra sale casino online http://drugs.xyz',
  'casino jackpot viagra pills http://bonus.top',
  'free viagra casino chips http://win.xyz',
  'online casino viagra shop http://pills2.top',
];
const HAM = [
  'hola quiero información sobre sus servicios gracias',
  'buenas tardes me gustaría pedir presupuesto gracias',
  'hola ¿cuánto cuesta el envío a galicia? saludos',
  'buenos días quiero cambiar mi pedido gracias',
  '¿tenéis horario de sábado? un saludo gracias',
  'hola el producto llegó perfecto muchas gracias',
];

function trainedModel(): BayesModel {
  const m = createModel();
  const trainClass = (docs: string[], label: Label): void => {
    for (const d of docs) train(m, tokenize(d), label);
  };
  trainClass(SPAM, 'spam');
  trainClass(HAM, 'ham');
  return m;
}

describe('bayes', () => {
  it('a fresh model knows nothing', () => {
    expect(probability(createModel(), ['hola'])).toBeNull();
  });

  it('learns to separate obvious spam', () => {
    const m = trainedModel();
    expect(probability(m, tokenize('viagra casino http://nueva.xyz'))!).toBeGreaterThan(0.9);
  });

  it('learns to separate obvious ham', () => {
    const m = trainedModel();
    expect(probability(m, tokenize('hola quiero cambiar mi pedido saludos'))!).toBeLessThan(0.1);
  });

  it('repeats push the verdict', () => {
    const m = trainedModel();
    const once = probability(m, tokenize('viagra'))!;
    const thrice = probability(m, tokenize('viagra viagra viagra'))!;
    expect(thrice).toBeGreaterThan(once);
  });

  it('counts and vocabulary are recorded', () => {
    const m = trainedModel();
    expect(m.docs).toEqual({ spam: 6, ham: 6 });
    expect(m.vocabulary).toBeGreaterThan(10);
    expect(m.trainedAt).not.toBeNull();
  });
});
