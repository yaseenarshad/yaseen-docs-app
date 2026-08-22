/**
 * Bases property index (GRO-2127 / GRO-2128). Transport-agnostic: no Hono, no Electron — the
 * caller (today: tests; later: the Desktop bridge's `index(root)`) invokes `getIndex` directly.
 * The persistent cache (GRO-2223) is Electron-free too: `main/index.ts` injects the dir.
 */
export { flushIndexCache, initIndexCache } from './cache'
export type { ColdStartDiff } from './reconcile'
export { _evictAll, _setIdleMs, getColdStartDiff, getIndex } from './registry'
export { extractEmbeds, extractLinks, extractTags, scanFile } from './scan'
