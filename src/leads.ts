// Leads: a confirmed submission isn't just "not spam" — it's a VERIFIED lead.
// The sender filled the form, passed the behavior gates, was flagged by the
// judge, received the confirmation link and CLICKED it: mailbox verified,
// intent demonstrated. This module turns confirmed entries into structured
// leads (name, email, message) for export and display.

import type { QuarantineEntry } from './quarantine.js';

export interface Lead {
  nombre: string;
  email: string;
  mensaje: string;
  recibido: string;
  confirmado: string;
  /** Seconds between submission and confirmation — fast = engaged. */
  segundosParaConfirmar: number | null;
  /** Original judge probability (lower + confirmed = was a gray-zone save). */
  probabilidad: number;
}

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const RE_NOMBRE = /^(nombre|name|autor|author|nombre_completo|name_full)$/i;
const RE_MENSAJE = /^(mensaje|message|comment|comentario|consulta|texto)$/i;

/** Pulls the structured lead out of a confirmed quarantine entry. */
export function leadDeEntrada(entry: QuarantineEntry): Lead {
  let nombre = '';
  let email = '';
  let mensaje = '';

  for (const [clave, valor] of Object.entries(entry.fields)) {
    const v = valor.trim();
    if (!email && RE_EMAIL.test(v)) {
      email = v.match(RE_EMAIL)![0];
    }
    if (!nombre && RE_NOMBRE.test(clave) && v) {
      nombre = v;
    }
    if (!mensaje && RE_MENSAJE.test(clave) && v.length > mensaje.length) {
      mensaje = v;
    }
  }
  // fallbacks: the longest free-text field is probably the message;
  // a field whose VALUE is an email (and isn't the message) can be the contact.
  if (!mensaje) {
    const largo = Object.entries(entry.fields)
      .filter(([k]) => !RE_NOMBRE.test(k))
      .sort((a, b) => b[1].length - a[1].length)[0];
    mensaje = largo ? largo[1] : '';
  }
  if (!email) {
    const conEmail = Object.entries(entry.fields)
      .filter(([k]) => !RE_NOMBRE.test(k))
      .find(([, v]) => RE_EMAIL.test(v));
    email = conEmail ? conEmail[1].match(RE_EMAIL)![0] : '';
  }

  const recibido = Date.parse(entry.receivedAt);
  const confirmado = entry.confirmedAt ? Date.parse(entry.confirmedAt) : Number.NaN;
  const segundos = Number.isFinite(recibido) && Number.isFinite(confirmado)
    ? Math.round((confirmado - recibido) / 1000)
    : null;

  return {
    nombre,
    email,
    mensaje,
    recibido: entry.receivedAt,
    confirmado: entry.confirmedAt ?? '',
    segundosParaConfirmar: segundos,
    probabilidad: entry.probability,
  };
}

export function leadsDeConfirmadas(entries: QuarantineEntry[]): Lead[] {
  return entries.map(leadDeEntrada);
}

/** RFC 4180-ish CSV row escaping. */
function csvCelda(valor: string): string {
  return `"${valor.replace(/"/g, '""')}"`;
}

export function leadsACsv(leads: Lead[]): string {
  const cabecera = 'nombre,email,mensaje,recibido,confirmado,segundos_para_confirmar,probabilidad';
  const filas = leads.map((l) =>
    [l.nombre, l.email, l.mensaje, l.recibido, l.confirmado, String(l.segundosParaConfirmar ?? ''), String(l.probabilidad)]
      .map(csvCelda)
      .join(','),
  );
  return [cabecera, ...filas].join('\n');
}
