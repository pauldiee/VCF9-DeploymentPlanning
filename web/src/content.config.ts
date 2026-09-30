import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Resolve the content folders to absolute URLs anchored on this config file.
// These live outside the Astro project root (repo `docs/` and `samples/`); an
// absolute base gives every file one canonical id (a relative base can be tracked
// under two normalized paths). This alone does NOT fully stop the spurious
// "Duplicate id" warning — the incremental content cache (`.astro/collections/`)
// can still re-add an edited file after `dev`/`build` interleave. The reliable
// fix is the `prebuild` script (package.json) clearing `.astro` AND
// `node_modules/.astro` — the latter holds the content-layer render cache
// (data-store.json), keyed on file content only, so rehype-plugin changes in
// astro.config would otherwise serve stale HTML. CI (fresh checkout, no cache) is unaffected either way.
const docsBase = new URL('../../docs', import.meta.url);
const samplesBase = new URL('../../samples', import.meta.url);

// Read the planning docs in place from the repo's docs/ folder (single source
// of truth: the same .md that render on GitHub). No frontmatter required.
const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: docsBase }),
});

// Dutch translations (pilot, #290): docs/nl/<slug>.md, one per translated doc,
// same slug as its English source. Unlike the English docs these DO carry
// frontmatter: the hash of the English file they were translated from, which
// drives the "may be out of date" banner (scripts/nl-hash.mjs). The folder's
// own README is maintainer notes, not a page.
const docsNl = defineCollection({
  loader: glob({ pattern: ['*.md', '!README.md'], base: new URL('../../docs/nl', import.meta.url) }),
  schema: z.object({
    lang: z.literal('nl'),
    source: z.string(),
    source_hash: z.string(),
    synced: z.string(),
    // "no" until a person has read the translation; then the review date.
    reviewed: z.string(),
  }),
});

// Rainpole-style worked examples (docs/ blank templates filled in).
const samples = defineCollection({
  loader: glob({ pattern: '*.md', base: samplesBase }),
});

export const collections = { docs, docsNl, samples };
