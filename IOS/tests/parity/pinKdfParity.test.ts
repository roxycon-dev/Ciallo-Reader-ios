// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { derivePin, hashPinLegacy } from '../../src/core/privacy/pinKdf';

interface PinKdfFixtureCase {
  pin: string;
  saltHex: string;
  legacySha256: string;
  pbkdf2: string;
}

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../parity/fixtures',
);

describe('pinKdf parity vs Android fixtures', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(fixturesDir, 'pinKdf.generated.json'), 'utf8'),
  ) as { cases: PinKdfFixtureCase[] };

  it('has at least 3 cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(3);
  });

  for (const c of fixture.cases) {
    it(`hashPinLegacy(pin=${c.pin}, salt=${c.saltHex})`, async () => {
      expect(await hashPinLegacy(c.pin, c.saltHex)).toBe(c.legacySha256);
    });

    it(`derivePin(pin=${c.pin}, salt=${c.saltHex})`, async () => {
      expect(await derivePin(c.pin, c.saltHex)).toBe(c.pbkdf2);
    });
  }
});
