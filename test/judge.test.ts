import { describe, expect, it } from 'vitest';
import { createModel, train } from '../src/bayes.js';
import { toFields, toText, judge, trainFields } from '../src/judge.js';
import { defaultRulePack } from '../src/rules-default.js';
import { tokenize } from '../src/tokenizer.js';
import type { BayesModel } from '../src/bayes.js';

const SPAM_TRAINING = [
  'cheap viagra casino http://spam.xyz',
  'best casino bonus viagra http://pills.top',
  'viagra sale casino online http://drugs.xyz',
  'casino jackpot viagra pills http://bonus.top',
  'free viagra casino chips http://win.xyz',
  'online casino viagra shop http://pills2.top',
];
const HAM_TRAINING = [
  'hola quiero información sobre sus servicios gracias',
  'buenas tardes me gustaría pedir presupuesto gracias',
  'hola ¿cuánto cuesta el envío a galicia? saludos',
  'buenos días quiero cambiar mi pedido gracias',
  '¿tenéis horario de sábado? un saludo gracias',
  'hola el producto llegó perfecto muchas gracias',
];

function trainedModel(docs = 6): BayesModel {
  const m = createModel();
  for (const d of SPAM_TRAINING) train(m, tokenize(d), 'spam');
  for (const d of HAM_TRAINING) train(m, tokenize(d), 'ham');
  for (let i = 0; i < docs - 6; i++) {
    train(m, tokenize(`oferta viagra casino numero ${i} http://x${i}.xyz`), 'spam');
    train(m, tokenize(`mensaje normal numero ${i} gracias por su tiempo`), 'ham');
  }
  return m;
}

describe('judge', () => {
  it('cold model (empty): the rules decide and bayes is null', () => {
    const v = judge('cheap viagra casino http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz', createModel());
    expect(v.phase).toBe('cold');
    expect(v.bayes).toBeNull();
    expect(v.decision).toBe('quarantine');
    expect(v.reasons.some((r) => r.code.startsWith('rule:'))).toBe(true);
  });

  it('clean ham on a cold model passes without noise', () => {
    const v = judge('Hola, quería preguntar el precio de la reforma del baño. Gracias.', createModel());
    expect(v.decision).toBe('pass');
    expect(v.probability).toBe(0);
    expect(v.rules).toBe(0);
  });

  it('with a small corpus the bayes cannot veto clear rules', () => {
    // Nursery corpus (6+6): bayes weight ~0.06. Two 3-point rules must quarantine
    // even if a green bayes says something silly.
    const v = judge('cheap viagra casino http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz', trainedModel(6));
    expect(v.phase).toBe('trained');
    expect(v.rules).toBeGreaterThanOrEqual(6);
    expect(v.decision).toBe('quarantine');
  });

  it('with a mature corpus the bayes fuses with full voice', () => {
    const v = judge('cheap viagra casino http://nueva.xyz', trainedModel(25));
    expect(v.phase).toBe('trained');
    expect(v.bayes).not.toBeNull();
    expect(v.bayes!).toBeGreaterThan(0.9);
    expect(v.decision).toBe('quarantine');
    expect(v.reasons.some((r) => r.code === 'bayes')).toBe(true);
    expect(v.reasons.some((r) => r.code === 'fusion')).toBe(true);
  });

  it('trained: clean ham passes even if the bayes smells something', () => {
    const v = judge('Hola, quería preguntar el precio del producto. Gracias.', trainedModel());
    expect(v.decision).toBe('pass');
    expect(v.probability).toBeLessThan(0.5);
  });

  it('adjustable thresholds: quarantine 0 turns everything into quarantine', () => {
    const v = judge('hola que tal', createModel(), { thresholds: { quarantine: 0 } });
    expect(v.decision).toBe('quarantine');
  });

  it('direct reject with a low threshold', () => {
    const v = judge(
      'cheap viagra casino http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
      createModel(),
      { thresholds: { reject: 0.5 } },
    );
    expect(v.decision).toBe('reject');
  });

  it('rulePack: null disables the rules', () => {
    const v = judge('cheap viagra casino enlaces por todas partes', createModel(), { rulePack: null });
    expect(v.rules).toBe(0);
    expect(v.decision).toBe('pass');
  });

  it('accepts the form fields object and names the guilty field', () => {
    const input = {
      nombre: 'lucky',
      mensaje: 'best casino bonus viagra http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz',
    };
    const v = judge(input, createModel());
    expect(v.meta.fields).toBe(2);
    expect(v.decision).toBe('quarantine');
    const culprit = v.reasons.find((r) => r.code.startsWith('rule:'));
    expect(culprit?.field).toBe('mensaje');
  });

  it('empty fields do not count', () => {
    expect(Object.keys(toFields({ nombre: 'ana', mensaje: '  ' }))).toEqual(['nombre']);
    expect(toText(toFields('hola'))).toBe('hola');
  });

  it('trainFields accepts objects and adds documents', () => {
    const m = createModel();
    trainFields(m, { mensaje: 'viagra casino gratis' }, 'spam');
    expect(m.docs.spam).toBe(1);
  });

  it('maxFieldLength bounds each field before judging (DoS cap)', () => {
    const m = createModel();
    const largo = 'hola que tal '.repeat(2_000) + ' viagra casino'; // chivo fuera del límite
    const v = judge(largo, m, { maxFieldLength: 200 });
    expect(v.rules).toBe(0); // lo truncado no se juzga
    expect(v.meta.tokens).toBeLessThanOrEqual(60);
    const corto = judge('viagra casino', m, { maxFieldLength: 200 });
    expect(corto.rules).toBeGreaterThanOrEqual(3);
  });

  it('green booster: a small CONVINCED bayes quarantines a novel family without rules', () => {
    // 2 ham reales de historia + 1 variante marcada como basura → la familia
    // comparte tokens y el booster verde la retiene para revisión
    const m = createModel();
    train(m, tokenize('hola quería saber el precio del curso gracias'), 'ham');
    train(m, tokenize('buenas tardes me gustaría pedir presupuesto saludos'), 'ham');
    const familia = 'Buenas! Escribimos contenido unico para tu blog con enlaces incluidos sin coste http://guest-post-1.example';
    const variante = 'Hola admin, te ofrezco articulos con enlaces de nuestros clientes sin coste http://guest-post-2.example';
    train(m, tokenize(familia), 'spam');
    const v = judge(variante, m);
    expect(v.decision).toBe('quarantine');
    expect(v.reasons.some((r) => r.code === 'bayes-convinced')).toBe(true);
    // y un ham real no lo dispara
    const ham = judge('Hola, quería preguntar el precio', m);
    expect(ham.decision).toBe('pass');
  });

  it('the default pack ships built in', () => {
    expect(defaultRulePack.rules.length).toBeGreaterThanOrEqual(6);
    expect(defaultRulePack.name).toBe('default');
  });
});
