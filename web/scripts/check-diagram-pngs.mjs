#!/usr/bin/env node
/**
 * Diagram PNG guard (#462).
 *
 * Every SVG in public/diagrams needs a PNG rendered from its current content
 * (the docs show the PNG so it can be copied into PowerPoint). The render
 * script records each SVG's hash in scripts/diagram-pngs.json; this check
 * compares those hashes with the SVGs as they are now. No browser needed.
 *
 * Run: node scripts/check-diagram-pngs.mjs   (exit 1 on a missing or stale PNG)
 * Fix: node scripts/render-diagram-pngs.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { svgHash, MANIFEST, DIAGRAMS } from './diagram-pngs-lib.mjs';

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const problems = [];

for (const svg of readdirSync(DIAGRAMS).filter((f) => f.endsWith('.svg')).sort()) {
  const png = svg.replace(/\.svg$/, '.png');
  if (!existsSync(join(DIAGRAMS, png))) problems.push(`${png} is missing`);
  else if (manifest[svg] !== svgHash(join(DIAGRAMS, svg))) problems.push(`${png} is older than ${svg}`);
}

if (problems.length) {
  console.error('Diagram PNGs out of date:\n  ' + problems.join('\n  '));
  console.error('Run: node scripts/render-diagram-pngs.mjs (needs Edge or Chrome), then commit the PNGs and scripts/diagram-pngs.json.');
  process.exit(1);
}
console.log('check-diagram-pngs: all diagram PNGs match their SVGs.');
