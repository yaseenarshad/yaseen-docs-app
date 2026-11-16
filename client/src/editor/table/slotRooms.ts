import { overEdge, placeSlotRoom } from '@shared/slotRoom'

/** The box `cell`'s table scrolls sideways in (Crepe's wrapper), up to the table block; `null` when none scrolls. */
function scrollBox(cell: HTMLElement): HTMLElement | null {
  for (let el = cell.parentElement; el !== null; el = el.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(el).overflowX)) return el
    if (el.classList.contains('milkdown-table-block')) return null
  }
  return null
}

/**
 * Each pill's room in `root` on its now line: reads its cell's height (one cell a table), writes only what changed. A
 * clipped cell (one line, `white-space: nowrap`) has the padding instead: its floats hide.
 */
export function placeSlotRooms(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('.table-slot-floats')) {
    const cell = box.closest<HTMLElement>('th, td')
    const gap = box.querySelector<HTMLElement>('.table-slot-gap')
    const room = box.querySelector<HTMLElement>('.table-slot-room')
    const para = box.parentElement
    if (cell === null || gap === null || room === null || para === null) continue
    const p = getComputedStyle(para)
    const display = p.whiteSpace === 'nowrap' ? 'none' : 'contents'
    if (box.style.display !== display) box.style.display = display
    const anchor = cell.querySelector<HTMLElement>('.table-slot-anchor')
    const setSide = (px: string) => {
      if (anchor !== null && anchor.style.getPropertyValue('--slot-side') !== px) anchor.style.setProperty('--slot-side', px)
    }
    if (display === 'none') {
      setSide('0px')
      continue
    }
    const now = Number(cell.parentElement?.style.getPropertyValue('--table-now') || 0)
    // The cell's paragraph has its own padding above its first line (`table.css`): the lines start under both.
    const c = getComputedStyle(cell)
    const sum = (a: string, b: string) => String((parseFloat(a) || 0) + (parseFloat(b) || 0))
    const look = { paddingTop: sum(c.paddingTop, p.paddingTop), paddingBottom: sum(c.paddingBottom, p.paddingBottom), lineHeight: p.lineHeight, fontSize: p.fontSize }
    // YAZ-4965: a table wider than its box: the room and the pill move in to the box's visible edge (the pill used to
    // stick there over the cut text).
    const scroller = scrollBox(cell)
    const side = {
      over: () => (scroller === null ? 0 : overEdge(cell, scroller)),
      content: () => para.clientWidth - (parseFloat(p.paddingLeft) || 0) - (parseFloat(p.paddingRight) || 0),
      width: () => cell.clientWidth,
      room: () => room.getBoundingClientRect().width,
      pill: () => anchor?.querySelector('.table-slot-pill')?.getBoundingClientRect().width ?? 0,
      set: setSide,
    }
    placeSlotRoom(now, { height: () => cell.clientHeight, look, gap, room, side })
  }
}
