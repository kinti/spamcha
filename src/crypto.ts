// Isomorphic crypto helpers over WebCrypto: zero dependencies.
// Same code runs in Node, Bun, Deno, Workers and the browser.

const ENCODER = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts base64 and base64url alike (ALTCHA sends classic base64). */
export function fromBase64(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison: not one byte of hint to the attacker. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, ENCODER.encode(message));
  return toHex(new Uint8Array(signature));
}

export async function digestHex(
  algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512',
  message: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, ENCODER.encode(message));
  return toHex(new Uint8Array(digest));
}

export function randomBase64Url(bytes = 16): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
