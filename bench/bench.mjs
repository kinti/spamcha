import { createModel, judge, train, tokenize, trainFields, issueStamp, verifyStamp, signFeed, verifyFeed, generateFeedKeyPair } from '../dist/index.js';

const humano = "Hola, quería preguntar el precio del curso intensivo para un grupo de 12 personas en noviembre. ¿Hay descuento para grupos? Gracias de antemano.";
const spam = "cheap viagra casino bonus payday loans, visite http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz http://f.xyz";

function bench(nombre, fn, iters) {
  for (let i = 0; i < Math.min(1000, iters); i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = performance.now() - t0;
  const ops = iters / (ms / 1000);
  console.log(`${nombre}: ${ops.toFixed(0)} ops/s (${(ms/iters*1000).toFixed(1)} µs/op)`);
  return ops;
}
async function benchAsync(nombre, fn, iters) {
  for (let i = 0; i < 200; i++) await fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  const ms = performance.now() - t0;
  console.log(`${nombre}: ${(iters / (ms / 1000)).toFixed(0)} ops/s (${(ms/iters*1000).toFixed(1)} µs/op)`);
}

console.log('── TOKENIZADOR ──');
bench('tokenizar texto 1 KB', () => tokenize(humano + humano + humano + humano + humano + humano + humano + humano + humano + humano + humano + humano + humano + humano + humano), 3000);

console.log('── JUEZ ──');
const frio = createModel();
bench('judge FRÍO (solo reglas)', () => judge(spam, frio), 20000);
const m = createModel();
for (let i = 0; i < 500; i++) train(m, tokenize(`consulta normal ${i} sobre horarios y precios de cursos gracias`), 'ham');
for (let i = 0; i < 500; i++) train(m, tokenize(`oferta viagra casino ${i} http://x${i}.xyz`), 'spam');
bench('judge ENTRENADO 1000 docs', () => judge(spam, m), 20000);
bench('judge ham legítimo (entrenado)', () => judge(humano, m), 20000);

console.log('── SELLO ──');
await benchAsync('issueStamp (HMAC)', () => issueStamp('secreto-de-bench-frase-larga'), 3000);
const token = await issueStamp('secreto-de-bench-frase-larga');
await benchAsync('verifyStamp (HMAC + tiempo)', () => verifyStamp(token, 'secreto-de-bench-frase-larga', { now: Date.now() + 10000 }), 3000);

console.log('── FEEDS ──');
const keys = await generateFeedKeyPair();
const canal = { channel: 'bench/es', version: 1, updatedAt: '2026-11-14T00:00:00Z', expiresAt: '2027-06-01T00:00:00Z',
  rules: Array.from({length: 20}, (_, i) => ({ id: `regla${i}`, type: 'count', pattern: `palabra${i}|otra${i}`, threshold: 1, weight: 3 })),
  domains: Array.from({length: 50}, (_, i) => `dominio${i}.xyz`) };
const firmado = await signFeed(canal, keys.private);
await benchAsync('verifyFeed (Ed25519, 20 reglas + 50 dominios)', () => verifyFeed(firmado, keys.public, { now: new Date('2026-11-14') }), 1000);

console.log('── MEMORIA DEL MODELO ──');
const m2 = createModel();
for (let i = 0; i < 1000; i++) {
  trainFields(m2, `mensaje numero ${i} con palabras variadas ${i} sobre ${i} temas http://dom${i}.example`, 'spam');
  trainFields(m2, `consulta legitima numero ${i} pidiendo presupuesto detallado para proyecto ${i}`, 'ham');
}
const bytes = JSON.stringify(m2).length;
console.log(`modelo con 2000 documentos: ${(bytes/1024).toFixed(1)} KB en JSON (vocabulario ${m2.vocabulary})`);
const t0 = performance.now();
for (let i = 0; i < 5000; i++) judge(humano, m2);
console.log(`judge sobre modelo 2000 docs: ${(5000/((performance.now()-t0)/1000)).toFixed(0)} ops/s`);
console.log(`heap: ${(process.memoryUsage().heapUsed/1024/1024).toFixed(1)} MB`);
