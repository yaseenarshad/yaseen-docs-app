import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * A card's place folds from the START (YAZ-5713, Yaseen: the page name was lost, "NEW CARDS TEST / HISTORY / …"): when
 * the whole path does not fit, its first parts give way to one "…", the fewest that make the rest fit, one at a time from
 * the left: "… / HISTORY / History cards". The last part (the page) always shows; alone too long, it cuts with "…" (CSS).
 * ONE rule for every card breadcrumb: the phone's Review crumb and the Mac Inbox's top row (`CardInboxBar`).
 *
 * `widths`: each part's natural width, its own separator included; `room`: the width the breadcrumb has; `more`: the
 * "…" part's width with its separator; `gap`: the box's gap between its children. The answer: how many parts fold.
 */
export function foldedParts(widths: readonly number[], room: number, more: number, gap = 0): number {
  const n = widths.length
  const fits = (k: number) => {
    const shown = widths.slice(k)
    const items = shown.length + (k > 0 ? 1 : 0)
    return shown.reduce((s, w) => s + w, 0) + (k > 0 ? more : 0) + gap * (items - 1) <= room + 0.5
  }
  for (let k = 0; k < n - 1; k++) if (fits(k)) return k
  return Math.max(0, n - 1)
}

/**
 * The fold, measured: `box` holds each part as a child marked `data-fold` (folded ones drawn with `display: none`) and
 * the "…" marked `data-fold-more` (drawn only while something folds). The box must take its room, not its content's
 * width (`flex: 1 1 0; min-width: 0`), so its width is the room. Measured before paint, again when the box resizes.
 * `key` names the path: a new path measures afresh.
 */
export function usePlaceFold(box: RefObject<HTMLElement | null>, key: string): number {
  const [folded, setFolded] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    const measure = () => {
      const parts = [...el.querySelectorAll<HTMLElement>(':scope > [data-fold]')]
      const more = el.querySelector<HTMLElement>(':scope > [data-fold-more]')
      const all = more === null ? parts : [...parts, more]
      // Every part drawn at its natural width for the read, then as React drew it, before the screen paints.
      const saved = all.map((e) => e.style.cssText)
      for (const e of all) {
        e.style.removeProperty('display')
        e.style.flex = 'none'
      }
      const width = (e: HTMLElement) => e.getBoundingClientRect().width
      const css = getComputedStyle(el)
      const room = el.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0)
      const next = foldedParts(parts.map(width), room, more === null ? 0 : width(more), parseFloat(css.columnGap) || 0)
      all.forEach((e, i) => (e.style.cssText = saved[i]))
      setFolded(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [box, key])
  return folded
}

/** How a part draws: hidden while folded. */
export const foldStyle = (i: number, folded: number) => (i < folded ? { display: 'none' } : undefined)
