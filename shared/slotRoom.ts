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
  const content = Math.max(1, Math.floor((height - padTop - padBottom) / line + 0.001))
  const lines = Math.min(content, Math.max(1, Math.ceil((top + 20) / line - 0.001) - first))
  const start = Math.min(first, content - lines)
  return { gap: Math.round(start * line * 10) / 10, room: Math.round(lines * line * 10) / 10 }
}

/** What `placeSlotRoom` reads and writes of the DOM (each app passes its elements; this module has no DOM). */
interface Styled {
  readonly style: { height: string }
}
export interface SlotRoomParts {
  /** The cell's padding-box height (`clientHeight`). */
  readonly height: () => number
  /** The cell's computed padding and line height. */
  readonly look: { readonly paddingTop: string; readonly paddingBottom: string; readonly lineHeight: string; readonly fontSize: string }
  readonly gap: Styled
  readonly room: Styled
}

/**
 * Puts the pill's room on the now line (`now`, 0..1 down the row): reads the cell's height and sets the gap's and the
 * room's heights. The text wraps again around the room, which can move the height by a line: a few rounds until it
 * holds. Writes only what changed.
 */
export function placeSlotRoom(now: number, parts: SlotRoomParts): void {
  const padTop = parseFloat(parts.look.paddingTop) || 0
  const padBottom = parseFloat(parts.look.paddingBottom) || 0
  const line = parseFloat(parts.look.lineHeight) || (parseFloat(parts.look.fontSize) || 14) * 1.4
  for (let round = 0; round < 4; round++) {
    const at = slotRoomAt(now, parts.height(), padTop, padBottom, line)
    const gap = `${at.gap}px`
    const room = `${at.room}px`
    if (parts.gap.style.height === gap && parts.room.style.height === room) return
    parts.gap.style.height = gap
    parts.room.style.height = room
  }
}
