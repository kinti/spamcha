#!/usr/bin/env node
// spamcha demo: a complete contact server in one file, zero dependencies.
//   npm run demo   →  http://localhost:8787
// Three forms to test the three gates:
//   · a real human (fills at their own pace)  → pass, or quarantine by content
//   · a bot POSTing straight at the handler   → stamp:missing
//   · a bot that fills the honeypot           → honeypot:filled
// Page text in Spanish (native locale); verdicts are JSON, codes immutable.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { issueStamp, verifySubmission } from './index.js';
import { loadModel } from './storage.js';
import { createModel } from './bayes.js';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.SPAMCHA_PORT ?? 8787);
const SECRET = process.env.SPAMCHA_SECRET ?? 'demo: change this for a long random phrase of your own';
const MODEL_PATH = process.env.SPAMCHA_MODEL ?? 'spamcha.json';

const model = existsSync(MODEL_PATH) ? loadModel(MODEL_PATH) : createModel();
console.log(`Model: ${MODEL_PATH} (docs spam=${model.docs.spam} ham=${model.docs.ham})`);

const PAGE = (body: string): string => `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>spamcha — demo</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;line-height:1.5}
  form{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
  input,textarea{width:100%;box-sizing:border-box;margin:.25rem 0 1rem;padding:.5rem}
  button{padding:.5rem 1rem}
  .etiqueta{font-weight:600}
  pre{background:#f4f4f4;padding:.75rem;border-radius:6px;overflow-x:auto}
  .pass{color:#067d17}.quarantine{color:#b58600}.reject{color:#da1e28}
</style></head><body>
<h1>spamcha — juez de spam local</h1>
<p>Formulario de contacto con sello invisible, trampa de tiempo y honeypot. Sin captcha, sin JavaScript en el navegador, sin mandar tu contenido a la nube de nadie.</p>
${body}
</body></html>`;

async function readBody(request: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of request) data += chunk;
  return data;
}

async function respond(response: ServerResponse, html: string, status = 200): Promise<void> {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(PAGE(html));
}

const server = createServer(async (request, response) => {
  const path = request.url?.split('?')[0] ?? '/';

  if (request.method === 'GET' && (path === '/' || path === '/contact')) {
    const token = await issueStamp(SECRET);
    const human = `<form method="post" action="/submit">
<input type="hidden" name="spamcha" value="${token}">
<input type="text" name="website" value="" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">
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
    await respond(response, human + bot1 + bot2);
    return;
  }

  if (request.method === 'POST' && path === '/submit') {
    const raw = await readBody(request);
    const fields: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) fields[k] = v;

    const verdict = await verifySubmission(fields, model, { secret: SECRET });
    const html = `<h2>Veredicto: <span class="${verdict.decision}">${verdict.decision}</span></h2>
<pre>${JSON.stringify(verdict, null, 2)}</pre>
<p><a href="/">← volver al formulario</a></p>`;
    await respond(response, html);
    return;
  }

  await respond(response, '<p>404</p>', 404);
});

server.listen(PORT, () => {
  console.log(`spamcha demo at http://localhost:${PORT}`);
  console.log('Tip: train first with `spamcha train` so the judge has a voice.');
});
