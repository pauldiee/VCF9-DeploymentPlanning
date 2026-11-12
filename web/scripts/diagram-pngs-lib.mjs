// Shared by render-diagram-pngs.mjs and check-diagram-pngs.mjs (#462).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const DIAGRAMS = resolve(here, '../public/diagrams');
export const MANIFEST = resolve(here, 'diagram-pngs.json');

// Line endings normalised: a Windows checkout (CRLF) and CI (LF) must agree.
export function svgHash(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}
