/**
 * The head of a narrow layer (YAZ-4956, YAZ-4986). A tiled layer (Tile › Three at the default width gives 348 px) or a
 * layer dragged narrow is narrower than its full head (about 500 px with the Read only chip). The head then folds its
 * parts ONE BY ONE, the least important first (`FOLD_ORDER`), until the title has `TITLE_ROOM` again: the zoom pill,
 * the fold-all button, ‹ n/m ›, ↗, the Read only chip's word (its lock stays), the chip, Edit / Done last. The title
 * (cut with "…"), the ID and × never fold (Yaseen: "esp i need to see the id please"); "⋯" shows once a part has folded
 * and holds every action of the head. A wide layer looks as before.
 *
 * Each part wears `data-fold-part`; a folded one wears `data-folded` (CSS hides it), and the head `data-compact` while
 * any part is folded (CSS shows ⋯). The fold is decided from measured widths: ONE `ResizeObserver` per layer, on the
 * title. The title is the one part of the head that grows and shrinks (`flex: 1`), so a resize of the layer AND a change
 * of what the head holds (the chip, "Editing · 0:58") both change its width. Each part's width is kept from the last
 * time it showed, so a fold or an unfold is one decision: the reads come first, then the writes (only of what changed),
 * in the next frame. A drag of the layer renders nothing in React.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '../sidebar/ContextMenu'
import type { MenuSection } from '../sidebar/menuSections'

/** The head's parts, the first to fold first (YAZ-4986). */
export const FOLD_ORDER = ['zoom', 'fold-all', 'steps', 'open', 'chip-word', 'chip', 'edit'] as const
type FoldPart = (typeof FOLD_ORDER)[number]

/** The least room the title keeps; below it the next part folds. */
export const TITLE_ROOM = 96

/** ⋯'s width before it has ever shown (a 28 px button). */
const MORE_GUESS = 28

/** The part's element in the head: the chip's word is the text in the chip's button. */
const partOf = (head: HTMLElement, part: FoldPart): HTMLElement | null =>
  part === 'chip-word' ? head.querySelector<HTMLElement>('[data-fold-part="chip"] .read-only-chip__button > span') : head.querySelector<HTMLElement>(`[data-fold-part="${part}"]`)

/** Folds the head's parts one by one as the title would get less than `TITLE_ROOM`; unfolds them as room comes back. */
export function useCompactHead(headRef: RefObject<HTMLElement | null>, titleRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const head = headRef.current
    const title = titleRef.current
    if (head === null || title === null || typeof ResizeObserver === 'undefined') return
    /** Each part's width with its gap, from the last time it showed. The chip's is without its word. */
    const width = new Map<FoldPart, number>()
    let moreWidth = 0
    const measure = () => {
      // No layout yet (a hidden window, jsdom): nothing to decide.
      if (head.clientWidth === 0) return
      // Reads.
      const gap = parseFloat(getComputedStyle(head).columnGap) || 0
      const els = FOLD_ORDER.map((part) => partOf(head, part))
      const shown = (el: HTMLElement | null) => el !== null && el.offsetWidth > 0
      const word = els[FOLD_ORDER.indexOf('chip-word')]
      const wordShown = shown(word) && !word!.hasAttribute('data-folded')
      const wordWidth = wordShown ? word!.offsetWidth + (parseFloat(getComputedStyle(word!.parentElement!).columnGap) || 0) : 0
      /** What the shown parts take now (the word is inside the chip's width). */
      let now = 0
      FOLD_ORDER.forEach((part, i) => {
        const el = els[i]
        if (part === 'chip-word') {
          if (wordShown) width.set(part, wordWidth)
          return
        }
        if (!shown(el)) return
        now += el!.offsetWidth + gap
        if (!el!.hasAttribute('data-folded')) width.set(part, el!.offsetWidth + gap - (part === 'chip' ? wordWidth : 0))
      })
      const more = head.querySelector<HTMLElement>('.explore__more')
      // A ⋯ that always shows (the card window) is part of the rest of the head; only a fold's ⋯ comes and goes.
      const moreAlways = more?.classList.contains('explore__more--always') === true
      if (more !== null && !moreAlways && more.offsetWidth > 0) {
        moreWidth = more.offsetWidth + gap
        now += moreWidth
      }
      /** The rest of the head (padding, the ID, ×, the gaps between them) and the title's least room. */
      const fixed = head.scrollWidth - title.offsetWidth - now + TITLE_ROOM
      const present = FOLD_ORDER.map((part, i) => els[i] !== null && (part !== 'chip-word' || word !== null))
      const need = (from: number) => {
        let sum = fixed
        let folded = false
        FOLD_ORDER.forEach((part, i) => {
          if (!present[i]) return
          if (i >= from) sum += width.get(part) ?? 0
          else folded = true
        })
        return sum + (folded && !moreAlways ? moreWidth || MORE_GUESS + gap : 0)
      }
      let from = 0
      while (from < FOLD_ORDER.length && need(from) > head.clientWidth) from++
      // Writes: only what changed.
      let any = false
      FOLD_ORDER.forEach((part, i) => {
        const el = els[i]
        if (el === null) return
        const fold = i < from
        any ||= fold
        if (el.hasAttribute('data-folded') !== fold) el.toggleAttribute('data-folded', fold)
      })
      if (head.hasAttribute('data-compact') !== any) head.toggleAttribute('data-compact', any)
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
 * The "⋯" of a folded head, and its menu. CSS shows the button only while the head is folded; `always` (the card
 * window, whose ⋯ has rows of its own: review, history, Copy card ID, YAZ-4964) shows it at every width. The menu is built when it
 * opens (`sections`) and drawn in the stack's root, over every layer; Esc closes the menu only, not the layer.
 */
export function HeadMore({ sections, always = false }: { sections: () => MenuSection[]; always?: boolean }) {
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
        className={`explore__button explore__more${always ? ' explore__more--always' : ''}`}
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
