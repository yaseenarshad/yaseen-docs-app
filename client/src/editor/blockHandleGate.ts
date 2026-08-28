/**
 * Gutter gate for the 6-dot block handle (GRO-2081; GRO-2068 Q3 as refined by the GRO-2080
 * spike — Crepe's `blockHandle.shouldShow` is dead upstream config, so this is done at the
 * view layer). While the pointer sits in an affordance band — a guide-line strip (geometry
 * shared with guideLines.ts) or a fold chevron's box — the handle gets HANDLE_MUTED_CLASS
 * (CSS: pointer-events none + invisible), so line and chevron clicks land. Everywhere else
 * the handle stays visible and grabbable, and muting pauses while a drag is in progress.
 * elementsFromPoint keeps working through the muted handle: pointer-events: none removes it
 * from the stack, so the bands beneath stay detectable and the mute holds until the pointer
 * leaves them.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { FALLBACK_FONT_PX, LIST_INDENT_EM, STRIP_CENTRE_GAP, STRIP_HALF_WIDTH } from './outline/guideLines'
import { HEADING_TOGGLE_CLASS } from './outline/headingFolding'
import { OUTLINE_TOGGLE_CLASS } from './outline/outlineFolding'

export const HANDLE_MUTED_CLASS = 'mdapp-handle-muted'

/** Pure: is `x` inside the guide-line strip band of a list whose border-box left edge is `ulLeft`? */
export function inStripBand(x: number, ulLeft: number, fontPx: number): boolean {
  const centre = ulLeft - ((LIST_INDENT_EM * fontPx) / 2 + STRIP_CENTRE_GAP)
  return Math.abs(x - centre) <= STRIP_HALF_WIDTH
}

/** Whether the point sits on a chevron or a strip band, given the element stack under it. */
function overAffordance(view: EditorView, x: number, stack: readonly Element[]): boolean {
  for (const el of stack) {
    // Either fold chevron: the bullet one (outlineFolding.ts) or the heading one (YAZ-1140).
    if (el.classList.contains(OUTLINE_TOGGLE_CLASS) || el.classList.contains(HEADING_TOGGLE_CLASS)) return true
    if (
      (el.tagName === 'UL' || el.tagName === 'OL') &&
      view.dom.contains(el) &&
      el.parentElement?.classList.contains('content-dom')
    ) {
      const fontPx = Number.parseFloat(getComputedStyle(el).fontSize) || FALLBACK_FONT_PX
      if (inStripBand(x, el.getBoundingClientRect().left, fontPx)) return true
    }
  }
  return false
}

export const blockHandleGate = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-block-handle-gate'),
      view: (view) => {
        let frame = 0
        const onMove = (event: MouseEvent) => {
          if (frame !== 0) return
          frame = requestAnimationFrame(() => {
            frame = 0
            // Own editor only (YAZ-747): tabs keep hidden editors mounted, each with its own
            // handle appended into its view.dom.parentElement — a document-wide query muted
            // whichever handle came first in the DOM, possibly another tab's.
            const handle = view.dom.parentElement?.querySelector<HTMLElement>('.milkdown-block-handle')
            if (!handle) return
            if (view.dom.dataset.dragging === 'true') {
              handle.classList.remove(HANDLE_MUTED_CLASS)
              return
            }
            const stack = document.elementsFromPoint(event.clientX, event.clientY)
            handle.classList.toggle(HANDLE_MUTED_CLASS, overAffordance(view, event.clientX, stack))
          })
        }
        document.addEventListener('mousemove', onMove)
        return {
          destroy: () => {
            document.removeEventListener('mousemove', onMove)
            if (frame !== 0) cancelAnimationFrame(frame)
          },
        }
      },
    }),
)
