import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Resolve the content folders to absolute URLs anchored on this config file.
// These live outside the Astro project root (repo `docs/` and `samples/`), and a
// relative `base` gets tracked under two different normalized paths by the `dev`
// and `build` content syncs — which surfaces as spurious "Duplicate id" warnings.
// An absolute base gives every file one canonical id, so the warning can't occur.
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
