import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Read the planning docs in place from the repo's docs/ folder (single source
// of truth: the same .md that render on GitHub). No frontmatter required.
const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: '../docs' }),
});

// Rainpole-style worked examples (docs/ blank templates filled in).
const samples = defineCollection({
  loader: glob({ pattern: '*.md', base: '../samples' }),
});

export const collections = { docs, samples };
