import { stickyCap } from '@client/sidebar/stickyFolders'

/**
 * STICKY FOLDERS IN SEARCH'S TREE (YAZ-5506), the Mac sidebar's (YAZ-3440 D1, D2, D3; `client/src/sidebar/Tree.tsx`,
 * `stickyFolders.ts`, app.css): while the tree scrolls, each open folder whose rows pass under the top sticks there,
 * one row below the folder that holds it, the shallower on top, up to the cap (`sidebarStickyLevels`, 7 by default,
 * cut to the rows that fit in 40% of the list: the Mac's `stickyCap`); it leaves with its last row, pushed up by the
 * row after it. A stuck row has the side's colour and the thin line under it; its chevron is the open one.
 *
 * WHY NOT CSS ALONE, as on the Mac: the Mac nests a list in each open folder, so `position: sticky` on a folder row
 * ends with its own list. The phone's tree is ONE flat list (the drawn rows of `visibleRows`, `foundRows`,
 * `listRows`), so a sticky row would never leave. Nesting it would rewrite the three trees' markup; instead:
 *
 *  - The tree's SHAPE (each row's parent and the last row inside each folder) is worked out once per draw, O(rows).
 *  - Every row is one height (one line, `min-height: var(--tap)`), measured once per draw and per resize, with the
 *    list's place in the scroller. A scroll reads `scrollTop` alone (no box is measured), and once a frame at most
 *    works out the stack from the shape: O(levels × depth), whatever the number of rows.
 *  - The stack is a layer of copies of the stuck folder rows (`cloneNode`) in a zero-height `position: sticky` box at
 *    the top of the scroller. The DOM is written only when the stack changes (a folder sticks, leaves, or is pushed),
 *    never on a plain scroll; between changes the browser keeps the box in place, so it does not lag the finger.
 *
 * A tap on a stuck row scrolls back to its folder, the folder's row landing under the rows stuck above it, and nothing
 * folds (the Mac's D3, VS Code's rule); a tap on its chevron closes the folder, then scrolls it in.
 */

/** The tree's shape, from the drawn rows: depth, open folder, parent row, last row inside. */
export interface TreeShape {
  depth: Int32Array
  open: Uint8Array
  parent: Int32Array
  end: Int32Array
}

/** A stuck folder: its row's index in the list, its depth, and its top from the top of the scroller, px. */
export interface Stuck {
  index: number
  depth: number
  top: number
}

/** The shape of drawn rows (each row nests in the nearest row above it one level up). */
export function treeShape(rows: readonly { depth: number; open?: boolean }[]): TreeShape {
  const n = rows.length
  const shape: TreeShape = { depth: new Int32Array(n), open: new Uint8Array(n), parent: new Int32Array(n), end: new Int32Array(n) }
  const last: number[] = []
  const inside: number[] = []
  for (let i = 0; i < n; i++) {
    const d = rows[i].depth
    shape.depth[i] = d
    shape.open[i] = rows[i].open === true ? 1 : 0
    shape.parent[i] = d > 0 ? (last[d - 1] ?? -1) : -1
    last[d] = i
    last.length = d + 1
    while (inside.length > 0 && shape.depth[inside[inside.length - 1]] >= d) shape.end[inside.pop()!] = i - 1
    inside.push(i)
  }
  for (const i of inside) shape.end[i] = n - 1
  return shape
}

/**
 * The stuck folders with the list scrolled `y` px past the top (`y` ≤ 0: the list's top is in view, nothing sticks),
 * every row `h` px tall, at most `cap` levels. As nested sticky rows behave: at each level d the open folder that holds
 * the row at y + d·h sticks at d·h, or higher while its last row leaves (its li's end pushes it up); it counts while it
 * stands below its own place.
 */
export function stuckRows(shape: TreeShape, y: number, h: number, cap: number): Stuck[] {
  const out: Stuck[] = []
  const n = shape.depth.length
  if (!(y > 0) || !(h > 0)) return out
  for (let d = 0; d < cap; d++) {
    let f = Math.floor((y + d * h) / h)
    if (f >= n || shape.depth[f] < d) break
    while (f >= 0 && shape.depth[f] > d) f = shape.parent[f]
    if (f < 0 || shape.open[f] === 0) break
    const top = Math.min(d * h, shape.end[f] * h - y)
    if (f * h - y >= top) break
    out.push({ index: f, depth: d, top })
  }
  return out
}

const sameStack = (a: readonly Stuck[], b: readonly Stuck[]) => a.length === b.length && a.every((s, i) => s.index === b[i].index && s.top === b[i].top)

/**
 * Keeps the stack of `list` (the tree's `<ul>`, one `<li>` per row) in `layer` while `scroller` scrolls. `levels`:
 * the setting. Returns the cleanup.
 */
export function stickFolders(scroller: HTMLElement, list: HTMLElement, layer: HTMLElement, shape: TreeShape, levels: number): () => void {
  let h = 0
  let top = 0
  let cap = 0
  let shown: Stuck[] = []
  const copies = new Map<number, HTMLElement>()
  let frame = 0
  const measure = () => {
    h = list.firstElementChild?.getBoundingClientRect().height ?? 0
    top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop
    cap = stickyCap(levels, scroller.clientHeight, h)
  }
  const draw = () => {
    frame = 0
    const next = stuckRows(shape, scroller.scrollTop - top, h, cap)
    if (sameStack(next, shown)) return
    for (const [i, copy] of copies) {
      if (next.some((s) => s.index === i)) continue
      copy.remove()
      copies.delete(i)
    }
    for (const s of next) {
      let copy = copies.get(s.index)
      if (copy === undefined) {
        const row = list.children[s.index]?.firstElementChild
        if (!(row instanceof HTMLElement)) continue
        copy = row.cloneNode(true) as HTMLElement
        copy.classList.add('tree__row--stuck')
        copy.tabIndex = -1
        copy.removeAttribute('aria-label')
        copy.dataset.stuck = String(s.index)
        copy.style.zIndex = String(10 - s.depth)
        layer.append(copy)
        copies.set(s.index, copy)
      }
      copy.style.top = `${s.top}px`
    }
    shown = next
  }
  const onScroll = () => {
    if (frame === 0) frame = requestAnimationFrame(draw)
  }
  const relayout = () => {
    measure()
    draw()
  }
  const tap = (e: MouseEvent) => {
    const copy = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-stuck]') : null
    const s = copy === null ? undefined : shown.find((x) => String(x.index) === copy.dataset.stuck)
    if (s === undefined) return
    // The folder's row lands under the rows stuck above it (the Mac's `scroll-margin-top`).
    const back = () => (scroller.scrollTop = top + s.index * h - Math.min(s.depth, cap) * h)
    if (e.target instanceof Element && e.target.closest('.tree__chevron') !== null) {
      const row = list.children[s.index]?.firstElementChild
      if (row instanceof HTMLElement) row.click()
      requestAnimationFrame(back)
    } else back()
  }
  relayout()
  scroller.addEventListener('scroll', onScroll, { passive: true })
  layer.addEventListener('click', tap)
  const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(relayout)
  resized?.observe(scroller)
  if (list.parentElement !== null) resized?.observe(list.parentElement)
  return () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    scroller.removeEventListener('scroll', onScroll)
    layer.removeEventListener('click', tap)
    resized?.disconnect()
    layer.replaceChildren()
  }
}
