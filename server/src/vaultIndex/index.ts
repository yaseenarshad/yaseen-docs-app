/**
 * Bases property index (GRO-2127 / GRO-2128). Transport-agnostic: no Hono, no Electron — the
 * caller (today: tests; later: the Desktop bridge's `index(root)`) invokes `getIndex` directly.
 */
export { extractEmbeds, extractLinks, extractTags, scanFile } from './scan'
export { _evictAll, _setIdleMs, getIndex } from './registry'
