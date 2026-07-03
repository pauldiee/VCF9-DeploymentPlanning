import { readFileSync } from 'node:fs';

/**
 * Site version, read at build time from the top entry of the repo-root
 * CHANGELOG.md (both the GitHub and GitLab Pages builds check out the full
 * repo). Single source of truth: no separate version constant to bump.
 */
const changelog = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
const match = changelog.match(/^## (v\d+\.\d+\.\d+)/m);

if (!match) {
  throw new Error('version.ts: no "## vX.Y.Z" entry found at the top of CHANGELOG.md');
}

export const siteVersion = match[1];
