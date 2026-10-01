#!/usr/bin/env node
/**
 * Link guard for the deployment plan's guide links (#380).
 *
 * src/lib/deployment-plan.ts attaches absolute links to this site's own guides
 * (GUIDE_RULES), anchors included. A renamed heading silently breaks an anchor,
 * and the exported plan carries the dead link into Jira. This checks every link
 * the generator can emit, across a spread of selections, against the docs source:
 * the page must exist and the anchor must be one of its headings (slugged the way
 * Astro slugs them, with github-slugger). Tool links must have a page.
 *
 * Run: node scripts/check-plan-guides.mjs   (exit 1 on a dead link)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import GithubSlugger from 'github-slugger';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, '../../docs');
const PAGES = resolve(here, '../src/pages');
const LIB = resolve(here, '../src/lib/deployment-plan.ts');

const { outputFiles } = await build({ entryPoints: [LIB], bundle: true, format: 'esm', write: false, logLevel: 'error' });
const m = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

function selections() {
  const out = [];
  for (const conn of ['centralized', 'distributed']) {
    for (const lic of ['hub', 'cloud']) {
      for (const stretched of [false, true]) {
        const s = m.defaultSelection();
        s.connectivity = conn;
        s.mgmtStretched = stretched;
        s.day2 = true;
        s.vdefend = lic === 'hub';
        s.aviLicensing = lic;
        s.automation = { deploy: true, model: 'medium', placement: 'overlay', aviLb: true };
        s.day2Components = { logs: true, networks: true, identityBroker: stretched };
        s.wlds = [{ name: 'w1', stretched, connectivity: conn, supervisor: true, supervisorLb: 'avi' }];
        out.push(s);
      }
    }
  }
  const off = m.defaultSelection();
  off.day2 = false;
  off.automation.deploy = false;
  out.push(off);
  return out;
}

const anchorsCache = new Map();
function anchors(slug) {
  if (!anchorsCache.has(slug)) {
    const file = resolve(DOCS, `${slug}.md`);
    if (!existsSync(file)) anchorsCache.set(slug, null);
    else {
      const slugger = new GithubSlugger();
      const set = new Set();
      let fence = false;
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (/^\s*(```|~~~)/.test(line)) fence = !fence;
        const h = !fence && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
        if (h) set.add(slugger.slug(h[1].replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]/g, '')));
      }
      anchorsCache.set(slug, set);
    }
  }
  return anchorsCache.get(slug);
}

const seen = new Map(); // url -> where
for (const sel of selections()) {
  for (const e of m.selectedEpics(sel)) {
    for (const g of e.guides ?? []) seen.set(g.url, `${e.id} (epic)`);
    for (const s of e.stories) for (const g of s.guides ?? []) seen.set(g.url, `${e.id} story ${s.id}`);
  }
}

const bad = [];
for (const [url, where] of seen) {
  const path = url.slice(m.DOCS_SITE.length);
  const doc = path.match(/^\/docs\/([^/]+)\/(?:#(.+))?$/);
  const tool = path.match(/^\/tools\/([^/]+)\/$/);
  if (doc) {
    const set = anchors(doc[1]);
    if (!set) bad.push(`${url}  (${where}): no docs/${doc[1]}.md`);
    else if (doc[2] && !set.has(doc[2])) bad.push(`${url}  (${where}): no heading with anchor #${doc[2]}`);
  } else if (tool) {
    if (!existsSync(resolve(PAGES, 'tools', `${tool[1]}.astro`))) bad.push(`${url}  (${where}): no tools page`);
  } else bad.push(`${url}  (${where}): not a docs or tools URL on ${m.DOCS_SITE}`);
}

if (bad.length) {
  console.error(`FAIL  ${bad.length} dead deployment-plan guide link(s):`);
  for (const b of bad) console.error(`  - ${b}`);
  process.exit(1);
}
console.log(`OK  all ${seen.size} deployment-plan guide links resolve to a page and heading`);
