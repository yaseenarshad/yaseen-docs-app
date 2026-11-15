/**
 * The table of contents engine (YAZ-2700): the scan, the jump and the scroll spy behind
 * `TocChannel`.
 *
 * THE NOTE'S OWN STRUCTURE decides what the rows are, and the channel never says which:
 *  - HEADINGS, when the note has two or more of them outside lists. They are counted by
 *    `headingFolding.ts`'s walk, through its own helpers — the document's blocks and every
 *    walkable container (a blockquote), never inside a list. Two differences: the rows go down to
 *    H5 (`DEEPEST_TOC_LEVEL`, YAZ-3051), where folds stop at H3; and a heading with nothing under it
 *    has no section to fold but is still a place to go, so it is listed. H6 is never a row. The
 *    rows are then every heading of the note, the ones inside its bullets too, each nested by its
 *    place (YAZ-4094 4E, `scanAllHeadings`). Its plain bullets are no rows.
 *  - BULLETS otherwise — a bullet note is one big list with no headings, and its bullets are its
 *    structure. Every item of a list that is a direct child of the document (bulleted or
 *    numbered, each such list in document order) is a row, three levels down: an item is level 1,
 *    its child items level 2, theirs level 3, deeper ones are not listed. The text is the item's
 *    label (`itemLabelText`), so `* # Topic` is a row "Topic" at its bullet's depth. An item with
 *    an empty label is no row, its children still are. A list inside a blockquote does not count.
 *  - Neither gives two rows: what the headings gave (none, or one). The component draws nothing
 *    under two rows either way.
 *
 * That is AUTO. THE READER MAY CHOOSE for one note instead (YAZ-2700 D14, the channel's source):
 *  - `headings`: every H1-H5 of the note in document order, the ones inside list items at any
 *    depth as well as the ones in blockquotes, each at its heading level, and no bullet. On a
 *    note that is all bullets this lists exactly the bullets the reader made into headings.
 *  - `bullets`: the bullets as above, however many headings the note has.
 *  A chosen source that gives fewer than two rows publishes those: there is no falling back to
 *  the other one, so the list is what the reader asked for or nothing.
 *
 * 🔒 THE TYPING BUDGET. This plugin has no state field and no decorations, so a transaction costs
 * it nothing. Its view scans ONCE at creation and then 150 ms after the last document change: a
 * keystroke only restarts a timer. The walk visits the blocks outside lists and never descends
 * into a textblock; only when that finds fewer than two headings does it enter the top-level
 * lists, three levels of items and no further, reading of each item its label — its first block —
 * and nothing else. The `headings` source, and Auto once it found two headings (YAZ-4094 4E), walks
 * every block of the note, lists included, and still no textblock. A caret move does nothing but
 * two reads of the zoom level. A change of source, and a zoom in or out (4D), is scanned at once:
 * it is a click, not typing.
 *
 * Positions are remembered from the last scan only to find a row's DOM node for the scroll spy —
 * the heading's, or the list item's. For 150 ms after an edit above a row they are stale, so a
 * node is trusted only when it IS an h1-h5 element (headings) or a list item's own element
 * (bullets); the jump never uses them and scans the live document again.
 *
 * Nothing here changes the document: the jump dispatches an unfold (metadata-only) and a
 * selection, so `markdownUpdated` never fires and the file on disk is untouched. What the unfold
 * reveals eases in and the row it lands on flashes, both by Web Animations on the editor's own
 * elements: no attribute, class or style is written, so ProseMirror sees no mutation either.
 */
import type { TocSource } from '@shared/types'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { collapsedHeadingsHiding, headingLevel, isHeadingCollapsed, isWalkableContainer, setHeadingFoldSet } from '../outline/headingFolding'
import { boardCheckOf } from '../drawing/boardEmbedScan'
import type { BoardCheck } from '../drawing/boardEmbedText'
import { findNestedLists, isListItem, itemLabelText, LIST_NODE_NAMES, UNTITLED_ITEM } from '../outline/listNodes'
import { collapsedItemsHiding, isOutlineItemCollapsed, setOutlineFoldSet } from '../outline/outlineFolding'
import { getZoomedItemPos, zoomOutFully } from '../outline/zoom'
import { DEEPEST_TOC_LEVEL, ENOUGH_ROWS, type TocChannel, type TocController, type TocLevel, type TocRow } from './tocChannel'
import { FLASH_FRAMES, FLASH_MS, GLIDE_MS, GLIDE_SCREENS, glideEase, LANDING_PX, reducedMotion } from './tocMotion'

/** How long the document must rest before it is scanned again. */
export const SCAN_DELAY_MS = 150

/** A row is current once its top is this far below the scroller's top, or higher. */
const CURRENT_LINE_PX = 40

/** The glide and the flash are `tocMotion.ts`'s: the code Outline moves the same way. */

/** How long a block that a jump unfolded takes to ease in: an instant unfold pops, right beside a glide. */
const REVEAL_MS = 320
/** Fast out, slow in: most of the way at once, then it settles. */
const REVEAL_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
/** Opacity and a small rise, never a height: the layout is final at once, and the glide measures its target once. */
const REVEAL_FROM = { opacity: 0, transform: 'translateY(-6px)' }
const REVEAL_TO = { opacity: 1, transform: 'none' }
/** Each of the first blocks starts this long after the one above it, so the fold reads as opening from its heading down. */
const REVEAL_STAGGER_MS = 18
/** The stagger stops growing here: a long section must not wait on its own tail. */
const REVEAL_STAGGERED = 8
/** No more blocks than this are eased: the rest of a long section is far off screen. */
const REVEAL_MOST = 60

/** A bullet deeper than this is not a row. Headings go down to `DEEPEST_TOC_LEVEL`; bullets stay at three levels (YAZ-3051 D3). */
const DEEPEST_BULLET_LEVEL = 3
/** The element Crepe's node view gives a `list_item` — what `view.nodeDOM` answers for one; the `<li>` is its child. */
const LIST_ITEM_CLASS = 'milkdown-list-item-block'

export interface ScannedRow extends TocRow {
  /** Document position of the row's node — the heading, or in a bullet note the list item — as the document stood at the scan. */
  pos: number
}

export interface ScannedNote {
  /** True when the rows are the note's bullets (`pos` is a list item's), false when they are its headings. */
  bullets: boolean
  rows: ScannedRow[]
}

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const tocKey = new PluginKey('mdapp-table-of-contents')

/** Headings inside ONE block container, appended in document order (`contentStart`: position of its first child). */
const collectHeadings = (parent: ProseNode, contentStart: number, found: ScannedRow[]): void => {
  parent.forEach((child, offset) => {
    const pos = contentStart + offset
    const level = headingLevel(child)
    if (level === null) {
      if (isWalkableContainer(child)) collectHeadings(child, pos + 1, found)
      return
    }
    if (level > DEEPEST_TOC_LEVEL) return
    found.push({ level: level as TocLevel, text: child.textContent.trim() || 'Untitled heading', pos })
  })
}

/** Every H1-H5 outside lists, in document order. */
export const scanHeadings = (doc: ProseNode): ScannedRow[] => {
  const found: ScannedRow[] = []
  collectHeadings(doc, 0, found)
  return found
}

/**
 * The bullets of ONE list, appended in document order, each followed by its own (`contentStart`:
 * position of the list's first item). An unlabelled bullet is passed over and its children kept:
 * they are places to go, at the depth they are drawn at. `isBoard` is the host's word on an id embed (`boardCheckOf`,
 * YAZ-4920): its row then reads as the board's, `![[EMB-40]]`, which `linkText` shows as the board's name.
 */
const collectBullets = (list: ProseNode, contentStart: number, level: TocLevel, found: ScannedRow[], isBoard?: BoardCheck): void => {
  list.forEach((item, offset) => {
    if (!isListItem(item)) return
    const pos = contentStart + offset
    const text = itemLabelText(item, isBoard)
    // `UNTITLED_ITEM` is `itemLabelText`'s word for no label, and such a bullet is no row. One
    // that really reads "Untitled item" is a row like any other.
    if (text !== UNTITLED_ITEM || item.firstChild?.textContent.trim() === UNTITLED_ITEM) found.push({ level, text, pos })
    if (level === DEEPEST_BULLET_LEVEL) return
    // `pos + 1 + nested.offset` is the nested list; its first item starts one further in.
    for (const nested of findNestedLists(item)) collectBullets(nested.list, pos + nested.offset + 2, (level + 1) as TocLevel, found, isBoard)
  })
}

/** Every labelled bullet of the document's own lists, three levels deep, in document order. */
export const scanBullets = (doc: ProseNode, isBoard?: BoardCheck): ScannedRow[] => {
  const found: ScannedRow[] = []
  doc.forEach((block, offset) => {
    if (LIST_NODE_NAMES.has(block.type.name)) collectBullets(block, offset + 1, 1, found, isBoard)
  })
  return found
}

/**
 * Every H1-H5 of the note, in document order: the ones outside lists, in blockquotes, and inside
 * list items at any depth. Every block is visited and no textblock is entered.
 *
 * A HEADING INSIDE A BULLET takes its level from its PLACE, not from its H number (YAZ-4094 4E): it
 * is one level under the nearest heading that holds it — a bullet above it whose label is a heading,
 * or else the heading whose section the list is in — down to H5's level at most. So `* # test` deep
 * under `* ### Lookback` in the section "Weekly planning" (H1) is a row under Lookback (2), at 3.
 * A heading outside lists keeps its H number, as before.
 */
export const scanAllHeadings = (doc: ProseNode): ScannedRow[] => {
  const found: ScannedRow[] = []
  /** The row level of each bullet whose label is a heading. */
  const labelLevels = new Map<number, number>()
  /** The level of the last heading outside lists: the section a list below it is in. */
  let sectionLevel = 0
  doc.descendants((node, pos) => {
    const level = headingLevel(node)
    if (level === null || level > DEEPEST_TOC_LEVEL) return !node.isTextblock
    const $pos = doc.resolve(pos)
    let holder: number | null = null
    let inList = false
    for (let depth = $pos.depth; depth > 0; depth--) {
      if (!isListItem($pos.node(depth))) continue
      inList = true
      const itemPos = $pos.before(depth)
      // The heading's own bullet holds it only as its label: that is the row itself.
      const own = depth === $pos.depth && $pos.index() === 0
      if (!own && labelLevels.has(itemPos)) {
        holder = labelLevels.get(itemPos) ?? null
        break
      }
    }
    const rowLevel = inList ? Math.min(DEEPEST_TOC_LEVEL, (holder ?? sectionLevel) + 1) : level
    if (!inList) sectionLevel = level
    const itemPos = labelledItemPos(doc, pos)
    if (itemPos !== null) labelLevels.set(itemPos, rowLevel)
    found.push({ level: rowLevel as TocLevel, text: node.textContent.trim() || 'Untitled heading', pos })
    return false
  })
  return found
}

/**
 * The note's rows. By the reader's choice when there is one — all its headings, or its bullets,
 * however few that gives. Else (`null`, Auto) by its own structure: its headings outside lists
 * when it has enough of them, else its bullets, else the heading or none it has.
 */
export const scanNote = (doc: ProseNode, source: TocSource | null = null, isBoard?: BoardCheck): ScannedNote => {
  if (source === 'headings') return { bullets: false, rows: scanAllHeadings(doc) }
  if (source === 'bullets') return { bullets: true, rows: scanBullets(doc, isBoard) }
  const headings = scanHeadings(doc)
  // Enough headings outside lists make it a heading note: then the headings inside its bullets are rows too (YAZ-4094 4E).
  if (headings.length >= ENOUGH_ROWS) return { bullets: false, rows: scanAllHeadings(doc) }
  const bullets = scanBullets(doc, isBoard)
  return bullets.length >= ENOUGH_ROWS ? { bullets: true, rows: bullets } : { bullets: false, rows: headings }
}

/**
 * A bullet zoom's own rows (YAZ-4094 4D): the zoom makes the bullet a page, so its rows are what is
 * in it. Its child bullets three levels down, or with the `headings` source every H1-H5 inside it.
 * Null when that gives fewer than two rows: the note's own rows then stay, with the zoom's section
 * current (4C).
 */
export const scanZoom = (doc: ProseNode, itemPos: number, source: TocSource | null = null, isBoard?: BoardCheck): ScannedNote | null => {
  const item = doc.nodeAt(itemPos)
  if (!isListItem(item)) return null
  const rows: ScannedRow[] = []
  if (source === 'headings') {
    // The note's rows inside the bullet, raised so the highest is level 1.
    const inside = scanAllHeadings(doc).filter(({ pos }) => itemPos < pos && pos < itemPos + item.nodeSize)
    const top = Math.min(...inside.map(({ level }) => level))
    for (const row of inside) rows.push({ ...row, level: (row.level - top + 1) as TocLevel })
  } else {
    for (const nested of findNestedLists(item)) collectBullets(nested.list, itemPos + nested.offset + 2, 1, rows, isBoard)
  }
  return rows.length >= ENOUGH_ROWS ? { bullets: source !== 'headings', rows } : null
}

/** Whether every bullet around the row at `pos` — and the row itself when it is a bullet — holds the zoomed bullet at `zoomed`. */
const holdsZoom = (doc: ProseNode, pos: number, zoomed: number): boolean => {
  if (pos > doc.content.size) return false
  const holds = (from: number, node: ProseNode): boolean => from <= zoomed && zoomed < from + node.nodeSize
  const own = doc.nodeAt(pos)
  if (own !== null && isListItem(own) && !holds(pos, own)) return false
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) if (isListItem($pos.node(depth)) && !holds($pos.before(depth), $pos.node(depth))) return false
  return true
}

/** The list item a heading is the label of — its first block — or null for any other heading. */
const labelledItemPos = (doc: ProseNode, headingPos: number): number | null => {
  const $heading = doc.resolve(headingPos)
  return isListItem($heading.parent) && $heading.index() === 0 ? $heading.before() : null
}

/**
 * The row's element, or null when `pos` no longer starts a node of its kind (a stale position, or
 * no DOM for it): an h1-h5 for a heading — inside a list item or out of one, the element is the
 * same — and the node view's own element for a bullet.
 */
const rowElement = (view: EditorView, pos: number | undefined, bullets: boolean): HTMLElement | null => {
  if (pos === undefined) return null
  const dom = view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement)) return null
  return (bullets ? dom.classList.contains(LIST_ITEM_CLASS) : /^H[1-5]$/.test(dom.tagName)) ? dom : null
}

/**
 * The blocks a heading's fold was hiding, read off the DOM: its following siblings up to the next
 * heading of its own level or above (H4-H6 end no section, `headingFolding.ts`).
 */
const sectionElements = (view: EditorView, headingPos: number): HTMLElement[] => {
  const heading = view.nodeDOM(headingPos)
  if (!(heading instanceof HTMLElement) || !/^H[1-6]$/.test(heading.tagName)) return []
  const level = Number(heading.tagName[1])
  const found: HTMLElement[] = []
  for (let next = heading.nextElementSibling; next !== null; next = next.nextElementSibling) {
    if (/^H[1-6]$/.test(next.tagName) && Number(next.tagName[1]) <= level) break
    if (next instanceof HTMLElement) found.push(next)
  }
  return found
}

/** What a bullet's fold was hiding: the elements of its nested lists, the ones that carried the `display: none` (outlineFolding.css). */
const nestedListElements = (view: EditorView, itemPos: number): HTMLElement[] => {
  const item = view.state.doc.nodeAt(itemPos)
  if (!isListItem(item)) return []
  return findNestedLists(item)
    .map(({ offset }) => view.nodeDOM(itemPos + 1 + offset))
    .filter((dom): dom is HTMLElement => dom instanceof HTMLElement)
}

/** Where `scroller` must stand for `element` to sit `LANDING_PX` below its top edge, as far as it can scroll. */
const landingTop = (scroller: HTMLElement, element: HTMLElement): number =>
  Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - LANDING_PX))

/** jsdom has no `matchMedia`, and the contract runs there. */

/** How the rows name a line's links (YAZ-3744 D6): the text as the note shows it, and the index's change to scan again on. */
export interface TocLinks {
  linkText: (text: string) => string
  subscribe: (listener: () => void) => () => void
}

export const createTableOfContents = (channel: TocChannel, links?: TocLinks) =>
  $prose(
    () =>
      new Plugin({
        key: tocKey,
        view: (view) => {
          /** Positions of the rows last published, index for index. */
          let positions: readonly number[] = []
          /** Which kind those rows are: a position is a list item's when true, a heading's when false. */
          let bullets = false
          let timer: ReturnType<typeof setTimeout> | null = null

          const scan = (): ScannedNote => {
            if (timer !== null) clearTimeout(timer)
            timer = null
            // In a bullet zoom, the zoom's own rows when it has enough (YAZ-4094 4D).
            const zoomed = getZoomedItemPos(view.state)
            const isBoard = boardCheckOf(view.state)
            const note = (zoomed === null ? null : scanZoom(view.state.doc, zoomed, channel.getSource(), isBoard)) ?? scanNote(view.state.doc, channel.getSource(), isBoard)
            positions = note.rows.map(({ pos }) => pos)
            bullets = note.bullets
            // A row names its links as the note shows them (YAZ-3744 D6).
            channel.publish(note.rows.map(({ level, text }) => ({ level, text: links === undefined ? text : links.linkText(text) })))
            return note
          }

          /** The glide under way: how to stop it where it is. */
          let stopGlide: (() => void) | null = null

          /**
           * The landing: exactly on the row, then one flash — a band that holds, then fades. The
           * engine places the row itself, `LANDING_PX` below the scroller's edge, by its own
           * arithmetic: `scrollIntoView` would pull the row flush against the edge. An editor
           * that is not inside a note's scroller (the unit tests) has nothing to scroll.
           */
          const land = (element: HTMLElement, scroller: HTMLElement | null): void => {
            if (scroller !== null) scroller.scrollTop = landingTop(scroller, element)
            // jsdom has no `animate`.
            if (typeof element.animate === 'function' && !reducedMotion())
              element.animate(FLASH_FRAMES, { duration: FLASH_MS, easing: 'ease-out' })
          }

          /**
           * What a jump unfolded EASES in, each block once, top to bottom. Web Animations only:
           * no attribute, no class and no style is written, so ProseMirror sees no mutation and
           * the fold plugins know nothing of it. Under reduced motion, or where the DOM cannot
           * animate (jsdom), the unfold stays the instant one it is.
           */
          const reveal = (elements: readonly HTMLElement[]): void => {
            if (elements.length === 0 || reducedMotion()) return
            // A section inside a section was gathered twice, and a blockquote's own blocks after the blocks that follow it.
            const ordered = [...new Set(elements)].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
            ordered.slice(0, REVEAL_MOST).forEach((element, i) => {
              if (typeof element.animate !== 'function') return
              // `backwards`: a block waiting for its turn is not on show before it.
              element.animate([REVEAL_FROM, REVEAL_TO], { duration: REVEAL_MS, easing: REVEAL_EASING, delay: Math.min(i, REVEAL_STAGGERED) * REVEAL_STAGGER_MS, fill: 'backwards' })
            })
          }

          /**
           * A jump GLIDES to its row: one eased move of `GLIDE_MS`, the same for a row two lines
           * away and one at the far end, so a long note is never a long wait. A row further than
           * `GLIDE_SCREENS` windows away starts the move that far from it — the reader sees the
           * arrival, and the note in between is never painted on the way. The reader's own wheel,
           * press or key takes the note back at once. Without a scroller to move (the unit tests) or
           * under reduced motion it lands directly.
           */
          const glide = (element: HTMLElement): void => {
            stopGlide?.()
            const scroller = element.closest<HTMLElement>('.editor-host')
            if (scroller === null || reducedMotion() || typeof requestAnimationFrame !== 'function') {
              land(element, scroller)
              return
            }
            const to = landingTop(scroller, element)
            const far = GLIDE_SCREENS * scroller.clientHeight
            if (Math.abs(to - scroller.scrollTop) > far) scroller.scrollTop = to - Math.sign(to - scroller.scrollTop) * far
            const from = scroller.scrollTop
            const started = performance.now()
            let frame = 0
            const stop = (): void => {
              cancelAnimationFrame(frame)
              scroller.removeEventListener('wheel', stop)
              scroller.removeEventListener('pointerdown', stop)
              scroller.removeEventListener('keydown', stop)
              stopGlide = null
            }
            const step = (now: number): void => {
              const t = Math.min(1, (now - started) / GLIDE_MS)
              // Ease in and out (cubic): it leaves gently and settles gently.
              const eased = glideEase(t)
              scroller.scrollTop = from + (to - from) * eased
              if (t < 1) {
                frame = requestAnimationFrame(step)
                return
              }
              stop()
              land(element, scroller)
            }
            scroller.addEventListener('wheel', stop, { passive: true })
            scroller.addEventListener('pointerdown', stop, { passive: true })
            scroller.addEventListener('keydown', stop)
            stopGlide = stop
            frame = requestAnimationFrame(step)
          }

          const controller: TocController = {
            jump: (index) => {
              // A FRESH scan: the remembered positions may be 150 ms behind the document.
              const note = scan()
              const target = note.rows[index]
              if (target === undefined) return
              // A row outside the zoomed bullet ends the zoom first (YAZ-4094 4C): the reader asked for a place the zoom hides.
              const zoomed = getZoomedItemPos(view.state)
              if (zoomed !== null && !(zoomed <= target.pos && target.pos < zoomed + (view.state.doc.nodeAt(zoomed)?.nodeSize ?? 0))) zoomOutFully(view.state, view.dispatch)
              // The reader asked for THIS section: every fold that hides its heading opens, and so
              // does its own — a folded heading is one line, and the reader asked for what is under
              // it. Declines an empty set, so a heading that nothing hides and that is open itself
              // costs no transaction. A heading folded over a list hides a bullet of it, and a
              // heading inside one, the same way and opens the same way.
              const folded = collapsedHeadingsHiding(view.state, target.pos)
              if (!note.bullets && isHeadingCollapsed(view.state, target.pos)) folded.push(target.pos)
              setHeadingFoldSet(folded, false)(view.state, view.dispatch)
              // The same for the bullets, whatever the rows are: every folded bullet above the row
              // opens — a heading row may sit deep inside a list — and so does the row's own
              // bullet: the bullet itself, or the one a heading row is the label of.
              // `view.state` again: the unfold above was a dispatch of its own.
              const foldedItems = collapsedItemsHiding(view.state, target.pos)
              const ownItem = note.bullets ? target.pos : labelledItemPos(view.state.doc, target.pos)
              if (ownItem !== null && isOutlineItemCollapsed(view.state, ownItem)) foldedItems.push(ownItem)
              setOutlineFoldSet(foldedItems, false)(view.state, view.dispatch)
              // `view.state` again, for the same reason. The caret goes to the start of the row's
              // first textblock: `target.pos + 1` in a heading, the label's first place in a bullet.
              const { state } = view
              const $inside = state.doc.resolve(target.pos + 1)
              view.dispatch(state.tr.setSelection(Selection.findFrom($inside, 1, true) ?? Selection.near($inside)))
              view.focus()
              const element = rowElement(view, target.pos, note.bullets)
              // The glide FIRST: it measures where its row stands, and a row inside a block that
              // has just begun to rise would be measured 6px high for every such block around it.
              if (element !== null) glide(element)
              reveal([...folded.flatMap((pos) => sectionElements(view, pos)), ...foldedItems.flatMap((pos) => nestedListElements(view, pos))])
            },
            current: (indices, scroller) => {
              const box = scroller.getBoundingClientRect()
              const line = box.top + CURRENT_LINE_PX
              // A note too short to scroll is at its top and its bottom at once: the top wins.
              const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
              let first = -1
              let above = -1
              let lastInView = -1
              for (let row = 0; row < indices.length; row++) {
                const element = rowElement(view, positions[indices[row]], bullets)
                // No box at all: the heading is inside a folded section, the bullet inside a folded bullet.
                if (element === null || element.offsetParent === null) continue
                if (first === -1) first = row
                const { top } = element.getBoundingClientRect()
                // Rows come in document order, so every later one is further down still.
                if (top >= box.bottom) break
                if (top <= line) above = row
                lastInView = row
              }
              // In a zoom with no row on screen (YAZ-4094 4C): the last row before the zoomed bullet that holds it — a
              // row inside a bullet counts only when that bullet holds the zoom, so a heading inside an earlier
              // bullet is passed over and the section heading wins (4C1).
              const zoomed = getZoomedItemPos(view.state)
              if (first === -1 && zoomed !== null) {
                let holder = -1
                for (let row = 0; row < indices.length && positions[indices[row]] <= zoomed; row++) if (holdsZoom(view.state.doc, positions[indices[row]], zoomed)) holder = row
                return holder
              }
              // The last rows of a note can never reach the line: at the very bottom the last one on screen is where the reader is.
              if (atBottom && lastInView !== -1) return lastInView
              return above !== -1 ? above : first
            },
            rescan: () => {
              scan()
            },
          }

          const unbind = channel.bind(controller)
          channel.setZoomed(getZoomedItemPos(view.state) !== null)
          scan()
          // A title that changes in the index renames the rows that link to it: one scan, as after an edit.
          const unsubscribeLinks = links?.subscribe(() => {
            if (timer !== null) clearTimeout(timer)
            timer = setTimeout(scan, SCAN_DELAY_MS)
          })
          return {
            update: (_view, previous) => {
              channel.setZoomed(getZoomedItemPos(view.state) !== null)
              // A zoom in or out scans at once, as a change of source does: a click, not typing (YAZ-4094 4D).
              if (getZoomedItemPos(previous) !== getZoomedItemPos(view.state)) {
                scan()
                return
              }
              if (view.state.doc === previous.doc) return
              if (timer !== null) clearTimeout(timer)
              timer = setTimeout(scan, SCAN_DELAY_MS)
            },
            destroy: () => {
              stopGlide?.()
              if (timer !== null) clearTimeout(timer)
              timer = null
              unbind()
              unsubscribeLinks?.()
            },
          }
        },
      }),
  )
