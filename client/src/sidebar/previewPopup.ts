/**
 * A FILES WINDOW'S FLOATING PREVIEW (YAZ-3357 D9). A Files window is only the sidebar, so there is no room beside it
 * for the hover preview. Instead it opens ONE popup — `window.open('about:blank', FILES_PREVIEW_FRAME)`, the one popup
 * main allows, from a Files window only (`windowOpenPolicy.ts`) — with no frame, a clear background, no focus and no
 * mouse. The window's own React tree draws the usual panel (`NotePreview` / `BoardPreview`) into it with a portal, so
 * there is no second vault index and no second app; main places the popup beside the Files window, on the hovered
 * row's height, and shows it inactive (`window:files-preview`). It is made once and kept: hidden between previews.
 *
 * The popup's page is a bare `about:blank` of this page's origin, so it gets this page's look by copy: each stylesheet
 * once (a lazy chunk adds its own later, so each show looks again), the `<html>` theme attributes, and the `.app`
 * settings variables on the panel's root. Where the popup cannot be made, `filesPreviewPopup.open()` says so and the
 * Files window falls back to the panel over its own lower part (`overlayPlacement`).
 */
import { FILES_PREVIEW_FRAME, type FilesPreviewRequest } from '@shared/types'
import { api } from '../api'
import type { PreviewPopup } from './previewPlacement'

let popup: Window | null = null
let root: HTMLElement | null = null
/** The stylesheets of this page already copied into the popup's page. */
let copied = new WeakSet<Node>()
/** A hide waits one turn: the panel of the next row mounts in the same commit and shows again, with no flicker. */
let hideTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The popup's root element, made the first time; null when no popup can be made. The popup outlives a reload of the
 * Files window, and the new page's `window.open` loads a fresh `about:blank` in it: the root is made again whenever the
 * popup's page is another one, and a root an earlier page left there goes.
 */
function open(): HTMLElement | null {
  if (popup === null || popup.closed) {
    let made: Window | null | undefined = null
    try {
      made = window.open('about:blank', FILES_PREVIEW_FRAME)
    } catch {
      made = null
    }
    // Denied (or a page with no `window.open` at all): the caller falls back to the overlay.
    if (made === null || made === undefined) return null
    popup = made
  }
  const doc = popup.document
  if (root !== null && root.ownerDocument === doc && root.isConnected) return root
  doc.title = 'Preview'
  copied = new WeakSet()
  for (const stale of doc.querySelectorAll('.files-preview-root')) stale.remove()
  root = doc.createElement('div')
  root.className = 'files-preview-root'
  doc.body.appendChild(root)
  return root
}

/** The popup's page takes this page's look as it is now (see the module doc). Cheap: a stylesheet is copied once. */
function syncLook(): void {
  if (popup === null || root === null) return
  const doc = popup.document
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (copied.has(node)) continue
    copied.add(node)
    const clone = doc.importNode(node, true)
    if (clone instanceof HTMLLinkElement && node instanceof HTMLLinkElement) clone.href = node.href
    doc.head.appendChild(clone)
  }
  const html = doc.documentElement
  for (const name of ['data-theme', 'style', 'class']) {
    const value = document.documentElement.getAttribute(name)
    if (value === null) html.removeAttribute(name)
    else html.setAttribute(name, value)
  }
  // The page is clear: only the panel shows, over whatever is behind the popup.
  for (const el of [html, doc.body]) {
    el.style.setProperty('background', 'transparent', 'important')
    el.style.setProperty('margin', '0')
    el.style.setProperty('overflow', 'hidden')
  }
  // The settings variables (line height, block gap…) live on `.app`; a note's panel reads some of them.
  const app = document.querySelector('.app')
  for (const attr of [...root.attributes]) if (attr.name !== 'class') root.removeAttribute(attr.name)
  for (const attr of app === null ? [] : [...app.attributes]) if (attr.name === 'style' || attr.name.startsWith('data-')) root.setAttribute(attr.name, attr.value)
}

const send = (req: FilesPreviewRequest | null): void => {
  api.window.filesPreview(req).catch((err: unknown) => console.error('[files-preview] failed:', err))
}

export const filesPreviewPopup: PreviewPopup & { open(): boolean } = {
  /** Make the popup now, once (the Files window does it at its start); `false` = it cannot be made. */
  open: () => open() !== null,
  host: () => open(),
  show(req) {
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = null
    open()
    syncLook()
    send(req)
  },
  hide() {
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      hideTimer = null
      send(null)
    }, 0)
  },
}
