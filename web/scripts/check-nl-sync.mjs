#!/usr/bin/env node
/**
 * Drift guard for the Dutch translation pilot (#290): docs/nl/<slug>.md vs the
 * English docs/<slug>.md it was translated from.
 *
 * The English docs change constantly, and a stale translation is worse than
 * none. Each Dutch file records the hash of its English source in frontmatter
 * (`source_hash`). This script recomputes that hash and reports every Dutch
 * file whose source has moved on. The site shows the same mismatch to readers
 * as a banner on the page.
 *
 * It also lists the human review queue: every Dutch file whose frontmatter
 * still says `reviewed: "no"`. That never fails the build, in any mode.
 *
 * Soft by default: it warns and exits 0, so a doc-only commit is never blocked
 * during the pilot. `--strict` exits 1 on drift, for when the pilot is over.
 *
 * Run:  node scripts/check-nl-sync.mjs            (report, exit 0)
 *       node scripts/check-nl-sync.mjs --strict   (exit 1 on drift)
 *       node scripts/check-nl-sync.mjs --stamp <slug>   (after re-translating:
 *           record the current English hash and today's date in docs/nl/<slug>.md;
 *           `--stamp all` does every file)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sourceHash } from './nl-hash.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EN_DIR = resolve(here, '../../docs');
const NL_DIR = resolve(EN_DIR, 'nl');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const stampAt = args.indexOf('--stamp');
const stampTarget = stampAt >= 0 ? args[stampAt + 1] : null;

if (stampAt >= 0 && !stampTarget) {
  console.error('--stamp needs a slug (e.g. 11-esx-coredump) or "all"');
  process.exit(2);
}

/** Translated docs: every docs/nl/*.md except the folder's own README. */
const slugs = existsSync(NL_DIR)
  ? readdirSync(NL_DIR)
      .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
      .map((f) => f.replace(/\.md$/, ''))
  : [];

const field = (text, name) => {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(new RegExp(`^${name}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm'));
  return m ? m[1].trim() : null;
};

let drift = 0;
let problems = 0;
/** Translations no person has read yet (`reviewed: "no"`) -- the human review queue. */
const unreviewed = [];

for (const slug of slugs) {
  const nlPath = resolve(NL_DIR, `${slug}.md`);
  const enPath = resolve(EN_DIR, `${slug}.md`);
  if (!existsSync(enPath)) {
    console.warn(`MISSING  docs/nl/${slug}.md has no English source docs/${slug}.md`);
    problems++;
    continue;
  }
  const nl = readFileSync(nlPath, 'utf8');
  const current = sourceHash(readFileSync(enPath, 'utf8'));

  if (stampTarget && (stampTarget === 'all' || stampTarget === slug)) {
    if (field(nl, 'source_hash') === null || field(nl, 'synced') === null) {
      console.error(`NOFIELD  docs/nl/${slug}.md has no source_hash / synced frontmatter to stamp`);
      problems++;
      continue;
    }
    const today = new Date().toISOString().slice(0, 10);
    const stamped = nl
      .replace(/^(source_hash:\s*).*$/m, `$1"${current}"`)
      .replace(/^(synced:\s*).*$/m, `$1"${today}"`);
    writeFileSync(nlPath, stamped);
    console.log(`STAMPED  docs/nl/${slug}.md  source_hash=${current}  synced=${today}`);
    continue;
  }

  const reviewed = field(nl, 'reviewed');
  if (!reviewed || reviewed.toLowerCase() === 'no') unreviewed.push(slug);

  const recorded = field(nl, 'source_hash');
  if (!recorded) {
    console.warn(`NOFIELD  docs/nl/${slug}.md has no source_hash in its frontmatter`);
    problems++;
  } else if (recorded !== current) {
    console.warn(
      `STALE    docs/nl/${slug}.md was translated from an older docs/${slug}.md ` +
        `(recorded ${recorded}, now ${current}; last synced ${field(nl, 'synced') ?? 'unknown'})`,
    );
    drift++;
  } else {
    console.log(`OK       docs/nl/${slug}.md matches docs/${slug}.md`);
  }
}

if (!stampTarget) {
  console.log(
    `${slugs.length} Dutch doc(s) checked: ${drift} stale, ${problems} with problems` +
      (drift || problems ? (strict ? '' : ' (warning only; --strict fails the build)') : ''),
  );
  if (unreviewed.length) {
    console.log(`REVIEW   ${unreviewed.length} awaiting human review: ${unreviewed.join(', ')}`);
  }
}
if (strict && (drift || problems)) process.exit(1);
