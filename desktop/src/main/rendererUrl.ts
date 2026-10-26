/**
 * The renderer's address for a window (YAZ-3357, demo feedback: "⌘+ in the Files window is changing the sizing of the other
 * windows"). Chromium keeps ONE zoom level per origin, so a Files window loads the same bundle from an origin of its own and
 * its ⌘+ / ⌘− zoom Files windows only: `app://files/` in the app (every host but `vault` and `drawio` serves the bundle), and
 * in dev the dev server's IPv6 loopback `[::1]` (where it listens) beside the other windows' `localhost`. Nothing is stored in
 * the browser profile, so the origin carries nothing else.
 */
export const FILES_APP_HOST = 'files'

export function rendererUrlFor(base: string, files: boolean): URL {
  const url = new URL(base)
  if (!files) return url
  if (url.protocol === 'app:') url.host = FILES_APP_HOST
  else if (url.hostname === 'localhost') url.hostname = '[::1]'
  return url
}

/** `raw` is the renderer of a normal window or of a Files window: the same scheme and path, on either host. */
export function isRendererUrl(raw: string, base: string): boolean {
  try {
    const actual = new URL(raw)
    return [rendererUrlFor(base, false), rendererUrlFor(base, true)].some((renderer) => actual.protocol === renderer.protocol && actual.host === renderer.host && actual.pathname === renderer.pathname)
  } catch {
    return false
  }
}
