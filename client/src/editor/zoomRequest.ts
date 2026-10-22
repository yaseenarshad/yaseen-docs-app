import type { ZoomStep } from '@shared/types'
import { api } from '../api'

/**
 * ⌘+ / ⌘− / ⌘0 (YAZ-1710): the menu sends a step; the renderer decides where it lands. A
 * bubbling event leaves the focused element, and the note whose section contains the focus
 * claims it with `preventDefault` (see `Editor.tsx`). Nobody claimed it — focus is in the
 * sidebar, a dialog, or nowhere — so the whole app zooms, as the stock roles used to.
 */
export const ZOOM_EVENT = 'yaseendocs:zoom'

export function requestZoom(step: ZoomStep): void {
  const event = new CustomEvent<ZoomStep>(ZOOM_EVENT, { detail: step, bubbles: true, cancelable: true })
  ;(readOnlyCaretHolder() ?? document.activeElement ?? document.body).dispatchEvent(event)
  if (!event.defaultPrevented) void api.window.zoom(step)
}

/**
 * A read-only note's body takes no focus (YAZ-3125, D8), so after a click in it the focus is
 * `<body>`, and the note would never hear its own ⌘+. With the focus nowhere, the element that holds
 * the reader's caret in a NOT editable editor stands in for the focus. An editable editor keeps the
 * old rule: a caret left behind there with the focus elsewhere claims nothing.
 */
function readOnlyCaretHolder(): Element | null {
  if (document.activeElement !== null && document.activeElement !== document.body) return null
  const node = document.getSelection()?.anchorNode ?? null
  const el = node === null ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return el?.closest('.ProseMirror[contenteditable="false"]') ?? null
}
