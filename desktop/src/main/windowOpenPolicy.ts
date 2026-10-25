import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OpenLinkRequest } from '@shared/types'
import { isExternalLinkProtocol } from './fs/openLink'

export type LinkOpener = (req: OpenLinkRequest) => Promise<void>

/** Defense in depth: safe `_blank` URLs leave through the OS; no popup becomes a child window. */
export function createWindowOpenHandler(open: LinkOpener) {
  return ({ url }: { url: string }): { action: 'deny' } => {
    try {
      if (isExternalLinkProtocol(new URL(url).protocol)) void open({ href: url }).catch(() => undefined)
    } catch {
      // Malformed and relative popup URLs are denied without an OS side effect.
    }
    return { action: 'deny' }
  }
}

/**
 * A file dropped where nothing takes it must not open in the window (YAZ-3253 S21). Chromium
 * navigates a page to a dropped file's `file:` URL when no drop handler took the drop; this
 * `will-navigate` listener stops exactly that. Only `file:`: the app's own pages are `app:` (or the
 * dev server's `http:`) and never navigate to a file, so nothing the app does is stopped. Main, not a
 * window-wide `drop` guard in the page: the editor's own image drop (YAZ-1656) keeps working untouched.
 * Returns the dropped file's path, so main can tell a drag out of another window that landed here
 * (YAZ-3263, `dropLanded`); null for any other navigation.
 */
export function blockFileNavigation(event: { url?: string; preventDefault: () => void }, url?: string): string | null {
  try {
    const target = new URL(event.url ?? url ?? '')
    if (target.protocol !== 'file:') return null
    event.preventDefault()
    return path.resolve(fileURLToPath(target))
  } catch {
    // Not a URL: Chromium fails such a navigation itself.
    return null
  }
}
