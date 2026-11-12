#!/usr/bin/env node
/**
 * Renders a PNG next to every SVG in public/diagrams (#462).
 *
 * The docs show the PNG and link to the SVG: an SVG copied from the page does
 * not paste into PowerPoint/Word/Teams, a PNG does. PNGs are rendered at 2x the
 * SVG's viewBox size with a headless Edge or Chrome, and the SVG's hash is
 * recorded in scripts/diagram-pngs.json so check-diagram-pngs.mjs (prebuild)
 * can fail the build when a PNG is missing or older than its SVG.
 *
 * Run after adding or editing a diagram:
 *   node scripts/render-diagram-pngs.mjs            (only stale or missing PNGs)
 *   node scripts/render-diagram-pngs.mjs --all      (re-render everything)
 * Browser: $CHROME_PATH, else Edge/Chrome in the usual Windows locations, else
 * google-chrome / chromium / microsoft-edge on PATH.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { svgHash, MANIFEST, DIAGRAMS } from './diagram-pngs-lib.mjs';

const SCALE = 2;
const all = process.argv.includes('--all');

function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const win = [
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  for (const p of win) if (p && existsSync(p)) return p;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

const browser = findBrowser();
if (!browser) {
  console.error('No Edge or Chrome found. Set CHROME_PATH to a Chromium-based browser.');
  process.exit(1);
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const svgs = readdirSync(DIAGRAMS).filter((f) => f.endsWith('.svg')).sort();
let rendered = 0;

for (const svg of svgs) {
  const svgPath = join(DIAGRAMS, svg);
  const pngPath = svgPath.replace(/\.svg$/, '.png');
  const hash = svgHash(svgPath);
  if (!all && existsSync(pngPath) && manifest[svg] === hash) {
    console.log(`up to date  ${svg}`);
    continue;
  }
  const vb = readFileSync(svgPath, 'utf8').match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/);
  if (!vb) {
    console.error(`no viewBox in ${svg}; cannot size the PNG`);
    process.exit(1);
  }
  const [w, h] = [Math.round(Number(vb[1])), Math.round(Number(vb[2]))];
  const profile = mkdtempSync(join(tmpdir(), 'diagram-png-'));
  const r = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`, `--force-device-scale-factor=${SCALE}`,
    `--screenshot=${pngPath}`, pathToFileURL(svgPath).href,
  ], { encoding: 'utf8', timeout: 60000 });
  rmSync(profile, { recursive: true, force: true });
  if (!existsSync(pngPath) || r.error) {
    console.error(`render failed for ${svg}: ${r.error ?? r.stderr}`);
    process.exit(1);
  }
  manifest[svg] = hash;
  rendered++;
  console.log(`rendered    ${svg} -> ${svg.replace(/\.svg$/, '.png')} (${w * SCALE}x${h * SCALE})`);
}

for (const k of Object.keys(manifest)) if (!svgs.includes(k)) delete manifest[k];
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${rendered} PNG(s) rendered, manifest: scripts/diagram-pngs.json`);
