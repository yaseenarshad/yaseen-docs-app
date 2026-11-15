import { getOutlineFoldKey } from '@client/editor/outline/outlineFoldKeys'

/**
 * FOLDING ON THE PHONE (YAZ-5568, option A): the Mac's fold rules on the drawn page (no editor).
 *  - A HEADING H1 to H3 folds when text is under it (the Mac's `headingFolding.ts`, `DEEPEST_FOLDABLE_LEVEL`): its
 *    section is the run of following top-level blocks up to the next heading of the same or a higher level. A heading
 *    in a list or a card does not fold. The page's own title (its first block, an H1 with the page's title, which the
 *    reader shows as the title) does not fold either: folding it would hide the whole page (the approved mockup).
 *  - A BULLET folds when it has children under its own line (a child list, a table, a picture, a board, a card): the
 *    Mac's `outlineFolding.ts`. Task bullets too. Its children hide; its line stays.
 *  - THE ARROW: the Mac's chevron (one stroked SVG, muted, turned right when folded), always shown (no hover on a phone),
 *    in the left margin: a heading's on its first line, a bullet's one step left of its dot. Each is a real `<button>`
 *    (44 pt, the arrow and the dot together) with `aria-expanded` and "Fold Watering" / "Unfold Watering". No count.
 *  - HIDING: one attribute (`data-fold-hidden`) on each hidden block, so a hidden block leaves the screen and VoiceOver's
 *    reading order. Nothing is written into the page.
 *  - KEYS: the Mac's (`outlineFoldKeys.ts`): `<hash>:<n>` for a bullet, `h:<hash>:<n>` for a heading, the label's
 *    occurrence among the foldable lines of its kind. A line whose words change drops its fold, as on the Mac.
 *
 * A long page draws in slices: `scan()` after each slice gives the new blocks their arrows and their hidden state (only
 * the new blocks are read; a section that runs into the next slice is followed across it), and `apply()` after the
 * whole page is drawn. One click listener on the page body takes every arrow's tap.
 *
 * `peek` opens folds for a while without keeping it (Find in page, the page's `find-folds`); `reveal` opens the folds
 * that hide an element and keeps that (a link or the Headings list landing on it).
 */

export const DEEPEST_FOLDABLE_LEVEL = 3
export const HIDDEN_ATTR = 'data-fold-hidden'
export const FOLD_BUTTON = 'fold-btn'
const UNTITLED_HEADING = 'Untitled heading'

/** What a bullet's children must hold for it to fold: a list, a table, a picture, a board, a card (the Mac's rule). */
const FOLD_KIDS = 'ul, ol, table, img, figure, .page-table-box, .card-embed, .card, .page-sound, .page-media--board, .page-drawing'
/** A card's text is the card's: nothing in it folds (the Headings list skips it too). */
const CARD = '.card, .card-embed'
/** The box the page's properties open in, after the title: never part of a section, never hidden. */
const PROPS_SLOT = 'page-props__slot'

export type FoldNext = 'collapse' | 'expand' | 'none'

export interface PageFolds {
  /** Gives the blocks drawn since the last scan their arrows and their hidden state. */
  scan(): void
  /** Reads the whole page again and hides what the folds hide. */
  apply(): void
  /** Folds or opens one line by its key. */
  toggle(key: string): void
  /** Collapse all (`true`) or Expand all (`false`): every heading and bullet. */
  setAll(collapsed: boolean): void
  /** What "Collapse all / Expand all" does now: collapse while anything is open, else expand; none: nothing folds. */
  next(): FoldNext
  /** Opens, for a while, the folds that hide these nodes (none: every fold as kept). */
  peek(nodes: readonly Node[]): void
  /** Opens the folds that hide `node`, and keeps them open. */
  reveal(node: Node): void
  /** The folded keys now. */
  folded(): string[]
  /** Takes every arrow and hidden mark away. */
  destroy(): void
}

export interface FoldOptions {
  /** The page's title: a first H1 with these words is the title, which does not fold. */
  title?: string
  /** The kept folds (`store/foldPref.ts`); none: the folds last while the page is open (an Explore panel). */
  initial?: readonly string[]
  onChange?: (keys: string[]) => void
}

/** The body each page's folds are on, so a landing or Find reaches them from an element. */
const registry = new WeakMap<Element, PageFolds>()

/** The folds of the page that holds `node`, if it folds. */
export function foldsOf(node: Node | null | undefined): PageFolds | undefined {
  for (let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null); el !== null; el = el.parentElement) {
    const folds = registry.get(el)
    if (folds !== undefined) return folds
  }
  return undefined
}

/** Opens the folds that hide `node` (a link, a heading of the list, a card asked for): it shows before the landing. */
export function revealFolds(node: Node): void {
  foldsOf(node)?.reveal(node)
}

const levelOf = (el: Element): number | null => {
  const m = /^H([1-6])$/.exec(el.tagName)
  return m === null ? null : Number(m[1])
}

/** The Mac's chevron (`headingFolding.ts`'s `chevronSvg`): down when open, turned right by CSS when folded. Its box is
 *  cut to the stroke (units 5 to 19 of 24; the same arrow at the same size, `reader.css`). */
function chevron(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '5 5 14 14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', 'M6 9l6 6 6-6')
  svg.appendChild(path)
  return svg
}

const BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'DIV', 'TABLE', 'FIGURE', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR'])

/** A bullet's own line and the children under it. A loose item's line is its first paragraph. */
function itemParts(li: Element): { label: string; rest: Element[] } {
  const kids = [...li.children].filter((c) => !c.classList.contains(FOLD_BUTTON))
  if (kids[0]?.tagName === 'P' && li.firstElementChild === kids[0] && (li.firstChild === kids[0] || (li.firstChild?.nodeType === 3 && (li.firstChild.textContent ?? '').trim() === ''))) {
    return { label: (kids[0].textContent ?? '').trim(), rest: kids.slice(1) }
  }
  let label = ''
  const rest: Element[] = []
  for (const node of li.childNodes) {
    if (node instanceof Element && node.classList.contains(FOLD_BUTTON)) continue
    if (rest.length > 0 || (node instanceof Element && BLOCK_TAGS.has(node.tagName))) {
      if (node instanceof Element) rest.push(node)
      continue
    }
    label += node.textContent ?? ''
  }
  return { label: label.replace(/\s+/g, ' ').trim(), rest }
}

const foldableItem = (rest: readonly Element[]) => rest.some((el) => el.matches(FOLD_KIDS) || el.querySelector(FOLD_KIDS) !== null)

function button(kind: 'heading' | 'bullet', key: string, label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `${FOLD_BUTTON} ${FOLD_BUTTON}--${kind}`
  b.dataset.foldKey = key
  b.dataset.foldLabel = label
  b.append(chevron())
  return b
}

function paint(b: HTMLButtonElement, folded: boolean): void {
  const open = String(!folded)
  if (b.getAttribute('aria-expanded') === open) return
  b.setAttribute('aria-expanded', open)
  b.setAttribute('aria-label', `${folded ? 'Unfold' : 'Fold'} ${b.dataset.foldLabel ?? ''}`)
}

const setHidden = (el: Element, hidden: boolean) => {
  if (hidden === el.hasAttribute(HIDDEN_ATTR)) return
  if (hidden) el.setAttribute(HIDDEN_ATTR, '')
  else el.removeAttribute(HIDDEN_ATTR)
}

/** The heading's own arrow, if it folds. */
const headingButton = (h: Element): HTMLButtonElement | null => {
  const first = h.firstElementChild
  return first instanceof HTMLButtonElement && first.classList.contains(FOLD_BUTTON) ? first : null
}

/** A bullet's own arrow (between its line and its children), if it folds. */
const itemButton = (li: Element): HTMLButtonElement | null => li.querySelector<HTMLButtonElement>(`:scope > .${FOLD_BUTTON}`)

/** Turns folding on for the drawn page in `body`. */
export function attachFolds(body: HTMLElement, options: FoldOptions = {}): PageFolds {
  const kept = new Set(options.initial ?? [])
  let peeked = new Set<string>()
  const isFolded = (key: string) => kept.has(key) && !peeked.has(key)

  // The scan's place: the last top-level block read, the open headings, the occurrences so far.
  let last: Element | null = null
  let open: { el: Element; level: number }[] = []
  let headingCount = new Map<string, number>()
  let bulletCount = new Map<string, number>()
  /** The headings counted in this scan (a heading is counted once, when its section starts). */
  let given = new WeakSet<Element>()

  const reset = () => {
    last = null
    given = new WeakSet()
    open = []
    headingCount = new Map()
    bulletCount = new Map()
  }

  const titleBlock = (el: Element) =>
    el === body.firstElementChild && el.tagName === 'H1' && options.title !== undefined && (el.textContent ?? '').trim().toLowerCase() === options.title.trim().toLowerCase()

  const giveHeadingArrow = (h: Element) => {
    if (given.has(h)) return
    given.add(h)
    const label = (h.textContent ?? '').replace(/\s+/g, ' ').trim() || UNTITLED_HEADING
    const n = headingCount.get(label) ?? 0
    headingCount.set(label, n + 1)
    if (headingButton(h) !== null) return
    const b = button('heading', `h:${getOutlineFoldKey(label, n)}`, label)
    paint(b, isFolded(b.dataset.foldKey!))
    h.prepend(b)
  }

  const giveBulletArrows = (block: Element) => {
    if (block.matches(CARD)) return
    for (const li of block.querySelectorAll('li')) {
      if (li.closest(CARD) !== null) continue
      const { label, rest } = itemParts(li)
      if (rest.length === 0 || !foldableItem(rest)) continue
      const n = bulletCount.get(label) ?? 0
      bulletCount.set(label, n + 1)
      if (itemButton(li) !== null) continue
      const b = button('bullet', getOutlineFoldKey(label, n), label === '' ? 'bullet' : label)
      const folded = isFolded(b.dataset.foldKey!)
      paint(b, folded)
      rest[0]!.before(b)
      for (const el of rest) setHidden(el, folded)
    }
  }

  const scan = () => {
    // A new draw (the first slice replaced the page, or a redraw swapped it in): read from the top again.
    if (last !== null && last.parentElement !== body) reset()
    let block = last === null ? body.firstElementChild : last.nextElementSibling
    for (; block !== null; block = block.nextElementSibling) {
      last = block
      if (block.classList.contains(PROPS_SLOT)) continue
      const level = levelOf(block)
      if (level !== null) while (open.length > 0 && open[open.length - 1]!.level >= level) open.pop()
      // Each heading still open holds this block: it has a section, so it folds.
      for (const h of open) giveHeadingArrow(h.el)
      setHidden(block, open.some((h) => isFolded(headingButton(h.el)?.dataset.foldKey ?? '')))
      if (level !== null && level <= DEEPEST_FOLDABLE_LEVEL && !titleBlock(block)) open.push({ el: block, level })
      giveBulletArrows(block)
    }
  }

  const apply = () => {
    scan()
    const stack: { level: number; folded: boolean }[] = []
    for (const block of body.children) {
      if (block.classList.contains(PROPS_SLOT)) continue
      const level = levelOf(block)
      if (level !== null) while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      setHidden(block, stack.some((h) => h.folded))
      const b = level === null ? null : headingButton(block)
      if (b !== null) {
        const folded = isFolded(b.dataset.foldKey!)
        paint(b, folded)
        stack.push({ level: level!, folded })
      }
    }
    for (const b of body.querySelectorAll<HTMLButtonElement>(`.${FOLD_BUTTON}--bullet`)) {
      const folded = isFolded(b.dataset.foldKey!)
      paint(b, folded)
      for (let el = b.nextElementSibling; el !== null; el = el.nextElementSibling) setHidden(el, folded)
    }
  }

  const changed = () => {
    apply()
    options.onChange?.([...kept].sort())
  }

  const allKeys = () => [...body.querySelectorAll<HTMLButtonElement>(`.${FOLD_BUTTON}`)].map((b) => b.dataset.foldKey!)

  /** The keys of the folds that hide `node` (kept folds, open or peeked). */
  const hiding = (node: Node): string[] => {
    const keys: string[] = []
    let top: Element | null = node instanceof Element ? node : node.parentElement
    // The bullets around it: a fold hides it when it is in the bullet's children, not on its line.
    for (let el = top; el !== null && el !== body; el = el.parentElement) {
      const parent: Element | null = el.parentElement
      if (parent?.tagName === 'LI') {
        const b = itemButton(parent)
        if (b !== null && b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && kept.has(b.dataset.foldKey!)) keys.push(b.dataset.foldKey!)
      }
      top = el
    }
    if (top === null || top.parentElement !== body) return keys
    // The headings whose sections hold its top-level block.
    const stack: { level: number; key: string | null }[] = []
    for (const block of body.children) {
      if (block === top) {
        for (const h of stack) if (h.key !== null && kept.has(h.key)) keys.push(h.key)
        break
      }
      if (block.classList.contains(PROPS_SLOT)) continue
      const level = levelOf(block)
      if (level === null) continue
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      const b = headingButton(block)
      if (b !== null) stack.push({ level, key: b.dataset.foldKey! })
    }
    return keys
  }

  const onClick = (event: MouseEvent) => {
    const b = (event.target as Element | null)?.closest?.(`.${FOLD_BUTTON}`)
    if (!(b instanceof HTMLButtonElement) || !body.contains(b)) return
    // The arrow's tap is the arrow's: never a link, a tick or a card's tap of the page around it.
    event.preventDefault()
    event.stopPropagation()
    folds.toggle(b.dataset.foldKey!)
  }
  body.addEventListener('click', onClick)

  const folds: PageFolds = {
    scan,
    apply,
    toggle(key) {
      peeked.delete(key)
      if (kept.has(key)) kept.delete(key)
      else kept.add(key)
      changed()
    },
    setAll(collapsed) {
      peeked = new Set()
      if (collapsed) for (const key of allKeys()) kept.add(key)
      else kept.clear()
      changed()
    },
    next() {
      const keys = allKeys()
      if (keys.length === 0) return 'none'
      return keys.some((k) => !isFolded(k)) ? 'collapse' : 'expand'
    },
    peek(nodes) {
      const next = new Set(nodes.flatMap(hiding))
      if (next.size === peeked.size && [...next].every((k) => peeked.has(k))) return
      peeked = next
      apply()
    },
    reveal(node) {
      const keys = hiding(node)
      if (keys.length === 0) return
      for (const key of keys) kept.delete(key)
      changed()
    },
    folded: () => [...kept].sort(),
    destroy() {
      body.removeEventListener('click', onClick)
      if (registry.get(body) === folds) registry.delete(body)
      for (const b of body.querySelectorAll(`.${FOLD_BUTTON}`)) b.remove()
      for (const el of body.querySelectorAll(`[${HIDDEN_ATTR}]`)) el.removeAttribute(HIDDEN_ATTR)
      reset()
    },
  }
  registry.set(body, folds)
  return folds
}
