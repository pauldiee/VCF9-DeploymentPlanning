// nl-hash.mjs
// One definition of "the English source changed" for the Dutch translation
// pilot (#290), shared by the build-time banner (src/components/DocPage.astro)
// and the drift check (scripts/check-nl-sync.mjs).
//
// Each docs/nl/<slug>.md records the hash of the docs/<slug>.md it was
// translated from, in its frontmatter (`source_hash`). Line endings are
// normalized first, so a CRLF checkout on Windows and an LF checkout in CI
// hash the same.

import { createHash } from 'node:crypto';

/** @param {string} text the English source file's content */
export function sourceHash(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}
