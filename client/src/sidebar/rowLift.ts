import { dropIndex } from '../lib/dragSlot'
import { edgeScroller, type EdgeScroller } from '../lib/edgeScroll'
import { EASING, GLIDE_MS, motionOff, PART_MS, partGap, partShift } from '../lib/liveGap'
import type { ReorderOver } from './Tree'
import './rowLift.css'

/**
 * THE SIDEBAR'S SMOOTH ROW DRAG (YAZ-5916 Q1): one gesture for a Manual drag in Files (inside one folder), Focus and
 * Favorites, modeled on the tab bar's live gap (`lib/liveGap.ts`, YAZ-3808) and the board's FLIP (`views/view/flip.ts`).
 * The dragged row LIFTS (its `li`, an open folder with all it holds) and follows the pointer; the other rows of its own
 * list slide aside to open a gap where it will land; the drop settles it into the gap and waits for the new order, so
 * nothing jumps. Esc puts it back. It is mouse events, as the reorder was since YAZ-3467 D2: the page's HTML5 drag
 * stays the move's (the OS drag, YAZ-3254 D4).
 *
 * Measured once, at the lift, in CLIENT px (`getBoundingClientRect`): the sidebar's zoom (`.sidebar__body`'s CSS
 * zoom, YAZ-3389) makes the pointer and the boxes agree in client px, and a transform is written in the list's own
 * px, so each one is divided by the zoom. A scroll moves the list's box: its top is read again at each move, so the
 * slot and the lifted row follow the scroll. Only transforms are written while the drag is held; under reduced motion
 * nothing slides (`liveGap.motionOff`).
 */

/** How far the pointer moves before a row lifts (YAZ-3467 D1, YAZ-5916 Q2): one value for Files, Focus and Favorites. */
export const LIFT_PX = 10

/**
 * A press becomes a reorder drag (Q2): LIFT_PX or more from the press, and mostly up or down. Under LIFT_PX it is a
 * click; a sideways wobble does not lift it.
 */
export const liftsAt = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= LIFT_PX && Math.abs(dy) >= Math.abs(dx)

/** The slot (0…n) at a client y: before the first item whose middle is below it. `tops`/`heights`: each item's box at the lift. */
export function slotFor(y: number, tops: readonly number[], heights: readonly number[]): number {
  for (let i = 0; i < tops.length; i++) if (y < tops[i] + heights[i] / 2) return i
  return tops.length
}

/** The move a slot means, as the reorder's drop reads it: before the item AT the slot, or after the last one; null for no move. */
export function overFor(slot: number | null, from: number, paths: readonly string[]): ReorderOver | null {
  if (slot === null || slot === from || slot === from + 1) return null
  return slot < paths.length ? { path: paths[slot], edge: 'before' } : { path: paths[paths.length - 1], edge: 'after' }
}

/** The items' order after a drop of the item at `from` at `slot`; the same order for no move. */
export function movedOrder<T>(items: readonly T[], from: number, slot: number | null): T[] {
  if (slot === null || partGap(slot, from) === null) return [...items]
  const without = items.filter((_, i) => i !== from)
  const to = dropIndex(from, slot)
  return [...without.slice(0, to), items[from], ...without.slice(to)]
}

/** Where the lifted item stands once it settles into the gap at `slot`, from its own top, in client px. */
export function settleOffset(slot: number, from: number, tops: readonly number[], heights: readonly number[], room: number): number {
  if (partGap(slot, from) === null) return 0
  if (slot < from) return tops[slot] - tops[from]
  return tops[slot - 1] + heights[slot - 1] - room - tops[from]
}

/** The item `li`s of a tree level: the rows on disk and the shortcut rows, not a create or rename box. */
const itemsOf = (list: HTMLElement): HTMLElement[] => [...list.querySelectorAll<HTMLElement>(':scope > li')].filter((li) => li.querySelector(':scope > .tree__row[data-path]') !== null)
/** A level's items as the drop reads them: each path, and whether it is a shortcut row (no item of the folder's order). */
export function levelItems(list: HTMLElement): { paths: string[]; fixed: boolean[] } {
  const items = itemsOf(list)
  return { paths: items.map(pathOf), fixed: items.map((el) => el.querySelector(':scope > .tree__row[data-shortcut]') !== null) }
}
/**
 * The y move of a computed `transform`, in the element's own px: a matrix's (Chromium's computed value, a transition's
 * value at this moment) or a translateY's (as written; jsdom computes none); 0 for none.
 */
export function translateYOf(transform: string): number {
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim())
  if (m !== null) {
    const v = m[2].split(',').map(Number)
    const y = m[1] === undefined ? v[5] : v[13]
    return Number.isFinite(y) ? y : 0
  }
  const t = /translateY\((-?[\d.]+(?:e-?\d+)?)px\)/.exec(transform)
  return t === null ? 0 : Number(t[1])
}
const pathOf = (li: HTMLElement): string => li.querySelector<HTMLElement>(':scope > .tree__row[data-path]')?.dataset.path ?? ''
/** The zoom the list is drawn at: Chromium's `currentCSSZoom` (the product of every zoom above it); 1 elsewhere. */
const zoomOf = (el: HTMLElement): number => {
  const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
  return typeof z === 'number' && z > 0 ? z : 1
}
const scrollerOf = (el: HTMLElement): HTMLElement | null => el.closest<HTMLElement>('.sidebar__body')

export interface RowLift {
  /** The paths of the list's items, in the order drawn at the lift; `from` is the lifted one's index. */
  paths: readonly string[]
  /** Each item is a shortcut row (YAZ-2290): it parts like any row, but it is no item of the folder's order. */
  fixed: readonly boolean[]
  from: number
  /** The list (`ul.tree`) the row lifted from. */
  list: HTMLElement
  /** The pointer is at client `x`, `y`: the row follows, and the gap opens at its slot unless `away` (the gap closes, the row goes home). */
  move: (x: number, y: number, away: boolean) => void
  /** The slot the gap is open at now; null when closed. */
  slot: () => number | null
  /** The drop: the row settles into the gap, then the list waits for its new order (or `LANDING_MS`); `done` runs once it is still. */
  settle: (done?: () => void) => void
  /** Esc, a release with no move: everything slides home. */
  cancel: () => void
}

/** What a drop keeps of its list before the new order (`settle`), for the glide (`clear`). */
interface Dropped {
  drawn: Map<string, number>
  base: Map<string, number>
  listTop: number
  painted: boolean
}

/** How long a drop waits for its new order before the parting ends anyway (`useLiveGapReorder`'s LANDING_MS). */
const LANDING_MS = 1000

/** The row's lift, from the row button `row` pressed at client y `pressY`; null when the row is in no list. */
export function liftRow(row: HTMLElement, pressY: number): RowLift | null {
  const li = row.closest<HTMLElement>('li')
  const list = li?.parentElement ?? null
  if (li === null || list === null || !list.matches('ul.tree')) return null
  const items = itemsOf(list)
  const from = items.indexOf(li)
  if (from < 0) return null
  const paths = items.map(pathOf)
  const listTop0 = list.getBoundingClientRect().top
  const boxes = items.map((el) => el.getBoundingClientRect())
  const tops = boxes.map((b) => b.top)
  const heights = boxes.map((b) => b.height)
  // No layout (jsdom, a list not drawn yet): no lift; the gesture keeps the row under the pointer as its target.
  if (heights.every((h) => h === 0)) return null
  const room = from < items.length - 1 ? tops[from + 1] - tops[from] : heights[from]
  const zoom = zoomOf(list)
  const still = motionOff()
  const scroller = scrollerOf(list)
  let slot: number | null = null
  let last: { x: number; y: number; away: boolean } | null = null
  let ended = false
  // The ends of the sidebar scroll while the drag is held there (the tab bar's YAZ-3808 D5), and the row follows.
  const edge: EdgeScroller = edgeScroller(() => scroller, () => last !== null && draw(last.x, last.y, last.away), 'y')

  list.setAttribute('data-lift-list', '')
  if (still) list.setAttribute('data-lift-still', '')
  li.setAttribute('data-lifted', '')
  const put = (el: HTMLElement, px: number) => {
    el.style.transform = Math.abs(px) < 0.5 ? '' : `translateY(${px / zoom}px)`
  }
  const draw = (x: number, y: number, away: boolean) => {
    last = { x, y, away }
    // The scroll since the lift, in client px: the list's box moved by it.
    const scrolled = list.getBoundingClientRect().top - listTop0
    slot = away ? null : slotFor(y - scrolled, tops, heights)
    const gap = slot === null ? null : partGap(slot, from)
    items.forEach((el, i) => {
      if (i !== from) put(el, partShift(i, from, gap, room))
    })
    put(li, away ? 0 : y - pressY - scrolled)
  }
  /**
   * The lift's marks and transforms off; each item glides from where it was drawn to its place in the new layout.
   * `drop`: what the drop kept of each item, by path, before the new order (`settle`): its top as drawn then, its own
   * box (its transform aside), the list's top, and whether a frame has been drawn since. Where an item stands drawn is
   * read from these, not from the new layout, which React may already have put under the old transforms (bug YAZ-5971:
   * every parted row jumped by the gap and glided back). No frame since the drop: each item is where it was drawn at
   * the drop. A frame since (a later commit): its own box plus the transform it is drawn with now (a CSS transition's
   * value at this moment). Without `drop` (no new order: a cancel, a no-move drop, LANDING_MS gone by) the layout is
   * the old one, and the drawn boxes are measured again.
   */
  const clear = (drop?: Dropped) => {
    edge.stop()
    list.removeAttribute('data-lift-list')
    list.removeAttribute('data-lift-still')
    li.removeAttribute('data-lifted')
    li.removeAttribute('data-settling')
    const now = itemsOf(list)
    const shift = drop === undefined ? 0 : list.getBoundingClientRect().top - drop.listTop
    const drawnTop = (el: HTMLElement): number => {
      const path = pathOf(el)
      const at = drop?.painted === false ? drop.drawn.get(path) : undefined
      if (at !== undefined) return at + shift
      const base = drop?.base.get(path)
      return base === undefined ? el.getBoundingClientRect().top : base + shift + translateYOf(getComputedStyle(el).transform) * zoom
    }
    const before = new Map(now.map((el) => [pathOf(el), drawnTop(el)]))
    for (const el of [...items, ...now]) {
      el.style.transition = 'none'
      el.style.transform = ''
    }
    // FLIP (flip.ts): an item that the new layout puts elsewhere than it was drawn glides from there; one that stands
    // where it was drawn (the settled drop's whole point) does not move.
    for (const el of now) {
      const from0 = before.get(pathOf(el))
      const d = from0 === undefined ? 0 : from0 - el.getBoundingClientRect().top
      el.style.transition = ''
      if (!still && Math.abs(d) >= 1) el.animate?.([{ transform: `translateY(${d / zoom}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing: EASING })
    }
  }
  return {
    paths,
    fixed: items.map((el) => el.querySelector(':scope > .tree__row[data-shortcut]') !== null),
    from,
    list,
    move: (x, y, away) => {
      if (ended) return
      edge.at(y)
      draw(x, y, away)
    },
    slot: () => slot,
    settle: (done) => {
      if (ended) return
      ended = true
      edge.stop()
      const at = slot
      if (at === null || partGap(at, from) === null) {
        // No move: everything slides home, with the CSS transition of the parted items.
        li.removeAttribute('data-lifted')
        items.forEach((el) => put(el, 0))
        setTimeout(() => {
          clear()
          done?.()
        }, still ? 0 : PART_MS)
        return
      }
      // The row settles into the gap, then the list waits for its new order. The drop's save is optimistic, so React
      // often moves the `li`s in this very task, UNDER the transforms still on: the new layout plus the old transform is
      // not where an item was drawn (YAZ-5971), and a moved `li` loses the settle's transition. So where each item is
      // drawn, and its own box, are kept here, before the save: the new order's glide starts from there. The parted rows
      // do not move again, and the dropped row glides from the drop point into its place.
      const drop: Dropped = { drawn: new Map(), base: new Map(), listTop: list.getBoundingClientRect().top, painted: false }
      for (const el of items) {
        const top = el.getBoundingClientRect().top
        drop.drawn.set(pathOf(el), top)
        drop.base.set(pathOf(el), top - translateYOf(getComputedStyle(el).transform) * zoom)
      }
      requestAnimationFrame(() => {
        drop.painted = true
      })
      li.setAttribute('data-settling', '')
      if (!still) li.style.transition = `transform ${PART_MS}ms ${EASING}`
      put(li, settleOffset(at, from, tops, heights, room))
      let timer: ReturnType<typeof setTimeout> | null = null
      const observer = new MutationObserver(() => finish(true))
      const finish = (reordered: boolean) => {
        observer.disconnect()
        if (timer !== null) clearTimeout(timer)
        // LANDING_MS with no new order: the layout is the old one, so the drawn boxes are measured again.
        clear(reordered ? drop : undefined)
        done?.()
      }
      observer.observe(list, { childList: true })
      timer = setTimeout(() => finish(false), LANDING_MS)
    },
    cancel: () => {
      if (ended) return
      ended = true
      li.removeAttribute('data-lifted')
      items.forEach((el) => put(el, 0))
      setTimeout(clear, still ? 0 : PART_MS)
    },
  }
}

/** The small hint under the pointer while a Files row drags by hand (D2): how to move into a folder, or which folder takes it. */
export function liftHint(): { show: (x: number, y: number, text: string) => void; remove: () => void } {
  let el: HTMLDivElement | null = null
  return {
    show: (x, y, text) => {
      if (el === null) {
        el = document.createElement('div')
        el.className = 'tree__lift-hint'
        el.setAttribute('role', 'status')
        document.body.append(el)
      }
      if (el.textContent !== text) el.textContent = text
      el.style.transform = `translate(${x + 14}px, ${y + 14}px)`
    },
    remove: () => {
      el?.remove()
      el = null
    },
  }
}

/** The hint's words (D2). */
export const HOLD_HINT = 'Hold ⌘ to move into a folder'
export const intoHint = (name: string): string => `Move into “${name}”`
