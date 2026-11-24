// Static template-card previews (448×280 WebP, a few KB each) generated from
// fully settled renders by `npm run templates:thumbs` (tools/template-thumbs.mjs).
// Vite fingerprints each file and fetches it only when a card is shown.
const urls = import.meta.glob('../assets/template-thumbs/*/*.webp', { eager: true, import: 'default', query: '?url' });

const byKey = new Map(Object.entries(urls).map(([file, url]) => {
  const [, kind, id] = file.match(/template-thumbs\/([^/]+)\/([^/]+)\.webp$/);
  return [`${kind}/${id}`, url];
}));

/** URL of the shipped preview for a template, or null when none exists. */
export function templateThumbnailUrl(kind, id) {
  return byKey.get(`${kind}/${id}`) ?? null;
}
