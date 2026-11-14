#!/usr/bin/env node
// spamcha demo v0.6: contact server + quarantine review page, in one file.
//   npm run demo   →  http://localhost:8787
//   · /            three forms (human, bot without stamp, bot filling honeypot)
//   · /submit      the full pipeline; quarantined submissions get stored
//   · /panel       what arrived: stats, rules, domains, review buttons
//   · /revision    standalone review page (the panel's action target)
// Page text in English (born-in-English product); verdicts are JSON, codes
// immutable. Judge texts follow the locale layer (--locale / SPAMCHA_LOCALE).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createGatekeeper } from './guard.js';
import { panelHtml } from './panel.js';

const PORT = Number(process.env.SPAMCHA_PORT ?? 8787);
const SECRET = process.env.SPAMCHA_SECRET ?? 'demo: change this for a long random phrase of your own';
const MODEL_PATH = process.env.SPAMCHA_MODEL ?? 'spamcha.json';
const QUARANTINE_PATH = process.env.SPAMCHA_QUARANTINE ?? 'spamcha-quarantine.jsonl';
const LOG_PATH = process.env.SPAMCHA_LOG ?? 'spamcha-log.jsonl';

const guard = createGatekeeper({
  secret: SECRET,
  modelPath: MODEL_PATH,
  quarantinePath: QUARANTINE_PATH,
  logPath: LOG_PATH,
  rateLimit: { max: 20, windowMs: 60_000 },
});
console.log(`Model: ${MODEL_PATH} (docs spam=${guard.model.docs.spam} ham=${guard.model.docs.ham})`);
console.log(`Quarantine: ${QUARANTINE_PATH} (${guard.listQuarantine().length} pending)`);
console.log(`Log: ${LOG_PATH} (${guard.log?.list().length ?? 0} submissions)`);

const PAGE = (body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>spamcha — demo</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.5}
  form{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
  input,textarea{width:100%;box-sizing:border-box;margin:.25rem 0 1rem;padding:.5rem}
  button{padding:.4rem .9rem;cursor:pointer}
  label{font-weight:600}
  pre{background:#f4f4f4;padding:.75rem;border-radius:6px;overflow-x:auto;font-size:.85rem}
  .pass{color:#067d17}.quarantine{color:#b58600}.reject{color:#da1e28}
  .entry{border:1px solid #ddd;border-radius:6px;padding:.75rem;margin:.75rem 0}
  .entry .fields{color:#555;font-size:.9rem;white-space:pre-wrap}
  .row button{margin-right:.5rem}
  nav a{margin-right:1rem}
</style></head><body>
<h1>spamcha — local spam judge</h1>
<nav><a href="/">Form</a> · <a href="/panel">Panel</a> · <a href="/revision">Review (${guard.listQuarantine().length})</a></nav>
${body}
</body></html>`;

async function readBody(request: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of request) data += chunk;
  return data;
}

function fieldsFrom(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) fields[k] = v;
  return fields;
}

async function respond(response: ServerResponse, html: string, status = 200): Promise<void> {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(PAGE(html));
}

const server = createServer(async (request, response) => {
  const path = request.url?.split('?')[0] ?? '/';

  // ─── Form + simulated bots ──────────────────────────────────────────────
  if (request.method === 'GET' && (path === '/' || path === '/contact')) {
    const stamp = await guard.stampHtml();
    const human = `<form method="post" action="/submit">
${stamp}
<label for="name">Your name</label><input id="name" name="nombre">
<label for="mensaje">Message</label><textarea id="mensaje" name="mensaje" rows="5"></textarea>
<button type="submit">Send (human)</button></form>`;
    const bot1 = `<form method="post" action="/submit">
<legend>Simulation: a bot POSTing straight at the handler (no stamp)</legend>
<input type="hidden" name="nombre" value="Anna from SEO-Growth">
<input type="hidden" name="mensaje" value="boost your google ranking with premium backlinks http://a.xyz http://b.xyz http://c.xyz http://d.xyz http://e.xyz">
<button type="submit">Send (bot without stamp)</button></form>`;
    const bot2 = `<form method="post" action="/submit">
<legend>Simulation: a bot that fills the honeypot</legend>
<input type="hidden" name="website" value="http://trap.example">
<button type="submit">Send (bot with honeypot filled)</button></form>`;
    await respond(response, human + bot1 + bot2);
    return;
  }

  // ─── Submission: the full pipeline ──────────────────────────────────────
  if (request.method === 'POST' && path === '/submit') {
    const fields = fieldsFrom(await readBody(request));
    const ip = request.socket.remoteAddress ?? undefined;
    const verdict = await guard.review(fields, { ip });
    const note = verdict.decision === 'quarantine'
      ? '<p>📌 Held in quarantine: review it at <a href="/panel">Panel</a> and teach the judge what it is.</p>'
      : '';
    const html = `<h2>Verdict: <span class="${verdict.decision}">${verdict.decision}</span></h2>
<pre>${JSON.stringify(verdict, null, 2)}</pre>
${note}
<p><a href="/">← back</a></p>`;
    await respond(response, html);
    return;
  }

  // ─── Panel: what arrived, stats and review ──────────────────────────────
  if (request.method === 'GET' && path === '/panel') {
    await respond(response, panelHtml(guard));
    return;
  }

  // ─── Quarantine review: the "this was garbage" button ───────────────────
  if (request.method === 'GET' && path === '/revision') {
    const pending = guard.listQuarantine();
    if (pending.length === 0) {
      await respond(response, '<p>Quarantine is empty. When the judge holds something, it shows up here to be taught.</p>');
      return;
    }
    const entries = pending.map((e) => `<div class="entry">
<div class="fields">${new Date(e.receivedAt).toLocaleString('en')} · probability ${e.probability.toFixed(2)} · phase ${e.phase}
${Object.entries(e.fields).map(([k, v]) => `\n<b>${k}</b>: ${v}`).join('')}</div>
<div class="row">
<form method="post" action="/revision" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="spam"><button type="submit">🗑 It is garbage (train spam)</button></form>
<form method="post" action="/revision" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="ham"><button type="submit">✓ It is legit (train ham)</button></form>
<form method="post" action="/revision" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="borrar"><button type="submit">Delete without teaching</button></form>
</div></div>`).join('');
    await respond(response, `<h2>Quarantine (${pending.length})</h2>
<p>Mark each submission: the judge trains on the spot and the model is saved to ${MODEL_PATH}.</p>${entries}`);
    return;
  }

  if (request.method === 'POST' && path === '/revision') {
    const fields = fieldsFrom(await readBody(request));
    const { id, accion } = fields;
    if (typeof id === 'string' && (accion === 'spam' || accion === 'ham')) {
      guard.resolveQuarantine(id, accion);
    } else if (typeof id === 'string' && accion === 'borrar') {
      guard.discardQuarantine(id);
    }
    response.writeHead(303, { location: '/revision' });
    response.end();
    return;
  }

  await respond(response, '<p>404</p>', 404);
});

server.listen(PORT, () => {
  console.log(`spamcha demo at http://localhost:${PORT}`);
  console.log('Try: send the human form → /panel → mark it → watch the model learn.');
});
