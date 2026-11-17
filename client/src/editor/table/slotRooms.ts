import { placeSlotRoom } from '@shared/slotRoom'

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
    if (display === 'none') continue
    const now = Number(cell.parentElement?.style.getPropertyValue('--table-now') || 0)
    // The cell's paragraph has its own padding above its first line (`table.css`): the lines start under both.
    const c = getComputedStyle(cell)
    const sum = (a: string, b: string) => String((parseFloat(a) || 0) + (parseFloat(b) || 0))
    const look = { paddingTop: sum(c.paddingTop, p.paddingTop), paddingBottom: sum(c.paddingBottom, p.paddingBottom), lineHeight: p.lineHeight, fontSize: p.fontSize }
    placeSlotRoom(now, { height: () => cell.clientHeight, look, gap, room })
  }
}
