import type { ZoomStep } from '@shared/types'
import { readOnlySelectionHolder } from '../lib/readOnlyCaret'

/**
 * ⌘+ / ⌘− / ⌘0 (YAZ-1710): the menu sends a step; the renderer decides where it lands. A
 * bubbling event leaves the focused element, and the note whose section contains the focus
 * claims it with `preventDefault` (see `Editor.tsx`). Nobody claimed it — focus is in the
 * sidebar, a dialog, or nowhere — so `onUnclaimed` runs: the sidebar zoom (YAZ-3389; the window
 * itself never zooms any more).
 */
export const ZOOM_EVENT = 'yaseendocs:zoom'

export function requestZoom(step: ZoomStep, onUnclaimed: (step: ZoomStep) => void): void {
  const event = new CustomEvent<ZoomStep>(ZOOM_EVENT, { detail: step, bubbles: true, cancelable: true })
  ;(readOnlyCaretHolder() ?? document.activeElement ?? document.body).dispatchEvent(event)
  if (!event.defaultPrevented) onUnclaimed(step)
}

/**
 * A read-only note's body takes the focus (YAZ-3127, and YAZ-3130 for every `view.focus()`), so ⌘+
 * normally starts from inside the note. This covers the rest: the focus on `<body>` (a click on
 * the page margin, a closed dialog) with the reader's DOM caret still in a NOT editable, visible
 * editor — that element stands in for the focus. An editable editor keeps the old rule: a caret
 * left behind there with the focus elsewhere claims nothing.
 */
function readOnlyCaretHolder(): Element | null {
  if (document.activeElement !== null && document.activeElement !== document.body) return null
  // Only a VISIBLE one (YAZ-3128): a tab switch leaves the DOM selection in the hidden tab.
  return readOnlySelectionHolder()
}
