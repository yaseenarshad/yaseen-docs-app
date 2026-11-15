/**
 * Where you are in a grouped folder table (YAZ-4798): sticky group headers and group lines, as the sidebar shows its
 * open folders (sticky folders YAZ-3440, level lines and the thread YAZ-3309).
 *
 * A folder page's table does not scroll by itself: the tab's scroller moves it, and TableView already pins the column
 * header with a counter-scroll offset, `--view-table-header-y` (`lib/pinnedHeader.ts`; native `position: sticky`
 * cannot, the wrap is the sideways scroll box). A stuck group header rides the SAME offset, in CSS only: each header
 * row carries two numbers, measured when the table changes and never on a scroll, and views.css turns them into its
 * place:
 *
 * - `--view-group-lift`: the offset at which the row reaches its slot, negated. Its slot is under the column header and
 *   the frozen rows, one row height per level above it (`slot`): `translateY(header-y + lift)` holds it there.
 * - `--view-group-room`: the most it moves, so the group's last row pushes it, and the stuck headers of the levels
 *   inside it, out together, as VS Code's sticky scroll and the sidebar's sticky folders do. A header pushed out is
 *   clipped at its slot's top (`clip-path`), so it passes UNDER the level above it, never over it.
 *
 * The group lines are one line per open group (`.view-table__lines`, in the table's caption so it spans the table's
 * width and sticks at the left as the group headers do), from under its header's chevron to its last row's bottom.
 */

/** A group header line's span in the table's flat list of lines. */
export interface GroupSpan {
  /** The header's line index. */
  at: number
  /** Its level, 0 at the top. */
  depth: number
  /** Its place in the sticky stack: its level, less the levels above it whose headers are frozen rows. */
  slot: number
  /** The group's last line (the header itself when the group is collapsed or empty). */
  last: number
  /** The level of the innermost group that holds the last line: the headers from `depth` to it leave together. */
  endDepth: number
  /** The header line index of the group that holds this one; -1 at the top. */
  parent: number
}

/**
 * Each group header's span (YAZ-4798), from each line's header level (null for a data row or a "+ New" row), and the
 * header line index of the innermost group that holds each line (-1 for none; a header's is its parent's). `pinned`
 * lines from the top are the frozen rows: they do not stick again.
 */
export function groupSpans(depths: readonly (number | null)[], pinned: number): { spans: GroupSpan[]; holder: Int32Array } {
  const spans: GroupSpan[] = []
  const holder = new Int32Array(depths.length).fill(-1)
  const inner = new Int32Array(depths.length)
  const stack: GroupSpan[] = []
  depths.forEach((depth, j) => {
    if (depth !== null) {
      while (stack.length > 0 && stack.at(-1)!.depth >= depth) stack.pop()!.last = j - 1
      const parent = stack.at(-1)?.at ?? -1
      const frozenAbove = stack.filter((s) => s.at < pinned).length
      const span: GroupSpan = { at: j, depth, slot: depth - frozenAbove, last: j, endDepth: depth, parent }
      spans.push(span)
      holder[j] = parent
      inner[j] = depth
      stack.push(span)
    } else {
      holder[j] = stack.at(-1)?.at ?? -1
      inner[j] = stack.at(-1)?.depth ?? 0
    }
  })
  for (const s of stack) s.last = depths.length - 1
  for (const s of spans) s.endDepth = inner[s.last]
  return { spans, holder }
}

/** The header lines that hold line `j`, innermost first. */
export function holdersOf(holder: Int32Array, j: number): number[] {
  const out: number[] = []
  for (let h = j >= 0 && j < holder.length ? holder[j] : -1; h !== -1; h = holder[h]) out.push(h)
  return out
}

/** How far the stuck stack below `span` reaches when its group ends, in rows: itself and the levels inside it to `endDepth`. */
const stackRows = (span: GroupSpan): number => 1 + span.endDepth - span.depth

/**
 * A windowed table's numbers (every line is one row height, YAZ-4636): for a header row mounted at line place `dom`
 * (its own index, or a place under the frozen rows when it is lifted above the window, below), in px.
 */
export function windowedGuide(span: GroupSpan, dom: number, pinned: number, rowH: number): { lift: number; room: number } {
  return { lift: (pinned + span.slot - dom) * rowH, room: Math.max(0, (span.last + 1 - stackRows(span) - dom) * rowH) }
}

/** A line's top in the table (offsetTop: no transform counts), whether its row is positioned or not. */
function topIn(table: HTMLElement, tr: HTMLElement): number {
  return tr.offsetParent === table ? tr.offsetTop : tr.offsetTop - table.offsetTop
}

/** Where a group's line starts: under its header's chevron (14px, in the middle of the row), with a pixel of air. */
const LINE_START = 8

/**
 * Measures a table that mounts every line (not windowed) and writes each span's numbers: the lift and the room on its
 * header row, the top and height on its line. Reads offsets only, so a stuck row's transform never counts. Returns
 * false when the rows are not the lines in order (then it writes nothing).
 */
export function measureGroupGuides(table: HTMLTableElement, spans: readonly GroupSpan[], pinned: number, rowH: number): boolean {
  const body = table.tBodies[0]
  if (body === undefined) return false
  const rows = body.rows
  const at = (j: number): HTMLElement | null => {
    const tr = rows[j]
    return tr !== undefined && tr.dataset.line === String(j) ? tr : null
  }
  const lineEls = new Map<number, HTMLElement>()
  for (const el of table.querySelectorAll<HTMLElement>('.view-table__lines > [data-seg]')) lineEls.set(Number(el.dataset.seg), el)
  const head = table.tHead?.offsetHeight ?? 0
  const stickRow = at(pinned)
  const stick = stickRow === null ? head : topIn(table, stickRow)
  for (const span of spans) {
    const tr = at(span.at)
    const end = at(span.last)
    if (tr === null || end === null) return false
    const top = topIn(table, tr)
    const bottom = topIn(table, end) + end.offsetHeight
    if (span.at >= pinned) {
      tr.style.setProperty('--view-group-lift', `${stick + span.slot * rowH - top}px`)
      tr.style.setProperty('--view-group-room', `${Math.max(0, bottom - stackRows(span) * rowH - top)}px`)
    }
    const line = lineEls.get(span.at)
    if (line !== undefined) {
      const start = top + tr.offsetHeight / 2 + LINE_START
      line.style.setProperty('--view-line-top', `${start}px`)
      line.style.setProperty('--view-line-h', `${Math.max(0, bottom - start)}px`)
    }
  }
  return true
}

/** A windowed table's line for `span`: from under its header's chevron to its last row, every line one row high. */
export const windowedLine = (span: GroupSpan, rowH: number): { top: number; height: number } => ({
  top: span.at * rowH + rowH / 2 + LINE_START,
  height: (span.last + 1 - span.at) * rowH - rowH / 2 - LINE_START,
})

/**
 * "On hover" (YAZ-4798, as the sidebar's `levelLinesHover.ts`): `data-mouse-in` on the lines' own box while the
 * pointer is over the table. Never on the table or a row: a state on an ancestor of the rows restyles every row below
 * it (bug YAZ-3329); the lines' box holds only the lines. `mouseenter` / `mouseleave`, not the pointer events, so the
 * lines do not hide when a row drag starts. Returns the cleanup, which also clears the mark.
 */
export function groupLinesHover(table: HTMLElement): () => void {
  let inside = false
  const set = (on: boolean) => {
    inside = on
    const box = table.querySelector('.view-table__lines')
    if (box === null || box.hasAttribute('data-mouse-in') === on) return
    if (on) box.setAttribute('data-mouse-in', '')
    else box.removeAttribute('data-mouse-in')
  }
  const enter = () => set(true)
  const leave = () => set(false)
  table.addEventListener('mouseenter', enter)
  table.addEventListener('mouseleave', leave)
  if (table.matches(':hover')) enter()
  return () => {
    table.removeEventListener('mouseenter', enter)
    table.removeEventListener('mouseleave', leave)
    if (inside) set(false)
  }
}

/**
 * Thread (YAZ-4798, as the sidebar's YAZ-3309 D7): the headers and lines of the groups that hold the row under the
 * pointer carry `data-on-path`. One delegated listener on the body, as `threadPath.ts`: only the marks that join or
 * leave the path are written, so a move inside one row writes nothing and the rows never re-render. `holder` is read
 * at each move, the table's latest. Returns the cleanup, which also clears the marks.
 */
export function groupThread(table: HTMLElement, holder: () => Int32Array): () => void {
  let marked: Element[] = []
  let lastLine = -2
  const mark = (next: Element[]) => {
    for (const el of marked) if (!next.includes(el)) el.removeAttribute('data-on-path')
    for (const el of next) if (!marked.includes(el)) el.setAttribute('data-on-path', '')
    marked = next
  }
  const over = (e: MouseEvent) => {
    const tr = e.target instanceof Element ? e.target.closest<HTMLElement>('tbody > tr[data-line]') : null
    const j = tr === null ? -1 : Number(tr.dataset.line)
    if (j === lastLine) return
    lastLine = j
    const next: Element[] = []
    for (const h of holdersOf(holder(), j)) {
      const header = table.querySelector(`tbody > tr[data-line="${h}"]`)
      const line = table.querySelector(`.view-table__lines > [data-seg="${h}"]`)
      if (header !== null) next.push(header)
      if (line !== null) next.push(line)
    }
    mark(next)
  }
  const leave = () => {
    lastLine = -2
    mark([])
  }
  table.addEventListener('mouseover', over)
  table.addEventListener('mouseleave', leave)
  return () => {
    table.removeEventListener('mouseover', over)
    table.removeEventListener('mouseleave', leave)
    mark([])
  }
}

/**
 * A click on a stuck group header (YAZ-4798): the scroll that puts the header back at its own place, at the top of its
 * group's rows. The distance is the header's offset now, `header-y + lift`, in the table's px; 0 when it is not stuck.
 */
export function stuckDistance(wrap: HTMLElement, tr: HTMLElement): number {
  const y = parseFloat(wrap.style.getPropertyValue('--view-table-header-y')) || 0
  const lift = parseFloat(tr.style.getPropertyValue('--view-group-lift'))
  return Number.isFinite(lift) ? Math.max(0, y + lift) : 0
}
