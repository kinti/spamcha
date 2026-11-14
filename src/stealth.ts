// Stealth names: the ONLY two strings a bot can see in your form HTML are the
// stamp field and the honeypot field. Per-site random names break the recipe
// economy (bot farms ship evasions for the POPULAR config, not for your site)
// and a plausible honeypot name invites dumb bots to fill it.
// This is not the security itself: Kerckhoffs still holds, the stamp is HMAC
//: it's raising the cost of targeting your site specifically.

import { randomBase64Url } from './crypto.js';

export interface StealthNames {
  /** The stamp carrier field (opaque: it only echoes a token). */
  stampField: string;
  /** The honeypot: a PLAUSIBLE field name so dumb bots fill it eagerly. */
  honeypotField: string;
}

/** Believable form-field names a bot would happily fill. */
const HONEYPOT_POOL = [
  'empresa', 'empresa_web', 'sitio_web', 'web_del_negocio', 'fax',
  'company', 'company_website', 'your_website', 'website_url', 'homepage',
  'nickname2', 'second_email', 'referencia', 'codigo_cliente', 'extension',
  'poblacion', 'departamento', 'iban', 'cuota', 'Observaciones2',
];

function azar(max: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

/** Random valid HTML name: letter start, base36 tail: nothing meaningful. */
function campoSelloAzar(): string {
  const letras = 'abcdefghijklmnopqrstuvwxyz';
  let resto = '';
  while (resto.length < 9) {
    resto += randomBase64Url(8).replace(/[^a-z0-9]/gi, '').toLowerCase();
  }
  return letras[azar(letras.length)] + resto.slice(0, 9);
}

function honeypotPlausible(): string {
  const base = HONEYPOT_POOL[azar(HONEYPOT_POOL.length)];
  return `${base}${azar(90) + 10}`; // suffix digits: same name, different site
}

export function generateStealthNames(): StealthNames {
  return { stampField: campoSelloAzar(), honeypotField: honeypotPlausible() };
}

/** Valid HTML name + never collides with our known defaults? */
export function isStealthName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(name);
}
