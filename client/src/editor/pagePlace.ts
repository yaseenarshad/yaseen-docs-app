/**
 * WHERE YOU STAND IN A PAGE, AS A PLACE IN ITS TEXT (YAZ-5164: "it should keep me and maintain the scroll of where I am,
 * so that way I can just start editing wherever I am"). A tab keeps its place in px (`PageView.scrollTop`): the copy is
 * the same editor, so the same px show the same text. Explore's reading layer and its editor are two views of the same
 * text with other things above it (the editor's title and Properties), so px would land somewhere else. The place is
 * the top-level block at the scroller's top edge instead: its document position, and how far below the edge it starts.
 * Both views parse the same Markdown, so the position names the same block in each.
 */
import type { EditorView } from '@milkdown/kit/prose/view'

/** The block at a scroller's top edge: its document position, and how far below the edge it starts, px (negative: above). */
export interface PagePlace {
  pos: number
  offset: number
}

/** A page place, and where the caret goes so the next key types there: the first block that starts in view. */
export interface ReadPlace extends PagePlace {
  caret: number
}

/** A block's box, or null when it is not drawn (folded away, or not an element). */
function boxOf(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement) || dom.getClientRects().length === 0) return null
  return dom.getBoundingClientRect()
}

/**
 * Where `scroller` stands in `view`'s page: the first top-level block that reaches below its top edge, or `pinned` (a
 * card the person chose: Edit card keeps THAT card where it is on screen). Null when nothing is drawn.
 */
export function readPagePlace(view: EditorView, scroller: Element, pinned?: Element): ReadPlace | null {
  const { top: edge, bottom } = scroller.getBoundingClientRect()
  let place: PagePlace | null = null
  let caret: number | null = null
  let done = false
  if (pinned !== undefined) {
    view.state.doc.descendants((_node, pos) => {
      if (place !== null) return false
      if (view.nodeDOM(pos) !== pinned) return true
      place = { pos, offset: pinned.getBoundingClientRect().top - edge }
      caret = pos + 1
      return false
    })
  }
  // A block that starts below the scroller's bottom edge is out of view: the caret then goes into the top block.
  view.state.doc.forEach((_node, pos) => {
    if (done || caret !== null) return
    const box = boxOf(view, pos)
    if (box === null || box.bottom <= edge) return
    place ??= { pos, offset: box.top - edge }
    if (box.top >= bottom) done = true
    else if (box.top >= edge) caret = pos + 1
  })
  const found = place as PagePlace | null
  return found === null ? null : { ...found, caret: caret ?? found.pos + 1 }
}

/** Puts `place` back: `scroller` scrolls so the block at its position starts `offset` below the top edge. False when that block is not drawn. */
export function showPagePlace(view: EditorView, scroller: Element, place: PagePlace): boolean {
  if (place.pos < 0 || place.pos >= view.state.doc.content.size) return false
  const dom = view.nodeDOM(place.pos)
  if (!(dom instanceof HTMLElement) || dom.getClientRects().length === 0) return false
  showBoxAt(scroller, dom, place.offset)
  return true
}

/** How far below `scroller`'s top edge `box` starts, px (negative: above). */
export const boxOffset = (scroller: Element, box: Element): number => box.getBoundingClientRect().top - scroller.getBoundingClientRect().top

/**
 * Scrolls `scroller` so `box` starts `offset` below its top edge: the one move every switch makes (YAZ-5164). A page's
 * block (`showPagePlace`), and a view with no page under it: a card file's card, read or in Edit card.
 */
export function showBoxAt(scroller: Element, box: Element, offset: number): void {
  const want = scroller.scrollTop + boxOffset(scroller, box) - offset
  if (scroller instanceof HTMLElement && scroller.clientHeight > 0) roomFor(scroller, want)
  scroller.scrollTop = want
}

/**
 * ROOM AT THE BOTTOM (YAZ-5164 round 2, Yaseen: "at the bottom I add a test … as soon as I hit done, it jumps up a
 * bit"). The view a switch opens can be shorter under the line than the one it leaves (Edit card's key row, a card
 * file's embed still drawing): at the bottom its scroller cannot scroll as far, and the line would drop. The scroller
 * gets the px it lacks as room under its own bottom padding, so `want` is reachable. The room only ever shrinks: as the
 * person scrolls up it gives back what is no longer needed, so nothing on screen moves, and goes once it is 0.
 */
const rooms = new WeakMap<HTMLElement, { room: number; base: number; inline: string; off: () => void }>()
/** The holds (`freezeScroll`) on a scroller now: while any runs, its room does not shrink. */
const holds = new WeakMap<Element, number>()
/** How far `scroller` can scroll now, px. */
const maxScroll = (scroller: HTMLElement): number => scroller.scrollHeight - scroller.clientHeight
function roomFor(scroller: HTMLElement, want: number): void {
  // Measured, not added up: a last child's margin can take part of the padding, so the room is checked once more.
  for (let i = 0; i < 2; i++) {
    const room = rooms.get(scroller)?.room ?? 0
    const next = Math.max(0, room + Math.ceil(want - maxScroll(scroller)))
    if (next === room) return
    if (room === 0) {
      const base = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
      // The room the person scrolls away from goes: what lies past the bottom of the view and is not needed.
      const onScroll = () => {
        const now = rooms.get(scroller)
        // A hold (`freezeScroll`) keeps all its room: the view under it is about to get shorter.
        if (now === undefined || (holds.get(scroller) ?? 0) > 0) return
        const left = Math.max(0, now.room - Math.floor(maxScroll(scroller) - scroller.scrollTop))
        if (left < now.room) setRoom(scroller, left)
      }
      scroller.addEventListener('scroll', onScroll, { passive: true })
      rooms.set(scroller, { room: 0, base, inline: scroller.style.paddingBottom, off: () => scroller.removeEventListener('scroll', onScroll) })
    }
    setRoom(scroller, next)
  }
}
function setRoom(scroller: HTMLElement, room: number): void {
  const at = rooms.get(scroller)
  if (at === undefined) return
  if (room > 0) {
    at.room = room
    scroller.style.paddingBottom = `${at.base + room}px`
    return
  }
  at.off()
  rooms.delete(scroller)
  scroller.style.paddingBottom = at.inline
}

/** How long a switch keeps its place while the view it opened still draws (pictures, embeds, a card's text). */
export const KEEP_PLACE_MS = 1000

/** What the person does to scroll: any of these and the place is theirs at once. */
const PERSON_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

/**
 * Calls `fn` until the person scrolls, presses or types (`PERSON_EVENTS` on the scroller or the window), or `fn` returns
 * true: the one way a switch gives the scroll back (YAZ-5164 round 2, Yaseen: "there's like a hang on the scroll up").
 * Returns the stop.
 */
function untilPerson(scroller: Element, stop: () => void): () => void {
  let done = false
  // The key or press that started the switch is still on its way (React runs a switch inside its keydown): not counted.
  const born = performance.now()
  const end = (event?: Event) => {
    if (done || (event !== undefined && event.timeStamp <= born)) return
    done = true
    for (const type of PERSON_EVENTS) {
      scroller.removeEventListener(type, onPerson, true)
      window.removeEventListener(type, onPerson, true)
    }
    stop()
  }
  const onPerson = (event: Event) => end(event)
  for (const type of PERSON_EVENTS) {
    scroller.addEventListener(type, onPerson, { capture: true, passive: true })
    window.addEventListener(type, onPerson, { capture: true, passive: true })
  }
  return () => end()
}

/**
 * Puts a place back with `put` now, and again each time the view under it changes size while it still draws (an embed,
 * a picture, the blocks above), for `ms` at most (YAZ-5164 round 2: the reading view's card embeds draw after it is up;
 * the line dropped 298 px). The first wheel, touch, press or key of the person ends it at once: the place is theirs.
 * Returns the stop.
 */
export function keepPlace(scroller: Element, put: () => void, ms = KEEP_PLACE_MS): () => void {
  put()
  if (typeof ResizeObserver === 'undefined') return () => undefined
  // Where the place left the scroll: a scroll to anywhere else (a jump of the outline, a find, a scroll by code) is
  // another place asked for, and ends this one.
  let at = scroller.scrollTop
  const putHere = () => {
    put()
    at = scroller.scrollTop
  }
  const onScroll = () => {
    if (Math.abs(scroller.scrollTop - at) > 1) stop()
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })
  // A size change (a picture loads) is seen before the paint; a block drawn in (an embed's card) or a look switched (a
  // class: the body swapped in, a card's read look) at once, in its own task: no frame shows the page between the two.
  const watch = new ResizeObserver(() => putHere())
  for (const child of Array.from(scroller.children)) watch.observe(child)
  const drawn = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => putHere())
  drawn?.observe(scroller, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] })
  const timer = setTimeout(() => stop(), ms)
  const stop = untilPerson(scroller, () => {
    clearTimeout(timer)
    scroller.removeEventListener('scroll', onScroll)
    watch.disconnect()
    drawn?.disconnect()
  })
  return stop
}

/**
 * Keeps `scroller` where it is until the returned function is called (YAZ-5164): a view built out of sight under the one
 * on show (a card editor that puts its caret in view, a focus) must not move the one on show. The person's own wheel,
 * touch, press or key ends it at once (round 2: a hold Done left behind fought the wheel for 3 s, "a hang on the scroll up").
 */
export function freezeScroll(scroller: Element): () => void {
  const at = scroller.scrollTop
  // Room under the view while it is held: a view that gets shorter under it (Done draws Edit card's card in its read
  // look, without the key row) cannot pull the line down at the bottom. The swap's place, or the stop, sizes it again.
  if (scroller instanceof HTMLElement && scroller.clientHeight > 0) roomFor(scroller, at + scroller.clientHeight)
  holds.set(scroller, (holds.get(scroller) ?? 0) + 1)
  const back = () => {
    if (scroller.scrollTop !== at) scroller.scrollTop = at
  }
  scroller.addEventListener('scroll', back)
  return untilPerson(scroller, () => {
    scroller.removeEventListener('scroll', back)
    holds.set(scroller, Math.max(0, (holds.get(scroller) ?? 1) - 1))
    if (scroller instanceof HTMLElement && scroller.clientHeight > 0) roomFor(scroller, scroller.scrollTop)
  })
}

/** The element that scrolls `el`: its nearest ancestor with its own vertical scroll and more to scroll than it shows (a tab's `.editor-host`, Explore's body). */
export function scrollerOf(el: Element): Element | null {
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) return at
  }
  return null
}

/**
 * Runs `change` with the page held in place (YAZ-5164): the block at the top stays at the same spot on screen, whatever
 * `change` does to the layout or the scroll (a lock or an unlock, the caret given back). Returns what `change` returns.
 */
export function holdPagePlace<T>(view: EditorView, change: () => T): T {
  const scroller = scrollerOf(view.dom)
  const place = scroller === null ? null : readPagePlace(view, scroller)
  const out = change()
  // Again while the blocks redraw in their new look (a card, an embed), until the person scrolls (round 2).
  if (scroller !== null && place !== null && !view.isDestroyed) keepPlace(scroller, () => !view.isDestroyed && showPagePlace(view, scroller, place))
  return out
}

/**
 * A CARD'S PLACE ACROSS READ ⇄ EDIT CARD (YAZ-5164: "the same text must stay at the same spot there too"). The read card
 * and the card editor draw one card's text with lines of other heights (and the editor has a Title field on top), so the
 * card's box alone keeps the card in place but shows another line at the top. The place is the LINE at the top: its text,
 * which one of the lines with that text it is, and how far below the top edge it starts. The card's box is the fallback
 * when the other view has no such line (a line drawn otherwise there).
 */
export interface SwapPlace {
  /** The card box's offset: the fallback. */
  offset: number
  /** The text line at the top, with spaces made one, and which of the lines with that text it is. */
  text: string
  nth: number
  /** How far below the top edge that line starts, px (negative: above). */
  line: number
}

/** A line of text as either view draws it: a paragraph, a heading, a list line with no paragraph, code. */
const TEXT_LINES = 'p, h1, h2, h3, h4, h5, h6, pre, li:not(:has(> p))'
const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const linesIn = (box: Element): Element[] => [...box.querySelectorAll(TEXT_LINES)].filter((el) => el.getClientRects().length > 0 && textOf(el) !== '')

/** Where `box` (a card, read or in Edit card) stands in `scroller`: its first line that reaches below the top edge. */
export function readSwapPlace(scroller: Element, box: Element): SwapPlace {
  const offset = boxOffset(scroller, box)
  const edge = scroller.getBoundingClientRect().top
  const lines = linesIn(box)
  const top = lines.find((el) => el.getBoundingClientRect().bottom > edge)
  if (top === undefined) return { offset, text: '', nth: -1, line: 0 }
  const text = textOf(top)
  return { offset, text, nth: lines.filter((el) => textOf(el) === text).indexOf(top), line: boxOffset(scroller, top) }
}

/** Puts `place` back on `box`, the other view of the card: its same line at the same spot, else the box at the old box's spot. */
export function showSwapPlace(scroller: Element, box: Element, place: SwapPlace): void {
  const same = place.nth < 0 ? [] : linesIn(box).filter((el) => textOf(el) === place.text)
  const line = same[place.nth] ?? same[0]
  if (line !== undefined) showBoxAt(scroller, line, place.line)
  else showBoxAt(scroller, box, place.offset)
}
