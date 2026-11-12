/**
 * The compact head of a narrow layer (YAZ-4956). A tiled layer (Tile › Three at the default width gives 348 px) or a
 * layer dragged narrow is narrower than its full head (about 500 px with the Read only chip). The head then folds:
 * the title (cut with "…") and × always show; ‹ n/m ›, the zoom pill, the fold-all button, the Read only chip, Edit /
 * Done, ↗ and the ID go into a "⋯" menu (the app's `ContextMenu`). A wide layer looks as before.
 *
 * The fold is decided from the head's measured width: ONE `ResizeObserver` per layer, on the title. The title is the
 * one part of the head that grows and shrinks (`flex: 1`), so a resize of the layer AND a change of what the head holds
 * (the chip, "Editing · 0:58", the ID) both change its width. The observer writes `data-compact` on the head (CSS does
 * the rest) and only when the fold changes, in the next frame: a drag of the layer renders nothing in React.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '../sidebar/ContextMenu'
import type { MenuSection } from '../sidebar/menuSections'

/** The least room the title keeps in a full head; below it the head folds. */
export const TITLE_ROOM = 96

/** Folds the head when the title would get less than `TITLE_ROOM`; unfolds when the head has room for all of it again. */
export function useCompactHead(headRef: RefObject<HTMLElement | null>, titleRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const head = headRef.current
    const title = titleRef.current
    if (head === null || title === null || typeof ResizeObserver === 'undefined') return
    /** The width the full head needs: measured while it is full, kept while it is folded (the folded parts are not laid out). */
    let need = 0
    const measure = () => {
      // No layout yet (a hidden window, jsdom): nothing to decide.
      if (head.clientWidth === 0) return
      const compact = head.hasAttribute('data-compact')
      if (!compact) need = head.scrollWidth - title.offsetWidth + TITLE_ROOM
      const next = head.clientWidth < need
      if (next !== compact) head.toggleAttribute('data-compact', next)
    }
    // Before the first paint: a narrow layer never shows its full head for a frame.
    measure()
    // A fold changes the title's width again; written in the observer it would loop, so it waits for the next frame.
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0
          measure()
        })
    })
    observer.observe(title)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [headRef, titleRef])
}

/**
 * The "⋯" of a folded head, and its menu. CSS shows the button only while the head is folded. The menu is built when it
 * opens (`sections`) and drawn in the stack's root, over every layer; Esc closes the menu only, not the layer.
 */
export function HeadMore({ sections }: { sections: () => MenuSection[] }) {
  const [at, setAt] = useState<{ x: number; y: number; host: Element } | null>(null)
  useEffect(() => {
    if (at === null) return
    // Ahead of the stack's own Esc (which closes the layer): the open menu takes this one.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setAt(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [at])
  return (
    <>
      <button
        type="button"
        className="explore__button explore__more"
        aria-label="More actions"
        title="More: ‹ ›, zoom, Edit, open in a tab"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        // The keyboard stays where it is (the reading body, the editor, the board), as with the head's other buttons.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          if (at !== null) return setAt(null)
          const box = e.currentTarget.getBoundingClientRect()
          setAt({ x: box.left, y: box.bottom + 4, host: e.currentTarget.closest('.explore') ?? document.body })
        }}
      >
        ⋯
      </button>
      {at !== null &&
        createPortal(
          // The menu is drawn in the stack's root, but React passes its events up through the head: a press, a double
          // click or a right-click in it is not the head's drag, reset or note menu.
          <span style={{ display: 'contents' }} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            <ContextMenu x={at.x} y={at.y} sections={sections()} onClose={() => setAt(null)} />
          </span>,
          at.host,
        )}
    </>
  )
}
