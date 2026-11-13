#!/usr/bin/env node
// spamcha demo v0.4: contact server + quarantine review page, in one file.
//   npm run demo   →  http://localhost:8787
//   · /            three forms (human, bot without stamp, bot filling honeypot)
//   · /submit      the full pipeline; quarantined submissions get stored
//   · /revision    THE button: review held submissions, mark spam/ham →
//                  the judge trains on the spot (visible in the model stats)
// Page text in Spanish (native locale); verdicts are JSON, codes immutable.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createGatekeeper } from './guard.js';

const PORT = Number(process.env.SPAMCHA_PORT ?? 8787);
const SECRET = process.env.SPAMCHA_SECRET ?? 'demo: change this for a long random phrase of your own';
const MODEL_PATH = process.env.SPAMCHA_MODEL ?? 'spamcha.json';
const QUARANTINE_PATH = process.env.SPAMCHA_QUARANTINE ?? 'spamcha-quarantine.jsonl';

const guard = createGatekeeper({
  secret: SECRET,
  modelPath: MODEL_PATH,
  quarantinePath: QUARANTINE_PATH,
  rateLimit: { max: 20, windowMs: 60_000 },
});
console.log(`Model: ${MODEL_PATH} (docs spam=${guard.model.docs.spam} ham=${guard.model.docs.ham})`);
console.log(`Quarantine: ${QUARANTINE_PATH} (${guard.listQuarantine().length} pendiente(s))`);

const PAGINA = (cuerpo: string): string => `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>spamcha — demo</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.5}
  form{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
  input,textarea{width:100%;box-sizing:border-box;margin:.25rem 0 1rem;padding:.5rem}
  button{padding:.4rem .9rem;cursor:pointer}
  .etiqueta{font-weight:600}
  pre{background:#f4f4f4;padding:.75rem;border-radius:6px;overflow-x:auto;font-size:.85rem}
  .pass{color:#067d17}.quarantine{color:#b58600}.reject{color:#da1e28}
  .entrada{border:1px solid #ddd;border-radius:6px;padding:.75rem;margin:.75rem 0}
  .entrada .campos{color:#555;font-size:.9rem;white-space:pre-wrap}
  .fila button{margin-right:.5rem}
  nav a{margin-right:1rem}
</style></head><body>
<h1>spamcha — juez de spam local</h1>
<nav><a href="/">Formulario</a> · <a href="/revision">Revisión de cuarentena (${guard.listQuarantine().length})</a></nav>
${cuerpo}
</body></html>`;

async function leerCuerpo(peticion: IncomingMessage): Promise<string> {
  let datos = '';
  for await (const trozo of peticion) datos += trozo;
  return datos;
}

function camposDe(crudo: string): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(crudo)) campos[k] = v;
  return campos;
}

async function responder(salida: ServerResponse, html: string, codigo = 200): Promise<void> {
  salida.writeHead(codigo, { 'content-type': 'text/html; charset=utf-8' });
  salida.end(PAGINA(html));
}

const servidor = createServer(async (peticion, salida) => {
  const ruta = peticion.url?.split('?')[0] ?? '/';

  // ─── Formulario + bots simulados ───────────────────────────────────────────
  if (peticion.method === 'GET' && (ruta === '/' || ruta === '/contact')) {
    const sello = await guard.stampHtml();
    const humano = `<form method="post" action="/submit">
${sello}
<label class="etiqueta" for="nombre">Tu nombre</label><input id="nombre" name="nombre">
<label class="etiqueta" for="mensaje">Mensaje</label><textarea id="mensaje" name="mensaje" rows="5"></textarea>
<button type="submit">Enviar (humano)</button></form>`;
    const bot1 = `<form method="post" action="/submit">
<legend>Simulación: bot que POSTea directo al handler (sin sello)</legend>
<input type="hidden" name="nombre" value="Anna de SEO-Growth">
<input type="hidden" name="mensaje" value="aumente su posicion en google con backlinks premium http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz">
<button type="submit">Enviar (bot sin sello)</button></form>`;
    const bot2 = `<form method="post" action="/submit">
<legend>Simulación: bot que rellena la trampa</legend>
<input type="hidden" name="website" value="http://trampa.xyz">
<button type="submit">Enviar (bot con trampa rellena)</button></form>`;
    await responder(salida, humano + bot1 + bot2);
    return;
  }

  // ─── Envío: el pipeline completo ──────────────────────────────────────────
  if (peticion.method === 'POST' && ruta === '/submit') {
    const campos = camposDe(await leerCuerpo(peticion));
    const ip = peticion.socket.remoteAddress ?? undefined;
    const veredicto = await guard.review(campos, { ip });
    const nota = veredicto.decision === 'quarantine'
      ? '<p>📌 Guardado en cuarentena: revísalo en <a href="/revision">Revisión</a> y enséñale al juez qué es.</p>'
      : '';
    const html = `<h2>Veredicto: <span class="${veredicto.decision}">${veredicto.decision}</span></h2>
<pre>${JSON.stringify(veredicto, null, 2)}</pre>
${nota}
<p><a href="/">← volver</a></p>`;
    await responder(salida, html);
    return;
  }

  // ─── Revisión de cuarentena: el botón "esto era mierda" ──────────────────
  if (peticion.method === 'GET' && ruta === '/revision') {
    const pendientes = guard.listQuarantine();
    if (pendientes.length === 0) {
      await responder(salida, '<p>Cuarentena vacía. Cuando el juez ponga algo en <span class="quarantine">quarantine</span>, aparecerá aquí para enseñarle qué es.</p>');
      return;
    }
    const entradas = pendientes.map((e) => `<div class="entrada">
<div class="campos">${new Date(e.receivedAt).toLocaleString('es')} · probabilidad ${e.probability.toFixed(2)} · fase ${e.phase}
${Object.entries(e.fields).map(([k, v]) => `\n<b>${k}</b>: ${v}`).join('')}</div>
<div class="fila">
<form method="post" action="/revision" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="spam"><button type="submit">🗑 Es basura (entrenar spam)</button></form>
<form method="post" action="/revision" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="ham"><button type="submit">✓ Es legítimo (entrenar ham)</button></form>
<form method="post" action="/revision" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="borrar"><button type="submit">Borrar sin enseñar</button></form>
</div></div>`).join('');
    await responder(salida, `<h2>Cuarentena (${pendientes.length})</h2>
<p>Marca cada envío: el juez entrena al momento y el modelo se guarda en ${MODEL_PATH}.</p>${entradas}`);
    return;
  }

  if (peticion.method === 'POST' && ruta === '/revision') {
    const campos = camposDe(await leerCuerpo(peticion));
    const { id, accion } = campos;
    if (typeof id === 'string' && (accion === 'spam' || accion === 'ham')) {
      guard.resolveQuarantine(id, accion);
    } else if (typeof id === 'string' && accion === 'borrar') {
      guard.discardQuarantine(id);
    }
    salida.writeHead(303, { location: '/revision' });
    salida.end();
    return;
  }

  await responder(salida, '<p>404</p>', 404);
});

servidor.listen(PORT, () => {
  console.log(`spamcha demo at http://localhost:${PORT}`);
  console.log('Try: send the human form → /revision → mark it → watch the model learn.');
});
