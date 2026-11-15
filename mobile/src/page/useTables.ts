import { useEffect, type RefObject } from 'react'
import { layoutTables } from './tableLayout'

/**
 * The tables of an open page or card (YAZ-5471), for as long as it shows:
 *  - a table wider than its box is marked `data-wide` (its ⤢ shows), measured when it comes, when the screen changes
 *    size (the phone turns) and when its box does;
 *  - its frame says which side has more to see (`data-more-left`, `data-more-right`): the soft shadows;
 *  - a tap on ⤢ opens the table full screen (`tableView.ts`, a chunk of its own, loaded on the first tap);
 *  - a table that comes later (an embedded card, filled after the page) gets its widths and frame (`layoutTables`).
 * The full-screen view closes with the page.
 */
export interface TableWatch {
  /** Measures every table again. */
  measure(): void
  stop(): void
}

/** Marks one table's box: wide or not, and the sides with more. */
export function markTable(box: HTMLElement): void {
  const scroll = box.querySelector<HTMLElement>('.page-table')
  const frame = box.querySelector<HTMLElement>('.page-table-frame')
  if (scroll === null || frame === null) return
  const over = scroll.scrollWidth - scroll.clientWidth
  const wide = over > 1
  box.toggleAttribute('data-wide', wide)
  frame.toggleAttribute('data-more-left', wide && scroll.scrollLeft > 1)
  frame.toggleAttribute('data-more-right', wide && scroll.scrollLeft < over - 1)
}

type Load = () => Promise<{ showTable(box: HTMLElement, back?: HTMLElement | null): { close(): void } }>

export function watchTables(host: HTMLElement, load: Load = () => import('./tableView')): TableWatch {
  const boxes = () => host.querySelectorAll<HTMLElement>('.page-table-box')
  const measure = () => boxes().forEach(markTable)
  let view: { close(): void } | null = null
  let stopped = false

  const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
  const seen = new WeakSet<Element>()
  const take = () => {
    // A table that came without its frame (a card filled in later).
    if (host.querySelector('table:not([data-cols]):not([data-sized])') !== null) layoutTables(host)
    for (const box of boxes()) {
      if (seen.has(box)) continue
      seen.add(box)
      sizes?.observe(box)
      markTable(box)
    }
  }
  take()
  const added = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => take())
  added?.observe(host, { childList: true, subtree: true })

  // Scroll does not bubble: heard on the way down.
  const scrolled = (e: Event) => {
    const box = (e.target as Element | null)?.closest?.('.page-table-box')
    if (box instanceof HTMLElement && (e.target as Element).classList.contains('page-table')) markTable(box)
  }
  host.addEventListener('scroll', scrolled, { capture: true, passive: true })
  window.addEventListener('resize', measure)

  const tapped = (e: MouseEvent) => {
    const button = (e.target as Element | null)?.closest?.('[data-table-open]')
    const box = button?.closest('.page-table-box')
    if (!(box instanceof HTMLElement)) return
    // The page's own tap (links) never sees it.
    e.stopPropagation()
    e.preventDefault()
    void load().then((m) => {
      if (stopped || !box.isConnected) return
      view = m.showTable(box, button as HTMLElement)
    })
  }
  host.addEventListener('click', tapped)

  return {
    measure,
    stop() {
      stopped = true
      sizes?.disconnect()
      added?.disconnect()
      host.removeEventListener('scroll', scrolled, { capture: true })
      window.removeEventListener('resize', measure)
      host.removeEventListener('click', tapped)
      view?.close()
    },
  }
}

/** `watchTables` on a page's or a card's element, while it shows. */
export function useTables(host: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = host.current
    if (el === null) return
    const watch = watchTables(el)
    return () => watch.stop()
  }, [host])
}
