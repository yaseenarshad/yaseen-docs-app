import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindowConstructorOptions } from 'electron'
import { FILES_PREVIEW_FRAME, type OpenLinkRequest } from '@shared/types'
import { isExternalLinkProtocol } from './fs/openLink'

export type LinkOpener = (req: OpenLinkRequest) => Promise<void>

/**
 * The ONE popup a window may make (YAZ-3357 D9): a Files window's floating preview. No frame, a clear background, no
 * shadow of its own (the panel draws one), never focused, never in the Dock or the taskbar, hidden until main shows it.
 */
export const FILES_PREVIEW_OPTIONS: BrowserWindowConstructorOptions = { frame: false, transparent: true, hasShadow: false, focusable: false, show: false, skipTaskbar: true, resizable: false }

export type WindowOpenAnswer = { action: 'deny' } | { action: 'allow'; overrideBrowserWindowOptions: BrowserWindowConstructorOptions }

/**
 * Defense in depth: safe `_blank` URLs leave through the OS; no popup becomes a child window — but one: with
 * `filesPreview` (a Files window, YAZ-3357 D9), exactly `about:blank` in the frame `FILES_PREVIEW_FRAME`.
 */
export function createWindowOpenHandler(open: LinkOpener, filesPreview = false) {
  return ({ url, frameName }: { url: string; frameName?: string }): WindowOpenAnswer => {
    if (filesPreview && url === 'about:blank' && frameName === FILES_PREVIEW_FRAME) return { action: 'allow', overrideBrowserWindowOptions: FILES_PREVIEW_OPTIONS }
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
