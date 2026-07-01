// Join a site-relative path onto the configured base, tolerating whether
// BASE_URL carries a trailing slash. Always yields exactly one separator.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

export function withBase(path = ''): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

export function docHref(slug: string): string {
  return withBase(`docs/${slug}/`);
}
