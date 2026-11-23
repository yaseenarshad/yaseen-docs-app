import { FOLD_BUTTON, HIDDEN_ATTR } from './folds'
import { setLandingCover } from './headings'

/**
 * STICKY HEADINGS ON THE PHONE (YAZ-5591), phone only: while a page scrolls, the heading of the section being read sticks
 * at the top of the page, under the top bar, with the headings that hold it above it, the shallower on top. Search's
 * sticky folders' rules (`search/stickyFolders.ts`, the Mac sidebar's, VS Code's):
 *  - a heading sticks one slot below the heading that holds it, and leaves with its section, pushed up by the heading
 *    after it (the next heading of its level or higher);
 *  - the stack never covers more than 40% of the scroller (the Mac's `STICKY_MAX_SHARE`, `stickyCap`); a heading that
 *    would go past it does not stick, nor the ones under it;
 *  - a tap on a stuck heading scrolls back to it, landing it right under the headings stuck above it; a tap on its fold
 *    arrow folds it (the page's own arrow is clicked, `folds.ts`), then lands it the same way.
 *
 * A section is the Mac's (`folds.ts`, `markSections`): a heading that is a direct child of the page's body, up to the
 * next heading of the same or a higher level. Every level sticks (H1 to H6); a heading in a list or a card does not. The
 * page's own title (its first H1 when it says the page's title) does not: the top bar shows it. A folded-away heading has
 * no box and does not stick.
 *
 * WHY NOT `position: sticky` on the headings: the page is one flat run of blocks (no box per section), so a sticky
 * heading would never leave. As Search's tree: the stack is a layer of COPIES of the stuck headings in a zero-height
 * `position: sticky` box just before the page's body, so nothing in the page moves (no layout jump), and the copies
 * stand where the headings stand. The headings' boxes are measured once per change of the page (a slice drawn, a fold,
 * a picture that loaded, a resize: one `ResizeObserver` and one `MutationObserver`); a scroll reads `scrollTop` alone and
 * once a frame at most works the stack out (`stuckHeadings`, O(log n + depth)). The DOM is written only when the stack
 * changes. A copy has the heading's computed type (size, weight, line, colour, indent), so it draws as the heading.
 */

/** The most of the scroller's height the stuck headings may cover (the Mac's and VS Code's 40%). */
export const STICKY_MAX_SHARE = 0.4
/** Every heading level sticks. */
export const STICKY_LEVELS = 6

/** A heading of the page as measured: its box from the body's top, px; its level; the heading that holds it; its section's end. */
export interface HeadingBox {
  top: number
  height: number
  level: number
  /** The index of the heading whose section holds it; -1: none. */
  parent: number
  /** Where its section ends (the next heading of its level or higher, or the page's end), px from the body's top. */
  end: number
}

/** A stuck heading: its index, its depth in the stack, its top from the scroller's top (px), its own slot. */
export interface StuckHeading {
  index: number
  depth: number
  top: number
  /** Where it stands when nothing pushes it: the heights of the headings stuck above it. */
  slot: number
}

/** The shape of the page's headings, in page order (`top` rising): each one's parent and its section's end. */
export function headingShape(list: readonly { top: number; height: number; level: number }[], pageEnd: number): HeadingBox[] {
  const out: HeadingBox[] = []
  const open: number[] = []
  for (let i = 0; i < list.length; i++) {
    const { top, height, level } = list[i]!
    while (open.length > 0 && out[open[open.length - 1]!]!.level >= level) out[open.pop()!]!.end = top
    out.push({ top, height, level, parent: open.length > 0 ? open[open.length - 1]! : -1, end: pageEnd })
    open.push(i)
  }
  return out
}

/** The last heading whose top is above `line` (px from the body's top); -1: none. */
function lastAbove(shape: readonly HeadingBox[], line: number): number {
  let lo = 0
  let hi = shape.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (shape[mid]!.top < line) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/**
 * The stuck headings with the body's top `y` px above the scroller's top (`y` ≤ 0: the page's top is in view, none),
 * the stack at most `room` px tall, at most `levels` deep. As nested sticky headings behave: at each depth the heading
 * that holds the line under the stack so far sticks at its slot, or higher while its section's end comes up under it.
 */
export function stuckHeadings(shape: readonly HeadingBox[], y: number, room: number, levels: number = STICKY_LEVELS): StuckHeading[] {
  const out: StuckHeading[] = []
  if (!(y > 0) || shape.length === 0) return out
  let slot = 0
  let held = -1
  for (let d = 0; d < levels; d++) {
    // Within a pixel of the line counts as at it (a landing's rounded `scrollTop`): that heading is at its own place.
    let i = lastAbove(shape, y + slot - 1)
    while (i >= 0 && shape[i]!.parent !== held) i = shape[i]!.parent
    if (i < 0) break
    const h = shape[i]!
    if (slot + h.height > room) break
    const top = Math.min(slot, h.end - h.height - y)
    // Still at its own place in the page: not stuck. Pushed up all the way behind the headings above it: none to see.
    if (h.top - y >= top || top + h.height <= slot) break
    out.push({ index: i, depth: d, top, slot })
    held = i
    slot += h.height
  }
  return out
}

/** How much the stack covers above `index` when that heading is landed on: the heights of the headings that hold it. */
export function coverAbove(shape: readonly HeadingBox[], index: number, room: number): number {
  let sum = 0
  for (let p = shape[index]?.parent ?? -1; p >= 0; p = shape[p]!.parent) sum += shape[p]!.height
  return sum > room ? 0 : sum
}

const sameStack = (a: readonly StuckHeading[], b: readonly StuckHeading[]) => a.length === b.length && a.every((s, i) => s.index === b[i]!.index && s.top === b[i]!.top)

const levelOf = (el: Element): number | null => {
  const m = /^H([1-6])$/.exec(el.tagName)
  return m === null ? null : Number(m[1])
}

/** The type a copy takes from its heading, so it draws as the heading does (it stands outside the page's body). */
const COPIED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textDecoration', 'color', 'paddingTop', 'paddingBottom'] as const

export interface StickyOptions {
  /** The page's title: a first H1 with these words is the title, which does not stick. */
  title?: string
}

/**
 * Keeps the stuck headings of `body` (the drawn page) in `layer` (a zero-height sticky box just before it) while
 * `scroller` scrolls. Returns the cleanup.
 */
export function stickHeadings(scroller: HTMLElement, body: HTMLElement, layer: HTMLElement, options: StickyOptions = {}): () => void {
  let headings: HTMLElement[] = []
  let shape: HeadingBox[] = []
  let bodyTop = 0
  let bodyLeft = 0
  let room = 0
  let shown: StuckHeading[] = []
  const copies = new Map<HTMLElement, HTMLElement>()
  let frame = 0
  let gone = false

  const isTitle = (el: Element) =>
    el === body.firstElementChild && el.tagName === 'H1' && options.title !== undefined && (el.textContent ?? '').trim().toLowerCase() === options.title.trim().toLowerCase()

  const clearCopies = () => {
    for (const copy of copies.values()) copy.remove()
    copies.clear()
    shown = []
  }

  const measure = () => {
    const sr = scroller.getBoundingClientRect()
    const br = body.getBoundingClientRect()
    bodyTop = br.top - sr.top - scroller.clientTop + scroller.scrollTop
    bodyLeft = br.left
    room = STICKY_MAX_SHARE * scroller.clientHeight
    headings = []
    const list: { top: number; height: number; level: number }[] = []
    for (const el of body.children) {
      const level = levelOf(el)
      if (level === null || !(el instanceof HTMLElement) || el.hasAttribute(HIDDEN_ATTR) || isTitle(el)) continue
      const r = el.getBoundingClientRect()
      if (!(r.height > 0)) continue
      headings.push(el)
      list.push({ top: r.top - br.top, height: r.height, level })
    }
    shape = headingShape(list, br.height)
  }

  const makeCopy = (el: HTMLElement): HTMLElement => {
    const row = document.createElement('div')
    row.className = 'reader__stuck-row'
    const copy = el.cloneNode(true) as HTMLElement
    for (const withId of [copy, ...copy.querySelectorAll('[id]')]) withId.removeAttribute('id')
    copy.removeAttribute('data-sd')
    for (const b of copy.querySelectorAll<HTMLButtonElement>(`.${FOLD_BUTTON}`)) b.tabIndex = -1
    for (const a of copy.querySelectorAll<HTMLElement>('a, button:not(.fold-btn)')) a.tabIndex = -1
    const cs = getComputedStyle(el)
    for (const key of COPIED) copy.style[key] = cs[key]
    copy.style.margin = '0'
    // The heading's place across the page: its indent (Section indent's step is its left border) and its width.
    const r = el.getBoundingClientRect()
    const inset = r.left - bodyLeft + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0)
    copy.style.paddingLeft = '0'
    copy.style.border = '0'
    row.style.paddingLeft = `calc(var(--stuck-gutter) + ${Math.max(0, inset)}px)`
    row.style.height = `${r.height}px`
    row.append(copy)
    return row
  }

  const draw = () => {
    frame = 0
    if (gone) return
    const next = stuckHeadings(shape, scroller.scrollTop - bodyTop, room)
    if (sameStack(next, shown)) return
    const keep = new Set(next.map((s) => headings[s.index]!))
    for (const [el, copy] of copies) {
      if (keep.has(el)) continue
      copy.remove()
      copies.delete(el)
    }
    for (const s of next) {
      const el = headings[s.index]!
      let copy = copies.get(el)
      if (copy === undefined) {
        copy = makeCopy(el)
        copy.dataset.stuck = String(s.index)
        layer.append(copy)
        copies.set(el, copy)
      }
      copy.dataset.stuck = String(s.index)
      copy.style.zIndex = String(10 - s.depth)
      copy.style.top = `${s.top}px`
    }
    shown = next
  }

  const relayout = () => {
    if (gone) return
    measure()
    // The copies are made again from the page as it is now (a fold's arrow turned, a heading drawn again).
    clearCopies()
    draw()
  }
  let relayoutFrame = 0
  const soon = () => {
    // Pause per-slice measurement/relayout while PageView appends progressive slices; one relayout runs when slicing ends (YAZ-6028).
    if (body.dataset.slicing === 'true') return
    if (relayoutFrame === 0)
      relayoutFrame = requestAnimationFrame(() => {
        relayoutFrame = 0
        relayout()
      })
  }

  const onScroll = () => {
    if (frame === 0) frame = requestAnimationFrame(draw)
  }

  /** Lands heading `index` right under the headings that hold it (they stay stuck above it). */
  const landAt = (index: number) => {
    measure()
    const h = shape[index]
    if (h === undefined) return
    scroller.scrollTop = bodyTop + h.top - coverAbove(shape, index, room)
  }

  const tap = (e: MouseEvent) => {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-stuck]') : null
    const s = row === null ? undefined : shown.find((x) => String(x.index) === row.dataset.stuck)
    if (s === undefined) return
    e.preventDefault()
    e.stopPropagation()
    const el = headings[s.index]
    if (el === undefined) return
    if (e.target instanceof Element && e.target.closest(`.${FOLD_BUTTON}`) !== null) {
      // The page's own arrow: the page's folds take the tap (`folds.ts`), then the heading lands under its parents.
      el.querySelector<HTMLButtonElement>(`:scope > .${FOLD_BUTTON}`)?.click()
      requestAnimationFrame(() => {
        if (gone) return
        const at = headings.indexOf(el)
        landAt(at >= 0 ? at : s.index)
        relayout()
      })
    } else landAt(s.index)
  }

  // A landing on a heading of this page (the Headings list, a link to `#Heading`) lands it under its stuck parents.
  const cover = (target: Element): number => {
    measure()
    let block: Element | null = target
    while (block !== null && block.parentElement !== body) block = block.parentElement
    if (block === null) return 0
    const at = headings.indexOf(block as HTMLElement)
    if (at >= 0) return coverAbove(shape, at, room)
    // Another block: the headings stuck when it is at the top are its section's heading and the ones that hold it.
    const top = block.getBoundingClientRect().top - body.getBoundingClientRect().top
    const i = lastAbove(shape, top + 1)
    return i < 0 ? 0 : Math.min(room, coverAbove(shape, i, room) + shape[i]!.height)
  }

  relayout()
  scroller.addEventListener('scroll', onScroll, { passive: true })
  layer.addEventListener('click', tap)
  const offCover = setLandingCover(scroller, cover)
  const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon)
  resized?.observe(scroller)
  resized?.observe(body)
  const mutated = typeof MutationObserver === 'undefined' ? null : new MutationObserver(soon)
  // One `observe` (a second on the same node replaces the first's options): a block drawn, a fold, an arrow turned, or slicing completed.
  mutated?.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: [HIDDEN_ATTR, 'aria-expanded', 'data-slicing'] })
  return () => {
    gone = true
    if (frame !== 0) cancelAnimationFrame(frame)
    if (relayoutFrame !== 0) cancelAnimationFrame(relayoutFrame)
    scroller.removeEventListener('scroll', onScroll)
    layer.removeEventListener('click', tap)
    offCover()
    resized?.disconnect()
    mutated?.disconnect()
    clearCopies()
    layer.replaceChildren()
  }
}
