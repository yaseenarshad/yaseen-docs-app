/**
 * THE PILL'S ROOM ON ITS OWN LINE (YAZ-5658), ONE rule for the Mac and the phone. A last cell with text keeps room for
 * the Time in slot pill only on the text lines the pill crosses: two floats at the cell's top, a gap down to those
 * lines, then the room (as wide as the slot's widest text, in each app's CSS). Before, a right padding ran down the
 * whole cell, and a narrow column read one letter per line.
 *
 * A module of its own (YAZ-4965): the Mac loads it only once a page shows a pill with room (`slotRooms.ts`), so it is
 * not in the Mac's first load; the phone imports it as before.
 */
/** The pill's track's top in its cell (both apps' CSS: `clamp(0px, now × height − 10px, height − 20px)`), px. */
const trackTop = (now: number, height: number): number => Math.max(0, Math.min(now * height - 10, height - 20))

/**
 * The pill's room in a cell `height` px tall (its padding box), its padding `padTop` and `padBottom`, its text `line`
 * px a line, the now line `now` (0..1) down the row: the gap above the room and the room's height, both whole lines
 * (the room takes exactly the lines the pill's 20 px cross, so the cell's height moves by whole lines and the place
 * settles), never past the cell's content (the room never makes the row taller).
 */
export function slotRoomAt(now: number, height: number, padTop: number, padBottom: number, line: number): { gap: number; room: number } {
  const top = trackTop(now, height) - padTop
  const first = Math.max(0, Math.floor(top / line + 0.001))
  // `height` is a whole px (`clientHeight`): up to 1 px short of the lines it holds.
  const content = Math.max(1, Math.floor((height - padTop - padBottom + 1) / line))
  const lines = Math.min(content, Math.max(1, Math.ceil((top + 20) / line - 0.001) - first))
  const start = Math.min(first, content - lines)
  return { gap: Math.round(start * line * 10) / 10, room: Math.round(lines * line * 10) / 10 }
}

const tenth = (n: number): number => Math.round(n * 10) / 10

/**
 * YAZ-4965: where the room sits across its cell. A table wider than its scroll box (the phone's Same as Desktop) has
 * its last cell `over` px past the box's visible right edge (the box scrolled to its start); the pill sits at that
 * edge (it used to stick there over the cut text). The room moves in with it: `side` px in from the cell's right end
 * (its right margin), at most to the cell's left. With under 4em of the cell's `content` width left beside it (`em`
 * px), the room takes the rest of its lines too (`fill`, its least width; 0: its own width): no letters squeezed
 * by it. 0 and 0 when the cell ends inside the box.
 */
export function slotSideAt(over: number, content: number, room: number, em: number): { side: number; fill: number } {
  const free = content - room
  if (over <= 0 || free <= 0.5) return { side: 0, fill: 0 }
  const side = Math.min(over, free)
  return { side: tenth(side), fill: free - side < 4 * em ? tenth(content - side) : 0 }
}

/** The pill's place in from the right end of a cell `width` px wide (its padding box): at the visible edge, `over` px in, never past the cell's left (a pill `pill` px wide and its 6 px). */
export const pillSideAt = (over: number, width: number, pill: number): number => (over <= 0 ? 0 : tenth(Math.max(0, Math.min(over, width - pill - 6))))

/** What a box tells of its place (each app passes DOM elements; this module has no DOM). */
interface Boxed {
  getBoundingClientRect(): { left: number; right: number; width: number }
  readonly clientWidth: number
  readonly offsetWidth: number
  readonly clientLeft: number
  readonly scrollLeft: number
}

/** How far `cell`'s right end lies past `box`'s visible right edge with the box scrolled to its start, px (a scaled box: its own px). */
export function overEdge(cell: Boxed, box: Boxed): number {
  const b = box.getBoundingClientRect()
  const scale = box.offsetWidth > 0 && b.width > 0 ? b.width / box.offsetWidth : 1
  return (cell.getBoundingClientRect().right - b.left) / scale - box.clientLeft + box.scrollLeft - box.clientWidth
}

/** What `placeSlotRoom` reads and writes of the DOM (each app passes its elements; this module has no DOM). */
interface Styled {
  readonly style: { height: string; marginRight?: string; minWidth?: string }
}
export interface SlotRoomParts {
  /** The cell's padding-box height (`clientHeight`). */
  readonly height: () => number
  /** The cell's computed padding and line height. */
  readonly look: { readonly paddingTop: string; readonly paddingBottom: string; readonly lineHeight: string; readonly fontSize: string }
  readonly gap: Styled
  readonly room: Styled
  /**
   * YAZ-4965: the room's and the pill's place across the cell (`slotSideAt`, `pillSideAt`): how far the cell runs past
   * its scroll box's visible edge (0: no scroll box), the width its text may take, its padding box's width, the room's
   * and the pill's widths, and where the pill goes (`--slot-side`).
   */
  readonly side?: { over(): number; content(): number; width(): number; room(): number; pill(): number; set(px: string): void }
}

/**
 * Puts the pill's room on the now line (`now`, 0..1 down the row): with `side`, first across (`slotSideAt`); then reads
 * the cell's height and sets the gap's and the room's heights. The text wraps again around the room, which can move
 * the height by a line: a few rounds until it holds. Writes only what changed.
 */
export function placeSlotRoom(now: number, parts: SlotRoomParts): void {
  const padTop = parseFloat(parts.look.paddingTop) || 0
  const padBottom = parseFloat(parts.look.paddingBottom) || 0
  const em = parseFloat(parts.look.fontSize) || 14
  const line = parseFloat(parts.look.lineHeight) || em * 1.4
  if (parts.side !== undefined) {
    // Across first: the room's place changes which words wrap, so the heights below are read after it.
    // The room's own width first (its least width off), then its place.
    if (parts.room.style.minWidth) parts.room.style.minWidth = ''
    const over = parts.side.over()
    const at = slotSideAt(over, parts.side.content(), parts.side.room(), em)
    const margin = `${at.side}px`
    const least = at.fill > 0 ? `${at.fill}px` : ''
    if (parts.room.style.marginRight !== margin) parts.room.style.marginRight = margin
    if (parts.room.style.minWidth !== least) parts.room.style.minWidth = least
    parts.side.set(`${pillSideAt(over, parts.side.width(), parts.side.pill())}px`)
  }
  for (let round = 0; round < 4; round++) {
    const at = slotRoomAt(now, parts.height(), padTop, padBottom, line)
    const gap = `${at.gap}px`
    const room = `${at.room}px`
    if (parts.gap.style.height === gap && parts.room.style.height === room) return
    parts.gap.style.height = gap
    parts.room.style.height = room
  }
}
