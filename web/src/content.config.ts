import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Resolve the content folders to absolute URLs anchored on this config file.
// These live outside the Astro project root (repo `docs/` and `samples/`); an
// absolute base gives every file one canonical id (a relative base can be tracked
// under two normalized paths). This alone does NOT fully stop the spurious
// "Duplicate id" warning — the incremental content cache (`.astro/data-store.json`)
// can still re-add an edited file after `dev`/`build` interleave. The reliable
// fix is the `prebuild` script (package.json) clearing that store so every build
// starts from a clean cache. CI (fresh checkout, no cache) is unaffected either way.
const docsBase = new URL('../../docs', import.meta.url);
const samplesBase = new URL('../../samples', import.meta.url);

// Read the planning docs in place from the repo's docs/ folder (single source
// of truth: the same .md that render on GitHub). No frontmatter required.
const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: docsBase }),
});

// Rainpole-style worked examples (docs/ blank templates filled in).
const samples = defineCollection({
  loader: glob({ pattern: '*.md', base: samplesBase }),
});

export const collections = { docs, samples };
