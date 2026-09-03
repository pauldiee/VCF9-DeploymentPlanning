// scrape-versions.mjs
// Scrapes the current latest version + build per VCF 9.1.x component from Broadcom's
// server-rendered KB / TechDocs pages and writes web/src/data/vcf-versions.json.
//
// In VCF 9.1 components patch per-component and asynchronously (Express Patches), so a
// point-in-time table drifts within weeks. This keeps it honest on a schedule.
//
// Broadcom's 9.x version string is X.Y.Z.EEHH.######## :
//   X  Major version        (~3 yr)   -.
//   Y  Minor version        (~9 mo)    |- an UPGRADE (update sequence required)
//   Z  Maintenance version  (~3 mo)   -'
//   EE Express Patch  ]  the 4-char EEHH field -- a PATCH (no update sequence required)
//   HH Hot Patch      ]
//   ######## Build number
// So 9.1.0 -> 9.1.1 is a maintenance-version *upgrade*, and 9.1.0.0300 -> 9.1.0.0400 is an
// express *patch* within 9.1.0. This script calls each X.Y.Z stream (9.1.0.x, 9.1.1.x) a
// "release line".
//
// Multiple release lines (#265): once 9.1.1 shipped there are concurrent patch streams --
// 9.1.0.x keeps taking express/hot patches (security backports) for fleets still on that
// maintenance version, 9.1.1.x is a separate stream, neither supersedes the other. So the
// output carries one component set per supported release line (`lines[]`), plus a shared
// `addons[]` (vDefend / DSM / License Hub / Avi version on their own schemes, unaffected by
// the VCF maintenance version). Adding a future line is one `LINES` entry; adding a patch tree
// to a line that only has a BOM today is one field.
//
// Fail-safe: on any fetch/parse miss, the last-known value is kept (never blanked) and the
// failing source is recorded in `_sourceErrors`. Both source shapes are plain server-rendered
// HTML, so a bare fetch returns the data (no JS/Cloudflare gate) and this runs fine in CI.
//
// Author: Paul van Dieen  -  https://www.hollebollevsan.nl
// Issues: #179 (page), #180 (VCF Operations nodes), #181 (optional add-ons), #184 (GA release dates),
//         #187 (walk ALL sub-indexes; VSP/Identity Broker/Telemetry nested-with-GA-fallback; +3 Ops components),
//         #214 (knownBadRender), #230 (vCenter off the KB), #258 (License Hub), #265 (per-minor lines)
// Run:    node web/scripts/scrape-versions.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/vcf-versions.json');

const TD = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes';

// The Major.Minor family this page covers. Shown in the page title/intro; per-line sections
// carry their own full maintenance version (`9.1.0`, `9.1.1`).
const FAMILY = '9.1';

// Supported VCF release lines (one per maintenance version), newest first. Each has its own
// patch tree, BOM and GA date.
//   z:      the maintenance-version digit (0 for 9.1.0.x, 1 for 9.1.1.x) -- substituted into
//           every component leaf regex, so one manifest covers all lines.
//   patch:  the patch-releases-9-1-Z-x tree root, or null until Broadcom opens one. While it
//           is null the whole line runs at its BOM (GA) builds, rendered with the "GA" pill.
//   bom:    the line's Bill of Materials page. The slug is version-scoped and NOT consistent
//           between lines: 9.1.0.0 is ".../vmware-cloud-foundation-bill-of-materials.html",
//           9.1.1.0 is ".../vmware-cloud-foundation-9-1-1-0-bill-of-material.html" (singular).
const LINES = [
  {
    v: '9.1.1', z: 1, ga: '2026-09-03', patch: null,
    bom: `${TD}/vmware-cloud-foundation-9-1-1-0-release-notes/vmware-cloud-foundation-9-1-1-0-bill-of-material.html`,
  },
  {
    v: '9.1.0', z: 0, ga: '2026-05-12', patch: `${TD}/patch-releases-9-1-0-x`,
    bom: `${TD}/vmware-cloud-foundation-9-1-0-0-release-notes/vmware-cloud-foundation-bill-of-materials.html`,
  },
];

// VCF 9.1 release-notes landing page - indexes every maintenance version's release notes
// (each with its Bill of Materials) and every patch-release tree. Linked from the page footer
// as the single "start here" source; every table row also links its own exact source.
const RELEASE_NOTES = `${TD}.html`;

// --- Per-minor component manifest -------------------------------------------------------------
//
// One entry per component that ships inside the VCF BOM and patches on the 9-1-N-NNNN cadence.
//   indexPath:  path under a line's patch tree to the component's patch index
//               (e.g. "vsphere/vcenter.html" -> "<line.patch>/vsphere/vcenter.html").
//   leafSlug:   the release-notes filename stem. Built into a minor-parameterised regex
//               "/<slug>-9-1-<minor>-(\d{4})-release-notes.html$". The slug may itself contain
//               regex (the Real-Time Metrics leaf misspells "metrics" as "mertics" upstream, so
//               both spellings are tolerated). Anchored with a leading "/" so a sibling leaf
//               can't be mistaken for the product (e.g. "vcfoperations-" vs "vcf-operations-*-").
//   nested:     the component's leaves live under version sub-indexes
//               ("<tree>/9-1-<minor>-NNNN.html") rather than directly off the component index.
//   bomName:    the component's row label in the Bill of Materials table -- used to read its
//               GA build when a line has no patch tree yet, or when it has shipped no patch leaf.
//   knownBadRender: see extractLeafBuild() (#214).
const COMPONENTS = [
  // vCenter reads TechDocs, not KB 326316, since #230 (the KB lagged a security patch by a day).
  { key: 'vcenter', name: 'vCenter Server', category: 'Core',
    indexPath: 'vsphere/vcenter.html', leafSlug: 'vcenter', bomName: 'vCenter' },
  { key: 'esxi', name: 'ESXi', category: 'Core',
    indexPath: 'vsphere/esx.html', leafSlug: 'esx', bomName: 'ESX' },
  { key: 'nsx', name: 'NSX', category: 'Core',
    indexPath: 'nsx.html', leafSlug: 'nsx', bomName: 'NSX' },
  { key: 'sddc-manager', name: 'SDDC Manager', category: 'Core',
    indexPath: 'vcf-installer.html', leafSlug: 'sddc-manager', bomName: 'SDDC Manager' },

  { key: 'vcf-operations', name: 'VCF Operations', category: 'Operations',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcfoperations', bomName: 'VCF Operations' },
  // VCF Operations for Networks + HCX (#187): separate products in the family, not internal nodes.
  { key: 'vcf-ops-for-networks', name: 'VCF Operations for Networks', category: 'Operations',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-operations-for-networks',
    bomName: 'VCF Operations for networks' },
  { key: 'vcf-ops-hcx', name: 'VCF Operations HCX', category: 'Operations',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-operations-hcx',
    bomName: 'VCF Operations HCX' },

  // VCF Operations services (#180 -> Management in #187): independently-versioned, ship in the
  // vcf-operations/<ver>/ tree but run in the management plane, so listed under Management.
  { key: 'vcf-ops-orchestrator', name: 'Orchestrator', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-operations-orchestrator',
    bomName: 'VCF Operations orchestrator' },
  { key: 'vcf-ops-log-management', name: 'Log Management', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'log-management', bomName: 'Log management' },
  // Broadcom's leaf slug misspells "metrics" as "mertics"; tolerate both.
  { key: 'vcf-ops-real-time-metrics', name: 'Real-Time Metrics', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'real-time-me(?:rt|tr)ics',
    bomName: 'Real-time metrics' },
  { key: 'vcf-ops-real-time-metrics-store', name: 'Real-Time Metrics Store', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'real-time-me(?:rt|tr)ics-store',
    bomName: 'Real-time metrics store' },

  { key: 'vcf-automation', name: 'VCF Automation', category: 'Automation',
    indexPath: 'vcf-automation.html', leafSlug: 'vcfautomation', bomName: 'VCF Automation' },

  // VCF Operations bundle sub-components (own leaf under vcf-operations/<ver>/).
  { key: 'fleet-lifecycle', name: 'Fleet Lifecycle Management', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'fleet-lifecycle', bomName: 'Fleet lifecycle' },
  { key: 'sddc-lifecycle', name: 'SDDC Lifecycle Management', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'sddc-lifecycle', bomName: 'SDDC lifecycle' },
  { key: 'salt-master', name: 'Salt Master', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'salt-master', bomName: 'Salt master' },
  { key: 'salt-raas', name: 'Salt RaaS', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'salt-raas', bomName: 'Salt RaaS' },
  // software-depot's 9.1.0.0400 leaf renders "Build 255070105" (an extra 0 after the third
  // digit); the real build is 25570105, reconciled by a human (#214). Only substituted when the
  // page renders this EXACT malformed string for this EXACT version -- any change and we throw.
  { key: 'software-depot', name: 'Software Depot', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'software-depot', bomName: 'Software depot',
    knownBadRender: { version: '9.1.0.0400', raw: '255070105', build: '25570105', verified: '2026-07-22',
      note: 'Broadcom inserts an extra 0 after the third digit; confirmed against product inventory' } },

  // Management components (#187): live in the vcf-operations/<ver>/ tree, patch on their own
  // cadence but not on every Express Patch -- walk the tree, and if no leaf exists yet fall back
  // to the line's Bill-of-Materials build (rendered with the GA pill).
  { key: 'vsp', name: 'VCF Services Runtime (VSP)', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-services-runtime',
    bomName: 'VCF services runtime' },
  { key: 'telemetry', name: 'Telemetry', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'telemetry', bomName: 'Telemetry' },
  { key: 'identity-broker', name: 'Identity Broker', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'identity-broker', bomName: 'Identity broker' },
];

// --- Shared add-ons (not part of the base VCF BOM; scraped once, not per minor) ---------------
const ADDONS = [
  { key: 'vdefend', name: 'vDefend (Firewall / IDS-IPS / ATP)', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/vdefend-firewall/9-1/release-notes/vmware-vdefend-91-release-notes.html',
    versionRe: /vDefend\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build Number:?\s*(\d{8})/i },
  { key: 'dsm', name: 'Data Services Manager', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/dsm/data-services-manager/9-1/release-notes/vmware-data-services-manager-91-release-notes.html',
    versionRe: /Data Services Manager\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build\s+(\d{8})/i,
    dateRe: /Data Services Manager\s+[\d.]+\s*\|\s*([^|]+?)\s*\|\s*Build/i },
  // License Hub (#258): standalone OVA since 2.0, licensing vDefend + Avi. Own release-notes
  // tree, own 8-digit build. Header renders "License Hub 2.0 ... | August 5, 2026 | Build ...".
  { key: 'license-hub', name: 'License Hub (vDefend / Avi licensing)', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/release-notes/license-hub-20-for-vmware-vdefend-and-avi-load-balancer-release-notes.html',
    versionRe: /License Hub\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build\s+(\d{8})/i,
    dateRe: /License Hub\s+[\d.]+[^|]*\|\s*([^|]+?)\s*\|\s*Build/i },
  // Avi mints a per-version leaf page and publishes NO 8-digit build; discover the newest leaf.
  { key: 'avi-lb', name: 'Avi Load Balancer (NSX ALB)', category: 'Add-ons', strategy: 'avi',
    index: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer/32-1/vmware-avi-load-balancer-release-notes.html',
    leaf: /release-notes-for-avi-load-balancer-version-(\d+)-(\d+)-(\d+)\.html$/i,
    versionRe: /Avi Load Balancer Version\s+(\d+\.\d+\.\d+)/i },
];

const UA = 'Mozilla/5.0 (compatible; VCF9-DeploymentPlanning version scraper; +https://github.com/pauldiee/VCF9-DeploymentPlanning)';

// In-run cache: the all-sub-index walk (#187) re-reads the same family index + sub-indexes across
// every nested component and across both lines, so memoize by URL to keep the fetch count low.
const _fetchCache = new Map();
function fetchText(url, tries = 3) {
  if (!_fetchCache.has(url)) _fetchCache.set(url, _fetchText(url, tries));
  return _fetchCache.get(url);
}

async function _fetchText(url, tries = 3) {
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

// The trailing 4 chars are the EEHH (Express+Hot Patch) field; parseInt orders it correctly
// (0400 > 0300, 0401 > 0400, 1000 > 0900) as long as it is always 4 digits, which it is.
const eehh = (s) => parseInt(String(s).slice(-4), 10); // "9-1-0-0400" or "0400" -> 400

// The component leaf regex for a given maintenance version z:
// "/<slug>-9-1-<z>-(\d{4})-release-notes.html$"  -- the (\d{4}) capture is the EEHH field.
const leafRe = (slug, z) => new RegExp(`/${slug}-9-1-${z}-(\\d{4})-release-notes\\.html$`, 'i');

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
// Normalize "13 JUL 2026", "August 5, 2026" or "2026-07-13" to ISO "2026-07-13"; null if unrecognized.
function isoDate(s) {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  const m2 = t.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m2 && MONTHS[m2[1].toUpperCase()]) return `${m2[3]}-${MONTHS[m2[1].toUpperCase()]}-${m2[2].padStart(2, '0')}`;
  return null;
}

// First version-anchored "<ver> | <date> | Build <8-digit>" on a leaf page. Each leaf is a
// single product, so the first hit is that product's own build.
//
// A wrong build is worse than a missing one: anything that is not exactly 8 digits throws, and
// the caller keeps the last-known value. The ONE exception (#214) is a `knownBadRender` -- a
// malformed string a human has reconciled against the real product inventory; accepted only
// when the page renders EXACTLY the recorded malformed string for the recorded version.
function extractLeafBuild(html, c) {
  const text = plain(html);
  const m = text.match(/(9\.\d+\.\d+\.\d{4})\s*\|\s*([^|]+?)\s*\|\s*Build\s*(\d+)/i);
  if (!m) return null;
  const version = m[1].trim();
  const build = m[3].trim();
  if (!/^\d{8}$/.test(build)) {
    const kbr = c?.knownBadRender;
    if (kbr && kbr.raw === build && kbr.version === version) {
      return { version, releaseDate: isoDate(m[2]), build: kbr.build, pinned: kbr };
    }
    throw new Error(
      `implausible build "${build}" (${build.length} digits, expected 8) for ${version} -- ` +
      `likely a typo in the Broadcom release notes; refusing to guess` +
      (kbr ? ` (knownBadRender is recorded for ${kbr.version}/"${kbr.raw}" and does NOT match: upstream changed, re-verify)` : '')
    );
  }
  return { version, releaseDate: isoDate(m[2]), build };
}

// Read a component's GA build from a line's Bill of Materials table. The BOM table is
// 4-column -- [Component] [VVF component? ("", "Yes", "Yes (VCF Installer)")] [Version] [Build] --
// so parse rows into cells rather than regexing the flattened text: the middle column pushes
// the version away from the name for most rows. Match the component's row by an exact
// normalised name (the one alias is the "VCF Installer/ SDDC Manager" row, stripped to
// "sddc manager"), so "VCF Operations" cannot swallow "VCF Operations for networks". The BOM
// carries no per-row date, so the line's GA date is used.
const normBom = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^vcf installer\/\s*/, '');
function extractBomBuild(html, c, line) {
  if (!c.bomName) return null;
  const want = normBom(c.bomName);
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((td) =>
      td.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length < 3 || normBom(cells[0]) !== want) continue;
    const vi = cells.findIndex((x) => /^9\.\d+\.\d+/.test(x));
    if (vi === -1) continue;
    const build = (cells[vi + 1] || '').trim();
    if (!/^\d{8}$/.test(build)) return null;
    return { version: cells[vi], build, releaseDate: line.ga, sourceUrl: line.bom, patched: false };
  }
  return null;
}

// Walk a line's patch tree for one component. Returns null (not throw) when the tree is
// reachable but carries no leaf for this component yet -- the caller then falls back to the BOM.
async function scrapeTechdocs(c, line) {
  const index = `${line.patch}/${c.indexPath}`;
  const re = leafRe(c.leafSlug, line.z);
  const indexHtml = await fetchText(index);
  const subtreeDir = index.replace(/\.html$/i, '');
  const inSubtree = hrefs(indexHtml, index).filter((h) => h.startsWith(subtreeDir + '/'));

  let leafUrl;
  if (c.nested) {
    // Gather this component's leaf across ALL EEHH sub-indexes for this line (#187): a
    // component's latest patch can live in an older sub-index than the family's newest.
    const subRe = new RegExp(`/9-1-${line.z}-\\d{4}\\.html$`, 'i');
    const subIdxs = inSubtree.filter((h) => subRe.test(h));
    if (!subIdxs.length) return null; // no patch sub-index for this line yet
    const candidates = [];
    for (const s of subIdxs) {
      const subHtml = await fetchText(s);
      for (const h of hrefs(subHtml, s)) if (re.test(h)) candidates.push(h);
    }
    leafUrl = candidates.sort((a, b) => eehh(b.match(re)[1]) - eehh(a.match(re)[1]))[0];
  } else {
    leafUrl = inSubtree
      .filter((h) => re.test(h))
      .sort((a, b) => eehh(b.match(re)[1]) - eehh(a.match(re)[1]))[0];
  }
  if (!leafUrl) return null;

  const leafHtml = await fetchText(leafUrl);
  const got = extractLeafBuild(leafHtml, c);
  if (!got || !got.build) throw new Error('leaf carried no build');
  return { ...got, sourceUrl: leafUrl, patched: true };
}

// Single rolling release-notes page (vDefend, DSM, License Hub): read version + build in place.
async function scrapePage(c) {
  const text = plain(await fetchText(c.url));
  const vm = text.match(c.versionRe);
  if (!vm) throw new Error('no version match on page');
  const bm = c.buildRe ? text.match(c.buildRe) : null;
  if (c.buildRe && !bm) throw new Error('no build match on page');
  const dm = c.dateRe ? text.match(c.dateRe) : null;
  return { version: vm[1].trim(), build: bm ? bm[1].trim() : null, releaseDate: dm ? isoDate(dm[1]) : null, sourceUrl: c.url };
}

// Avi Load Balancer: no 8-digit build; each release is its own leaf under a train index.
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
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return { lines: [], addons: [] }; }
}

async function main() {
  const prev = loadPrev();
  // keep-last-known lookup: composite key per line for components, bare key for add-ons.
  const prevByKey = new Map();
  for (const ln of prev.lines || []) for (const c of ln.components || []) prevByKey.set(`${ln.v}:${c.key}`, c);
  for (const a of prev.addons || []) prevByKey.set(`addon:${a.key}`, a);

  const errors = [];
  const lines = [];

  for (const line of LINES) {
    const bomHtml = await fetchText(line.bom).catch((err) => {
      errors.push({ key: `bom:${line.v}`, source: line.bom, error: String(err.message || err) });
      return null;
    });
    const comps = [];
    for (const c of COMPONENTS) {
      const base = { key: c.key, name: c.name, category: c.category };
      try {
        let r = line.patch ? await scrapeTechdocs(c, line) : null;
        if (!r && bomHtml) r = extractBomBuild(bomHtml, c, line);
        if (!r) throw new Error(line.patch ? 'no patch leaf and not found in BOM' : 'not found in BOM');
        comps.push({
          ...base, version: r.version, build: r.build, releaseDate: r.releaseDate ?? null,
          sourceUrl: r.sourceUrl, patched: r.patched ?? true, ...(r.pinned ? { pinned: r.pinned } : {}),
        });
        const tag = r.pinned ? 'PIN ' : r.patched === false ? 'GA  ' : 'OK  ';
        console.log(`${tag} ${line.v}  ${c.key.padEnd(20)} ${r.version}  Build ${r.build}` +
          (r.pinned ? `  (upstream renders "${r.pinned.raw}"; verified ${r.pinned.verified})` : ''));
      } catch (err) {
        const kept = prevByKey.get(`${line.v}:${c.key}`);
        errors.push({ key: `${line.v}:${c.key}`, source: line.patch || line.bom, error: String(err.message || err) });
        if (kept) {
          comps.push({ ...kept });
          console.warn(`KEEP ${line.v}  ${c.key.padEnd(20)} last-known ${kept.version} Build ${kept.build}  (${err.message})`);
        } else {
          comps.push({ ...base, version: null, build: null, releaseDate: null, sourceUrl: line.bom, patched: null });
          console.warn(`MISS ${line.v}  ${c.key.padEnd(20)} no prior value  (${err.message})`);
        }
      }
    }
    lines.push({ v: line.v, ga: line.ga, hasPatchTree: !!line.patch, components: comps });
  }

  const addons = [];
  for (const c of ADDONS) {
    const base = { key: c.key, name: c.name, category: c.category };
    try {
      const r = c.strategy === 'page' ? await scrapePage(c) : await scrapeAvi(c);
      addons.push({ ...base, version: r.version, build: r.build, releaseDate: r.releaseDate ?? null, sourceUrl: r.sourceUrl, patched: true });
      console.log(`OK   addon ${c.key.padEnd(20)} ${r.version}  Build ${r.build}`);
    } catch (err) {
      const kept = prevByKey.get(`addon:${c.key}`);
      errors.push({ key: `addon:${c.key}`, source: c.url || c.index, error: String(err.message || err) });
      if (kept) {
        addons.push({ ...kept });
        console.warn(`KEEP addon ${c.key.padEnd(20)} last-known ${kept.version} Build ${kept.build}  (${err.message})`);
      } else {
        addons.push({ ...base, version: null, build: null, releaseDate: null, sourceUrl: c.url || c.index, patched: null });
        console.warn(`MISS addon ${c.key.padEnd(20)} no prior value  (${err.message})`);
      }
    }
  }

  const out = {
    _updated: new Date().toISOString().slice(0, 10),
    _family: FAMILY,
    _sourceErrors: errors,
    _sources: { releaseNotes: RELEASE_NOTES },
    lines,
    addons,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  const n = lines.reduce((s, l) => s + l.components.length, 0) + addons.length;
  console.log(`\nWrote ${OUT}  (${lines.length} line(s), ${n} rows, ${errors.length} source error(s))`);
  if (errors.length) process.exitCode = 0; // fail-safe kept last-known; do not fail CI
}

main().catch((e) => { console.error(e); process.exit(1); });
