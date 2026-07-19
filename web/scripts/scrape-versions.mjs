// scrape-versions.mjs
// Scrapes the current latest version + build per VCF 9.1 component from Broadcom's
// server-rendered KB / TechDocs pages and writes web/src/data/vcf-versions.json.
//
// In VCF 9.1 components patch per-component and asynchronously (Express Patches), so a
// point-in-time table drifts within weeks. This keeps it honest on a schedule.
//
// Fail-safe: on any fetch/parse miss, the last-known value is kept (never blanked) and the
// failing source is recorded in `_sourceErrors`. Both source shapes are plain server-rendered
// HTML, so a bare fetch returns the data (no JS/Cloudflare gate) and this runs fine in CI.
//
// Author: Paul van Dieen  -  https://www.hollebollevsan.nl
// Issues: #179 (page), #180 (VCF Operations nodes), #181 (optional add-ons), #184 (GA release dates)
// Run:    node web/scripts/scrape-versions.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/vcf-versions.json');

const TD = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes';
const PATCH = `${TD}/patch-releases-9-1-0-x`;
const GA_RN = `${TD}.html`;
// GA Bill of Materials - source for components with no Express Patch yet (they run at GA build).
const BOM = `${TD}/vmware-cloud-foundation-9-1-0-0-release-notes/vmware-cloud-foundation-bill-of-materials.html`;
// VCF 9.1.0.0 general-availability date (release-notes header: "VMware Cloud Foundation 9.1 | 12 MAY 2026").
const GA_DATE = '2026-05-12';

// BOM manifest. `techdocs` walks the patch tree; `kb` reads a single version+build KB table;
// `static` is an un-patched component rendered at its GA build ("Current").
// leaf regexes are tight so a sibling sub-component leaf can't be mistaken for the product
// (e.g. `vcfoperations-` must not match `vcf-operations-orchestrator-`).
const COMPONENTS = [
  { key: 'vcenter', name: 'vCenter Server', category: 'Core', strategy: 'kb',
    url: 'https://knowledge.broadcom.com/external/article/326316' },
  { key: 'esxi', name: 'ESXi', category: 'Core', strategy: 'techdocs',
    index: `${PATCH}/vsphere/esx.html`, leaf: /esx-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'nsx', name: 'NSX', category: 'Core', strategy: 'techdocs',
    index: `${PATCH}/nsx.html`, leaf: /\/nsx-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'sddc-manager', name: 'SDDC Manager', category: 'Core', strategy: 'techdocs',
    index: `${PATCH}/vcf-installer.html`, leaf: /sddc-manager-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'vcf-operations', name: 'VCF Operations', category: 'Operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/vcfoperations-9-1-0-(\d{4})-release-notes\.html$/i },
  // VCF Operations nodes (#180): own leaves in the same vcf-operations/<ver>/ tree, shown nested
  // under VCF Operations (not as independent products). Leaf regexes stay tight so a node slug
  // can't collide with the product leaf (`vcfoperations-`, no hyphens) or a sibling node.
  { key: 'vcf-ops-orchestrator', name: 'Orchestrator', category: 'Operations', parent: 'vcf-operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/vcf-operations-orchestrator-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'vcf-ops-log-management', name: 'Log Management', category: 'Operations', parent: 'vcf-operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/log-management-9-1-0-(\d{4})-release-notes\.html$/i },
  // Broadcom's leaf slug misspells "metrics" as "mertics"; tolerate both spellings so a later fix upstream won't break us.
  { key: 'vcf-ops-real-time-metrics', name: 'Real-Time Metrics', category: 'Operations', parent: 'vcf-operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/real-time-me(?:rt|tr)ics-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'vcf-automation', name: 'VCF Automation', category: 'Automation', strategy: 'techdocs',
    index: `${PATCH}/vcf-automation.html`, leaf: /vcfautomation-9-1-0-(\d{4})-release-notes\.html$/i },
  // VCF Operations bundle sub-components (own leaf under vcf-operations/<ver>/)
  { key: 'fleet-lifecycle', name: 'Fleet Lifecycle Management', category: 'Operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/fleet-lifecycle-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'sddc-lifecycle', name: 'SDDC Lifecycle Management', category: 'Operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/sddc-lifecycle-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'salt-master', name: 'Salt Master', category: 'Operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/salt-master-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'salt-raas', name: 'Salt RaaS', category: 'Operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/salt-raas-9-1-0-(\d{4})-release-notes\.html$/i },
  { key: 'software-depot', name: 'Software Depot', category: 'Operations', strategy: 'techdocs',
    index: `${PATCH}/vcf-operations.html`, nested: true, leaf: /\/software-depot-9-1-0-(\d{4})-release-notes\.html$/i },
  // Un-patched in EP2 (no patch leaf) -> render at GA build from the 9.1.0.0 Bill of Materials.
  // GA_DATE is the VCF 9.1.0.0 general-availability date (release-notes header: "12 MAY 2026").
  { key: 'vsp', name: 'VCF Services Runtime (VSP)', category: 'Management', strategy: 'static',
    version: '9.1.0.0', build: '25370367', releaseDate: GA_DATE, sourceUrl: BOM },
  { key: 'telemetry', name: 'Telemetry', category: 'Management', strategy: 'static',
    version: '9.1.0.0', build: '25181946', releaseDate: GA_DATE, sourceUrl: BOM },
  { key: 'identity-broker', name: 'Identity Broker', category: 'Management', strategy: 'static',
    version: '9.1.0.0', build: '25368698', releaseDate: GA_DATE, sourceUrl: BOM },
  // Optional add-ons (#181): NOT part of the base VCF BOM. Each patches on its own cadence and
  // versioning scheme, in its own TechDocs release-notes tree (not the VCF 9-1-0-NNNN patch tree),
  // so each needs a dedicated strategy rather than the shared techdocs walker.
  // vDefend + DSM are single rolling pages ('page' strategy: read version + build in place).
  { key: 'vdefend', name: 'vDefend (Firewall / IDS-IPS / ATP)', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/vdefend-firewall/9-1/release-notes/vmware-vdefend-91-release-notes.html',
    versionRe: /vDefend\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build Number:?\s*(\d{8})/i },
  { key: 'dsm', name: 'Data Services Manager', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/dsm/data-services-manager/9-1/release-notes/vmware-data-services-manager-91-release-notes.html',
    versionRe: /Data Services Manager\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build\s+(\d{8})/i,
    dateRe: /Data Services Manager\s+[\d.]+\s*\|\s*([^|]+?)\s*\|\s*Build/i },
  // Avi mints a per-version leaf page and publishes NO 8-digit build; discover the newest leaf and
  // read the version from its heading. build stays null (rendered as an em-dash on the page).
  { key: 'avi-lb', name: 'Avi Load Balancer (NSX ALB)', category: 'Add-ons', strategy: 'avi',
    index: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer/32-1/vmware-avi-load-balancer-release-notes.html',
    leaf: /release-notes-for-avi-load-balancer-version-(\d+)-(\d+)-(\d+)\.html$/i,
    versionRe: /Avi Load Balancer Version\s+(\d+\.\d+\.\d+)/i },
];

const UA = 'Mozilla/5.0 (compatible; VCF9-DeploymentPlanning version scraper; +https://github.com/pauldiee/VCF9-DeploymentPlanning)';

async function fetchText(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i === tries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

// Collapse tags/entities to plain text for build/version matching.
function plain(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ');
}

// Absolute hrefs found in the page (deduped).
function hrefs(html, baseUrl) {
  const out = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#?]+)["']/gi)) {
    try { out.add(new URL(m[1], baseUrl).href.split('#')[0]); } catch { /* skip */ }
  }
  return [...out];
}

const verNum = (s) => parseInt(String(s).slice(-4), 10); // "9-1-0-0400" or "0400" -> 400

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
// Normalize "13 JUL 2026" or "2026-07-13" to ISO "2026-07-13"; return null if unrecognized.
function isoDate(s) {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  return null;
}

// First version-anchored "<ver> | <date> | Build <8-digit>" on a leaf page. Each leaf is a
// single product, so the first hit is that product's own build (later hits on a bundle would
// be sub-components).
function extractLeafBuild(html) {
  const text = plain(html);
  // VCF build numbers are 8 digits; take the first 8 after "Build" so a stray adjacent digit
  // (software-depot's leaf renders a spurious 9th) can't inflate the value.
  const m = text.match(/(9\.\d+\.\d+\.\d{4})\s*\|\s*([^|]+?)\s*\|\s*Build\s*(\d{8})/i);
  if (!m) return null;
  return { version: m[1].trim(), releaseDate: isoDate(m[2]), build: m[3].trim() };
}

async function scrapeTechdocs(c) {
  const indexHtml = await fetchText(c.index);
  const subtreeDir = c.index.replace(/\.html$/i, ''); // e.g. .../nsx  or  .../vcf-operations
  const inSubtree = hrefs(indexHtml, c.index).filter((h) => h.startsWith(subtreeDir + '/'));

  let leafUrl;
  if (c.nested) {
    // newest version sub-index: .../<subtree>/9-1-0-0NNN.html
    const subIdx = inSubtree
      .map((h) => ({ h, m: h.match(/\/9-1-0-(\d{4})\.html$/i) }))
      .filter((x) => x.m)
      .sort((a, b) => verNum(b.m[1]) - verNum(a.m[1]))[0];
    if (!subIdx) throw new Error('no version sub-index found');
    const subHtml = await fetchText(subIdx.h);
    leafUrl = hrefs(subHtml, subIdx.h)
      .filter((h) => c.leaf.test(h))
      .sort((a, b) => verNum(b.match(c.leaf)[1]) - verNum(a.match(c.leaf)[1]))[0];
  } else {
    leafUrl = inSubtree
      .filter((h) => c.leaf.test(h))
      .sort((a, b) => verNum(b.match(c.leaf)[1]) - verNum(a.match(c.leaf)[1]))[0];
  }
  if (!leafUrl) throw new Error('no matching leaf href found');

  const leafHtml = await fetchText(leafUrl);
  const got = extractLeafBuild(leafHtml);
  if (!got || !got.build) throw new Error('leaf carried no build');
  return { ...got, sourceUrl: leafUrl };
}

async function scrapeKb(c) {
  const html = await fetchText(c.url);
  const text = plain(html);
  // KB table row shape: "9.1.0.0NNN  YYYY-MM-DD  <8-digit build>". Take the highest version.
  const rows = [];
  for (const m of text.matchAll(/(9\.1\.0\.0\d{3})\s+(\d{4}-\d{2}-\d{2})\s+(\d{8})(?!\d)/gi)) {
    rows.push({ version: m[1], releaseDate: m[2], build: m[3] });
  }
  if (!rows.length) throw new Error('no version/build pair in KB');
  rows.sort((a, b) => verNum(b.version) - verNum(a.version));
  return { version: rows[0].version, build: rows[0].build, releaseDate: isoDate(rows[0].releaseDate), sourceUrl: c.url };
}

// Single rolling release-notes page (vDefend, DSM): read version + build (+ optional date) in place.
// These pages are revised without minting per-patch leaves, so we re-read every run.
async function scrapePage(c) {
  const text = plain(await fetchText(c.url));
  const vm = text.match(c.versionRe);
  if (!vm) throw new Error('no version match on page');
  const bm = c.buildRe ? text.match(c.buildRe) : null;
  if (c.buildRe && !bm) throw new Error('no build match on page');
  const dm = c.dateRe ? text.match(c.dateRe) : null;
  return { version: vm[1].trim(), build: bm ? bm[1].trim() : null, releaseDate: dm ? isoDate(dm[1]) : null, sourceUrl: c.url };
}

// Avi Load Balancer: no 8-digit build is published, and each release is its own leaf page under a
// train index. Discover the highest-numbered leaf and read the version from its heading. build=null.
const aviNum = (m) => parseInt(m[1], 10) * 1e6 + parseInt(m[2], 10) * 1e3 + parseInt(m[3], 10);
async function scrapeAvi(c) {
  const idxHtml = await fetchText(c.index);
  const leaf = hrefs(idxHtml, c.index)
    .map((h) => ({ h, m: h.match(c.leaf) }))
    .filter((x) => x.m)
    .sort((a, b) => aviNum(b.m) - aviNum(a.m))[0];
  if (!leaf) throw new Error('no Avi leaf href found');
  const text = plain(await fetchText(leaf.h));
  const vm = text.match(c.versionRe);
  const version = vm ? vm[1].trim() : leaf.m.slice(1, 4).join('.');
  return { version, build: null, releaseDate: null, sourceUrl: leaf.h };
}

function loadPrev() {
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return { components: [] }; }
}

async function main() {
  const prev = loadPrev();
  const prevByKey = new Map((prev.components || []).map((c) => [c.key, c]));
  const errors = [];
  const components = [];

  for (const c of COMPONENTS) {
    const base = { key: c.key, name: c.name, category: c.category, ...(c.parent ? { parent: c.parent } : {}) };
    if (c.strategy === 'static') {
      components.push({ ...base, version: c.version, build: c.build, releaseDate: c.releaseDate ?? null, sourceUrl: c.sourceUrl, patched: false });
      continue;
    }
    try {
      const r =
        c.strategy === 'kb' ? await scrapeKb(c)
        : c.strategy === 'page' ? await scrapePage(c)
        : c.strategy === 'avi' ? await scrapeAvi(c)
        : await scrapeTechdocs(c);
      components.push({ ...base, version: r.version, build: r.build, releaseDate: r.releaseDate ?? null, sourceUrl: r.sourceUrl, patched: true });
      console.log(`OK   ${c.key.padEnd(18)} ${r.version}  Build ${r.build}`);
    } catch (err) {
      const kept = prevByKey.get(c.key);
      errors.push({ key: c.key, source: c.url || c.index, error: String(err.message || err) });
      if (kept) {
        components.push({ ...kept });
        console.warn(`KEEP ${c.key.padEnd(18)} last-known ${kept.version} Build ${kept.build}  (${err.message})`);
      } else {
        components.push({ ...base, version: null, build: null, releaseDate: null, sourceUrl: c.url || c.index, patched: null });
        console.warn(`MISS ${c.key.padEnd(18)} no prior value  (${err.message})`);
      }
    }
  }

  const out = { _updated: new Date().toISOString().slice(0, 10), _sourceErrors: errors, _sources: { techdocs: PATCH, ga: GA_RN }, components };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${OUT}  (${components.length} components, ${errors.length} source error(s))`);
  if (errors.length) process.exitCode = 0; // fail-safe kept last-known; do not fail CI
}

main().catch((e) => { console.error(e); process.exit(1); });
