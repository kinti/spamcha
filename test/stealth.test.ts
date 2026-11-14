import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGatekeeper } from '../src/guard.js';
import { generateStealthNames, isStealthName } from '../src/stealth.js';

describe('stealth names', () => {
  it('valid HTML names, plausible honeypot, opaque stamp', () => {
    const n = generateStealthNames();
    expect(isStealthName(n.stampField)).toBe(true);
    expect(isStealthName(n.honeypotField)).toBe(true);
    expect(n.stampField).not.toBe('spamcha');
    expect(n.honeypotField).toMatch(/^(empresa|empresa_web|sitio_web|web_del_negocio|fax|company|company_website|your_website|website_url|homepage|nickname2|second_email|referencia|codigo_cliente|extension|poblacion|departamento|iban|cuota|Observaciones2)\d+$/);
  });

  it('different sites get different names (no shared recipe)', () => {
    const nombres = new Set(Array.from({ length: 50 }, () => generateStealthNames().stampField));
    expect(nombres.size).toBeGreaterThan(45);
  });

  it('isStealthName rejects junk', () => {
    expect(isStealthName('spamcha')).toBe(true); // válido como nombre, solo no default
    expect(isStealthName('9ladera')).toBe(false); // empieza por número
    expect(isStealthName('x')).toBe(false); // demasiado corto
  });

  it("the public form HTML carries zero spamcha strings when stealth names are set", async () => {
    const { stampField, honeypotField } = generateStealthNames();
    const guard = createGatekeeper({
      secret: 'test-secret-long',
      stampField,
      honeypotField,
    });
    const html = await guard.stampHtml();
    expect(html).toContain(`name="${stampField}"`);
    expect(html).toContain(`name="${honeypotField}"`);
    expect(html).not.toContain('spamcha');
    expect(html).not.toContain('website"');
  });
});
