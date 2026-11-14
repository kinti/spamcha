// EL ZOOLÓGICO DE MUTANTES: nos probamos a los bestia.
// Cada mutante es una estrategia de evasión real. El zoológico corre contra un
// guard sin entrenar (día 0) y otra vez tras el clic del dueño, e imprime el
// marcador: quién muere, en qué capa, y quién escapa (los escapes del día 0
// son HONESTOS: son exactamente los que el bucle de aprendizaje existe para
// matar; aquí se demuestra que el clic los mata).
//
// autoHam está APAGADO en el zoológico a propósito: aquí el feedback es manual
// (el comportamiento del autoHam tiene su propio test en guard.test.ts).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGatekeeper } from '../src/guard.js';
import { trainFields } from '../src/judge.js';
import type { Gatekeeper } from '../src/guard.js';

const SECRET = 'long-random-phrase-for-the-mutant-zoo';
const dir = mkdtempSync(join(tmpdir(), 'spamcha-zoo-'));
const stealth = { stampField: 'qw72mrxkeb', honeypotField: 'empresa37' };

const guard = createGatekeeper({
  secret: SECRET,
  modelPath: join(dir, 'spamcha.json'),
  quarantinePath: join(dir, 'cuarentena.jsonl'),
  logPath: join(dir, 'log.jsonl'),
  stampField: stealth.stampField,
  honeypotField: stealth.honeypotField,
  rateLimit: { max: 5, windowMs: 60_000 },
  minAgeMs: 3_000,
  autoHam: false,
});

const sello = (): Promise<string> => guard.stampToken();
const despues = (ms: number): number => Date.now() + ms;

type Bestia = {
  nombre: string;
  estrategia: string;
  esperado: 'reject' | 'quarantine' | 'pass-dia0';
  resultado: () => Promise<{ decision: string; capa: string }>;
};

const bestias: Bestia[] = [
  {
    nombre: 'M1 POST directo',
    estrategia: 'strike al handler sin renderizar nada',
    esperado: 'reject',
    resultado: async () => {
      const v = await guard.review({ nombre: 'bot', mensaje: 'compra ahora http://x.example' }, { ip: '9.1.0.1', now: despues(4_000) });
      return { decision: v.decision, capa: v.signals[0]?.code ?? '?' };
    },
  },
  {
    nombre: 'M2 honeypot rellena-todo',
    estrategia: 'con sello válido, pero rellena también el campo trampa',
    esperado: 'reject',
    resultado: async () => {
      const token = await sello();
      const v = await guard.review(
        { mensaje: 'oferta', [stealth.stampField]: token, [stealth.honeypotField]: 'http://trampa.example' },
        { ip: '9.1.0.2', now: despues(4_000) },
      );
      return { decision: v.decision, capa: v.signals.find((s) => s.code.startsWith('honeypot'))?.code ?? v.signals[0]?.code ?? '?' };
    },
  },
  {
    nombre: 'M3 honeypot limpio, sin sello',
    estrategia: 'deja la trampa vacía pero nunca renderizó el formulario',
    esperado: 'reject',
    resultado: async () => {
      const v = await guard.review(
        { nombre: 'bot', mensaje: 'hola', website: '' },
        { ip: '9.1.0.3', now: despues(4_000) },
      );
      return { decision: v.decision, capa: v.signals[0]?.code ?? '?' };
    },
  },
  {
    nombre: 'M4 render-relámpago',
    estrategia: 'renderiza con navegador real y postea en 0,5 s',
    esperado: 'reject',
    resultado: async () => {
      const token = await sello();
      const v = await guard.review(
        { mensaje: 'hola me interesa', [stealth.stampField]: token, [stealth.honeypotField]: '' },
        { ip: '9.1.0.4', now: despues(500) },
      );
      return { decision: v.decision, capa: v.signals[0]?.code ?? '?' };
    },
  },
  {
    nombre: 'M5 slop clásico paciente',
    estrategia: 'espera 4 s, renderiza y manda viagra+casino+6 enlaces',
    esperado: 'quarantine',
    resultado: async () => {
      const token = await sello();
      const v = await guard.review(
        {
          mensaje: 'cheap viagra casino payday loans visite http://a.example http://b.example http://c.example http://d.example http://e.example http://f.example',
          [stealth.stampField]: token,
          [stealth.honeypotField]: '',
        },
        { ip: '9.1.0.5', now: despues(4_000) },
      );
      return { decision: v.decision, capa: v.reasons[0]?.code ?? 'reglas' };
    },
  },
  {
    nombre: 'M6 familia nueva sin huellas',
    estrategia: 'guest-posting pulido: sin palabras-chivo, 1 enlace, texto largo y amable',
    esperado: 'pass-dia0',
    resultado: async () => {
      const token = await sello();
      const v = await guard.review(
        {
          mensaje: 'Buenas! Escribimos contenido unico para tu blog con enlaces incluidos sin coste para ti, tema ocio y viajes http://guest-zoo.example',
          [stealth.stampField]: token,
          [stealth.honeypotField]: '',
        },
        { ip: '9.1.0.6', now: despues(4_000) },
      );
      return { decision: v.decision, capa: v.decision === 'pass' ? 'ESCAPA día 0: el clic lo mata' : 'bayes-arranque' };
    },
  },
  {
    nombre: 'M7 replay industrial',
    estrategia: 'renderiza UNA vez y re-postea el mismo sello cinco veces',
    esperado: 'reject',
    resultado: async () => {
      const token = await sello();
      const capas: string[] = [];
      for (let i = 0; i < 5; i++) {
        const v = await guard.review(
          { mensaje: `mensaje replay ${i}`, [stealth.stampField]: token, [stealth.honeypotField]: '' },
          { ip: '9.1.0.7', now: despues(4_000 + i * 1_000) },
        );
        capas.push(v.signals[0]?.code ?? v.decision);
      }
      const replayed = capas.filter((c) => c === 'stamp:replayed').length;
      return { decision: replayed >= 4 ? 'reject' : 'pass', capa: capas.join(',') };
    },
  },
  {
    nombre: 'M8 adivina-spamcha',
    estrategia: 'sabe que existen plugins antispam: manda el campo "spamcha" con papilla',
    esperado: 'reject',
    resultado: async () => {
      const v = await guard.review(
        { mensaje: 'oferta patrocinada', spamcha: 'valor-adivinado', website: '' },
        { ip: '9.1.0.8', now: despues(4_000) },
      );
      return { decision: v.decision, capa: v.signals[0]?.code ?? '?' };
    },
  },
];

describe('zoológico de mutantes: día 0 (sin corpus)', () => {
  for (const bestia of bestias) {
    it(`${bestia.nombre}: ${bestia.estrategia}`, async () => {
      const r = await bestia.resultado();
      if (bestia.esperado === 'pass-dia0') {
        expect(r.decision).toBe('pass');
        console.log(`  🏃 ESCAPA (${bestia.nombre}): ${r.capa}`);
      } else {
        expect(r.decision).toBe(bestia.esperado);
        console.log(`  ☠ (${bestia.nombre}) capa: ${r.capa}`);
      }
    });
  }
});

describe('zoológico: día 1+: el clic del dueño contra los escapistas', () => {
  it('M6 tras 3 marcas: la familia entera cae (booster verde), sin falsos positivos', async () => {
    // el tráfico real del día construye el lado ham automáticamente
    for (const h of [
      'Buenas tardes, quería preguntar el precio del curso para 10 personas.',
      'Hola! ¿tenéis disponibilidad el sábado por la mañana? Gracias.',
      'Buenos días, presupuesto para la reforma de la cocina, gracias.',
      'Saludos, ¿el envío a canarias tarda mucho? Un saludo.',
      'Hola, el paquete llegó dañado, ¿qué hago? Gracias.',
      'Buenas, me interesa el modelo azul, ¿tenéis stock?',
    ]) {
      trainFields(guard.model, h, 'ham');
    }
    // y llegan MÁS de la familia: pasan (día 0 para ellas), quedan en el inbox
    const inbox = [
      'Buenas! Escribimos contenido unico para tu blog con enlaces incluidos sin coste http://guest-zoo-2.example',
      'Hola admin, articulos patrocinados de calidad con enlaces dofollow sin coste http://guest-zoo-3.example',
      'Que tal! Notas de prensa gratis con enlaces de nuestros clientes http://guest-zoo-4.example',
    ];
    for (const mensaje of inbox) {
      const token = await sello();
      await guard.review(
        { mensaje, [stealth.stampField]: token, [stealth.honeypotField]: '' },
        { ip: '9.1.0.6', now: despues(4_000) },
      );
    }
    // el dueño, harto, marca los tres desde su correo → el clic entrena
    for (const mensaje of inbox) trainFields(guard.model, mensaje, 'spam');

    // la cuarta variante NUNCA vista cae: tokens compartidos de la familia
    const token = await sello();
    const v = await guard.review(
      {
        mensaje: 'Saludos! Tenemos redaccion nativa para tu sitio: textos unicos con enlaces de nuestros clientes sin coste http://guest-zoo-5.example',
        [stealth.stampField]: token,
        [stealth.honeypotField]: '',
      },
      { ip: '9.1.0.9', now: despues(4_000) },
    );
    console.log('DEBUG variante 4:', JSON.stringify({ decision: v.decision, probability: v.probability, bayes: v.bayes, rules: v.rules, phase: v.phase, signals: v.signals, reasons: v.reasons }, null, 1));
    expect(v.decision).toBe('quarantine');

    // y el ham real NO cae
    const tokenHam = await sello();
    const ham = await guard.review(
      { mensaje: 'Buenas tardes, quería preguntar el precio de la reforma del baño.', [stealth.stampField]: tokenHam, [stealth.honeypotField]: '' },
      { ip: '9.1.0.9', now: despues(4_000) },
    );
    expect(ham.decision).toBe('pass');
  });

  it('M10 plantilla idéntica ×10: una marca mata las diez', async () => {
    const g2 = createGatekeeper({
      secret: SECRET,
      modelPath: join(dir, 'modelo-plantilla.json'),
      autoHam: false,
      minAgeMs: 3_000,
    });
    // historia ham real del sitio (sin ella el bayes no tiene contra qué discriminar)
    for (const h of [
      'Buenas tardes, quería preguntar el precio del curso para 10 personas.',
      'Hola! ¿tenéis disponibilidad el sábado por la mañana? Gracias.',
      'Buenos días, presupuesto para la reforma de la cocina, gracias.',
      'Saludos, ¿el envío a canarias tarda mucho? Un saludo.',
      'Hola, el paquete llegó dañado, ¿qué hago? Gracias.',
    ]) {
      trainFields(g2.model, h, 'ham');
    }
    const plantilla = 'Le escribo porque tenemos una inversión garantizada del tres por ciento mensual sin riesgo alguno, contacte conmigo';
    const veredictos: string[] = [];
    for (let i = 0; i < 10; i++) {
      const token = await g2.stampToken();
      const v = await g2.review(
        { mensaje: plantilla, spamcha: token, website: '' },
        { ip: '9.2.0.1', now: Date.now() + 4_000 + i },
      );
      veredictos.push(v.decision);
    }
    expect(veredictos.every((d) => d === 'pass')).toBe(true); // día 0 escapan: HONESTO

    // una marca del dueño (los diez textos son idénticos: mismo token-set)
    trainFields(g2.model, plantilla, 'spam');
    let cazadas = 0;
    for (let i = 0; i < 10; i++) {
      const token = await g2.stampToken();
      const v = await g2.review(
        { mensaje: plantilla, spamcha: token, website: '' },
        { ip: '9.2.0.1', now: Date.now() + 4_000 + i },
      );
      if (v.decision !== 'pass') cazadas++;
    }
    expect(cazadas).toBe(10);
  });
});
