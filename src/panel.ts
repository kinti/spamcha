// The panel: what arrived, at a glance. Server-rendered HTML (no JavaScript,
// no dependencies) reading the verdict log + the quarantine + the model state.
// It shows stats, the most active rules, the spam domains seen, the latest
// submissions and: for held ones: the review buttons that train the judge.
//
// SECURITY: this HTML has no authentication. Serve it on localhost or behind
// your own auth (Cloudflare Access does nicely); it reads your private data.

import type { Gatekeeper } from './guard.js';
import { DEFAULT_LOCALE, translate } from './locales.js';
import type { Locale } from './locales.js';
import { domainOf } from './tokenizer.js';
import { leadsDeConfirmadas } from './leads.js';
import type { LogEntry } from './log.js';

const RE_URL = /https?:\/\/[^\s"'<>]+/gi;

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function topDe(mapa: Map<string, number>, n: number): [string, number][] {
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export interface PanelOptions {
  locale?: Locale;
  /** Where the review buttons POST (default `/revision`). */
  actionPath?: string;
  /** How many recent submissions to list (default 50). */
  limit?: number;
}

export function panelHtml(guard: Gatekeeper, options: PanelOptions = {}): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const t = (code: string, vars?: Record<string, string | number>): string => translate(code, { locale, vars });
  const accion = options.actionPath ?? '/revision';
  const entries: LogEntry[] = guard.log?.list() ?? [];

  // ─── Computations ────────────────────────────────────────────────────────
  const conteo = { pass: 0, quarantine: 0, reject: 0 };
  const reglas = new Map<string, number>();
  const dominios = new Map<string, number>();
  const hace24h = Date.now() - 86_400_000;
  let ultimas24 = 0;
  for (const e of entries) {
    conteo[e.decision] += 1;
    if (Number.isNaN(Date.parse(e.receivedAt)) || Date.parse(e.receivedAt) >= hace24h) ultimas24 += 1;
    for (const c of e.codes) {
      if (c.startsWith('rule:')) reglas.set(c, (reglas.get(c) ?? 0) + 1);
    }
    for (const valor of Object.values(e.fields)) {
      for (const m of valor.match(RE_URL) ?? []) {
        const d = domainOf(m);
        if (d) dominios.set(d, (dominios.get(d) ?? 0) + 1);
      }
    }
  }
  const pendientes = guard.listQuarantine();

  // ─── Secciones ───────────────────────────────────────────────────────────
  const estadisticas = `<p>${t('panel.stats', {
    total: entries.length,
    pass: conteo.pass,
    quarantine: conteo.quarantine,
    reject: conteo.reject,
    horas24: ultimas24,
  })}</p>
<p>${t('panel.model', {
    spam: guard.model.docs.spam,
    ham: guard.model.docs.ham,
    vocabulary: guard.model.vocabulary,
    phase: guard.model.docs.spam >= 5 && guard.model.docs.ham >= 5 ? 'trained' : 'cold',
  })} · ${t('panel.pending', { n: pendientes.length })}</p>`;

  const listaTop = (pares: [string, number][], vacio: string): string =>
    pares.length === 0
      ? `<p class="apagado">${vacio}</p>`
      : '<ul>' + pares.map(([k, n]) => `<li><code>${esc(k)}</code> ×${n}</li>`).join('') + '</ul>';

  const revision = pendientes.length === 0
    ? `<p class="apagado">${t('panel.quarantine-empty')}</p>`
    : pendientes.map((e) => `<div class="entrada">
<div class="campos">${new Date(e.receivedAt).toLocaleString(locale)} · ${e.probability.toFixed(2)}
${Object.entries(e.fields).map(([k, v]) => `\n<b>${esc(k)}</b>: ${esc(v)}`).join('')}</div>
<div class="fila">
<form method="post" action="${accion}" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="spam"><button type="submit">${t('panel.btn-spam')}</button></form>
<form method="post" action="${accion}" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="ham"><button type="submit">${t('panel.btn-ham')}</button></form>
<form method="post" action="${accion}" style="display:inline"><input type="hidden" name="id" value="${e.id}"><input type="hidden" name="accion" value="borrar"><button type="submit">${t('panel.btn-delete')}</button></form>
</div></div>`).join('');

  const recientes = entries.length === 0
    ? `<p class="apagado">${t('panel.empty')}</p>`
    : `<table><tr><th>${t('panel.th-time')}</th><th>${t('panel.th-decision')}</th><th>${t('panel.th-prob')}</th><th>${t('panel.th-content')}</th><th>${t('panel.th-codes')}</th></tr>` +
      guard.log!.recent(options.limit ?? 50).map((e) => `<tr class="${e.decision}">
<td>${new Date(e.receivedAt).toLocaleString(locale)}</td>
<td>${e.decision}</td>
<td>${e.probability.toFixed(2)}</td>
<td class="campos">${Object.entries(e.fields).slice(0, 3).map(([k, v]) => `<b>${esc(k)}</b>: ${esc(v.slice(0, 60))}`).join(' · ')}</td>
<td>${e.codes.map((c) => `<code>${esc(c)}</code>`).join(' ')}</td>
</tr>`).join('') + '</table>';

  const leads = leadsDeConfirmadas(guard.listConfirmed());
  const leadsHtml = leads.length === 0
    ? `<p class="apagado">${t('panel.leads-empty')}</p>`
    : `<table><tr><th>${t('panel.th-name')}</th><th>${t('panel.th-email')}</th><th>${t('panel.th-confirmed')}</th><th>${t('panel.th-content')}</th></tr>` +
      leads.map((l) => `<tr>
<td>${l.nombre ? esc(l.nombre) : ''}</td>
<td>${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ''}</td>
<td>${new Date(l.confirmado).toLocaleString(locale)}</td>
<td class="campos">${esc(l.mensaje.slice(0, 80))}</td>
</tr>`).join('') + '</table>';

  return `<h2>${t('panel.title')}</h2>
${estadisticas}
<h3>${t('panel.leads-title')} (${leads.length})</h3>
${leadsHtml}
<h3>${t('panel.top-rules')}</h3>
${listaTop(topDe(reglas, 5), t('panel.none'))}
<h3>${t('panel.top-domains')}</h3>
${listaTop(topDe(dominios, 5), t('panel.none'))}
<h3>${t('panel.quarantine-title')}</h3>
${revision}
<h3>${t('panel.recent')}</h3>
${recientes}`;
}
