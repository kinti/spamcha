// The tokenizer: the only dish the judge tastes before the bayes.
// URLs and emails become special tokens (url:domain, email:domain) so the
// model learns which link domains carry the garbage.

const RE_URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const RE_EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;
const RE_WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Base domain of a URL, so whole paths don't get memorized. `a.b.co.uk` → `co.uk` (approx.). */
function domainOf(url: string): string {
  const clean = url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0] ?? '';
  const parts = clean.split('.').filter(Boolean);
  if (parts.length < 2) return clean || 'url';
  return parts.slice(-2).join('.');
}

export function tokenize(text: string): string[] {
  const plain = normalize(text);
  const tokens: string[] = [];

  for (const u of plain.match(RE_URL) ?? []) tokens.push(`url:${domainOf(u)}`);
  for (const c of plain.match(RE_EMAIL) ?? []) {
    tokens.push(`email:${(c.split('@')[1] ?? 'mail').toLowerCase()}`);
  }

  const withoutLinks = plain.replace(RE_URL, ' ').replace(RE_EMAIL, ' ');
  for (const m of withoutLinks.matchAll(RE_WORD)) tokens.push(m[0]);

  return tokens;
}
