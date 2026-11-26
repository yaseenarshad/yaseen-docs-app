import type { WebLinksStyle } from './webLinks'

/** Isolated default so `shared/types.ts` never pulls `shared/webLinks.ts` runtime code into Mobile's first-load chunk. */
export const DEFAULT_WEB_LINKS: WebLinksStyle = /*#__PURE__*/ Object.freeze({})
