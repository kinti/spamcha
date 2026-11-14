// `spamcha serve`: the verdict pipeline as a local HTTP service — the door for
// PHP/Python/WordPress backends (mode-2 universality) and for static sites.
// Endpoints (JSON, no auth by design — bind to localhost and expose via your
// own auth if you must):
//   GET  /health            liveness + model state
//   GET  /stamp             issue a stamp (?format=html → the two hidden inputs)
//   POST /verdict           body: urlencoded fields, or JSON {fields, ip?, now?}
//                           → the full gatekeeper verdict as JSON (always 200 —
//                             the `decision` field drives your code)
//   GET  /panel             what arrived (panelHtml)
//   GET|POST /revision      quarantine review actions (panel's button target)
//   GET  /feeds             cached feed channels (names, versions, expiry)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Gatekeeper } from './guard.js';
import { panelHtml } from './panel.js';
import { stampFieldsHtml } from './stamp.js';

export interface ServeOptions {
  /** Serve the panel's review buttons to a different path (default `/revision`). */
  actionPath?: string;
  /** Access-Control-Allow-Origin: * on API routes — for static-site clients. */
  cors?: boolean;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PAGE = (body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>spamcha — service</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.5}
  pre{background:#f4f4f4;padding:.75rem;border-radius:6px;overflow-x:auto;font-size:.85rem}
  form{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
  .entry{border:1px solid #ddd;border-radius:6px;padding:.75rem;margin:.75rem 0}
  .entry .fields{color:#555;font-size:.9rem;white-space:pre-wrap}
  .row button{margin-right:.5rem}
</style></head><body>${body}</body></html>`;

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

function sendJson(response: ServerResponse, status: number, body: unknown, cors?: boolean): void {
  if (cors) response.setHeader('access-control-allow-origin', '*');
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

export function createServeServer(guard: Gatekeeper, options: ServeOptions = {}): import('node:http').Server {
  const actionPath = options.actionPath ?? '/revision';

  return createServer(async (request, response) => {
    const path = request.url?.split('?')[0] ?? '/';
    const query = new URLSearchParams(request.url?.split('?')[1] ?? '');

    if (request.method === 'OPTIONS') {
      if (options.cors) {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
      } else {
        response.writeHead(204);
      }
      response.end();
      return;
    }

    if (request.method === 'GET' && path === '/health') {
      sendJson(response, 200, {
        ok: true,
        model: { docs: guard.model.docs, vocabulary: guard.model.vocabulary },
        quarantinePending: guard.listQuarantine().length,
        logEntries: guard.log?.list().length ?? 0,
      }, options.cors);
      return;
    }

    if (request.method === 'GET' && path === '/stamp') {
      const token = await guard.stampToken();
      sendJson(response, 200,
        query.get('format') === 'html'
          ? { html: stampFieldsHtml(token) }
          : { token },
        options.cors);
      return;
    }

    if (request.method === 'POST' && path === '/verdict') {
      const raw = await readBody(request);
      const contentType = request.headers['content-type'] ?? '';
      let fields: Record<string, string> = {};
      let ip: string | undefined = request.headers['x-forwarded-for'] as string | undefined;
      let now: number | undefined;
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(raw) as { fields?: Record<string, string>; ip?: string; now?: number };
          fields = parsed.fields ?? {};
          ip = parsed.ip ?? ip;
          now = parsed.now;
        } catch {
          sendJson(response, 400, { error: 'body is not valid JSON' }, options.cors);
          return;
        }
      } else {
        fields = fieldsFrom(raw);
      }
      const verdict = await guard.review(fields, { ip, now });
      sendJson(response, 200, verdict, options.cors);
      return;
    }

    if (request.method === 'GET' && path === '/panel') {
      sendHtml(response, 200, PAGE(panelHtml(guard, { actionPath })));
      return;
    }

    if (request.method === 'GET' && path === '/revision') {
      const pending = guard.listQuarantine();
      const entries = pending.length === 0
        ? '<p>Quarantine is empty.</p>'
        : pending.map((e) => `<div class="entry">
<div class="fields">${new Date(e.receivedAt).toLocaleString('en')} · ${e.probability.toFixed(2)}
${Object.entries(e.fields).map(([k, v]) => `\n<b>${esc(k)}</b>: ${esc(v)}`).join('')}</div>
<div class="row">
<form method="post" action="${actionPath}" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="spam"><button type="submit">🗑 garbage (train spam)</button></form>
<form method="post" action="${actionPath}" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="ham"><button type="submit">✓ legit (train ham)</button></form>
<form method="post" action="${actionPath}" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="borrar"><button type="submit">delete</button></form>
</div></div>`).join('');
      sendHtml(response, 200, PAGE(`<h2>Quarantine (${pending.length})</h2>${entries}`));
      return;
    }

    if (request.method === 'POST' && path === actionPath) {
      const fields = fieldsFrom(await readBody(request));
      const { id, accion } = fields;
      if (typeof id === 'string' && (accion === 'spam' || accion === 'ham')) {
        guard.resolveQuarantine(id, accion);
      } else if (typeof id === 'string') {
        guard.discardQuarantine(id);
      }
      response.writeHead(303, { location: request.headers.referer ?? '/panel' });
      response.end();
      return;
    }

    if (request.method === 'GET' && path === '/feeds') {
      sendJson(response, 200, {
        feeds: guard.feeds?.map((f) => ({ channel: f.channel, version: f.version, expiresAt: f.expiresAt })) ?? [],
      }, options.cors);
      return;
    }

    sendJson(response, 404, { error: 'not found' }, options.cors);
  });
}
