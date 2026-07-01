// @ts-check
import { defineConfig } from 'astro/config';

// Project page: https://pauldiee.github.io/VCF9-DeploymentPlanning/
const SITE = 'https://pauldiee.github.io';
const BASE = '/VCF9-DeploymentPlanning';

/**
 * Rewrite in-repo markdown cross-links (e.g. `01-network-dns-plan.md`,
 * `./prerequisites.md#dns`) to site routes under <base>/docs/<slug>.
 * The docs are authored as plain .md that also render on GitHub, so their
 * links point at sibling files. On the site those files become doc pages.
 * @returns {(tree: any) => void}
 */
function rehypeRewriteDocLinks() {
  const DOC_LINK = /^(?:\.\/)?([\w-]+)\.md(#.*)?$/;
  return (tree) => {
    const visit = (node) => {
      if (node.type === 'element' && node.tagName === 'a' && node.properties) {
        const href = node.properties.href;
        if (typeof href === 'string') {
          const m = href.match(DOC_LINK);
          if (m) node.properties.href = `${BASE}/docs/${m[1]}/${m[2] ?? ''}`;
        }
      }
      if (node.children) node.children.forEach(visit);
    };
    visit(tree);
  };
}

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  markdown: {
    rehypePlugins: [rehypeRewriteDocLinks],
  },
});
