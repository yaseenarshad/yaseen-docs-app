import { useEffect, useRef } from 'react'
import { propertyLabel, type Group, type Row } from '@client/views/engine'
import { cellText } from '@client/views/exportView'
import { isFolderRow } from '@client/links/folderRows'
import { render } from '@client/views/expr'
import { columnAlignOf } from '@client/views/view/columnAlign'
import { columnFillOf } from '@client/views/view/columnFill'
import { canonicalKey } from '@client/views/view/keys'
import { useApp } from '../app/AppState'
// A folder page's row is tapped INSIDE a page (`from: 'inside'`): an Explore panel when the vault says explore.
import { openFile } from '../explore/openFile'
import { layoutTables } from '../page/tableLayout'
import { useTables } from '../page/useTables'
import { useVaultLook } from '../page/vaultLook'
import { useVaultData } from '../search/vaultData'
import { foldKeyOf } from '../store/folderFolds'
import { rowTarget, type ViewRun } from './folderModel'

/**
 * A FOLDER'S TABLE VIEW ON THE PHONE, read only: the rows and the columns the Mac's table shows (the Mac's
 * engine ran it: the same columns in the same order and labels, the same formats, filter, sort and groups), in the
 * phone's own table look: the header row stays at the top, the Name column at the left, the table
 * scrolls sideways in its box, and ⤢ opens it full screen. The view's own column widths (`columnSize`), alignment,
 * fills and Clip come with it, as a page's table brings the file's (`data-widths`, `align`, `data-fill`, `data-clip`).
 * A group is a header row (its name and count in the Name column, so it stays in sight while the table scrolls
 * sideways), its rows under it, its inner groups after. A tap on a row's Name opens its page (a subfolder's row, its
 * folder's page; a card row, its card) through the one file door.
 *
 * A finger on a row bands it, as the Mac's hover band (`rowBand.ts`, the vault's band look): the band follows
 * the finger and stays on the last row after the lift. A tap on the row's Name opens it (its cell at least 44 px tall);
 * a tap on another cell only moves the band; a long press on a cell's text selects in that cell.
 *
 * YAZ-5549: the Mac's table look from the vault's folder page defaults (`.yaseendocs/folder-pages.json`, filled into the
 * view by `withDefaults`; a view's own key first): the row height (Short 28, Medium 44, Tall 68 px, the Mac's
 * `ROW_HEIGHTS`, each body cell's least height), the `#` column of row numbers (1 up, again from 1 under each group,
 * the Mac's gutter; none when the view says no numbers: the Mac's slim strip is its drag handle, and the phone does
 * not drag), and a subfolder row's "N inside" (`ViewRun.inside`). The Name cell stays at least 44 px (YAZ-5532: a
 * finger's tap): a taller row height wins; Short keeps the Name cell, so its row, at 44 px.
 *
 * YAZ-5598: a group row folds, as the Mac's: its ⌄ (a 44 px tap) hides the group's rows and the groups inside it, and
 * turns to › while folded; its count stays. The folded groups come from `FolderViewPane` (`folderFolds.ts`: this
 * phone's own, per vault, folder and view), which also holds the collapse all / expand all button. A redraw keeps the
 * table's sideways scroll.
 *
 * The table is drawn into its host by hand, as the reader draws a page's table: the phone's table layout
 * (`layoutTables`) wraps and measures it, which React must not see.
 */
export function FolderTable({ run, folded = NONE_FOLDED, onFold }: { run: ViewRun; folded?: readonly string[]; onFold?: (key: string) => void }) {
  const app = useApp()
  const host = useRef<HTMLDivElement>(null)
  const rows = useRef<Row[]>([])
  // The vault's band look (`table-look.json`), as a page's tables.
  const look = useVaultLook(app.services.store, useVaultData())
  useTables(host, look?.table ?? null)
  useEffect(() => {
    const el = host.current
    if (el === null) return
    const left = el.querySelector('.page-table')?.scrollLeft ?? 0
    const { table, drawn } = drawTable(run, new Set(folded))
    rows.current = drawn
    el.replaceChildren(table)
    layoutTables(el)
    const box = el.querySelector('.page-table')
    if (box !== null && left > 0) box.scrollLeft = left
  }, [run, folded])
  // Only a tap on the row's Name opens it; a tap elsewhere only moves the band. A group's ⌄ folds it.
  const onClick = (e: React.MouseEvent) => {
    const fold = (e.target as Element).closest<HTMLElement>('.folder-table__fold')
    const gk = fold?.closest<HTMLElement>('tr[data-gk]')?.dataset.gk
    if (gk !== undefined) {
      onFold?.(gk)
      return
    }
    const name = (e.target as Element).closest<HTMLElement>('td[data-name]')
    const tr = name?.closest<HTMLElement>('tr[data-row]') ?? null
    if (tr === null) return
    const row = rows.current[Number(tr.dataset.row)]
    if (row !== undefined) openFile(app, rowTarget(row), { from: 'inside' })
  }
  return <div className="folder-table" ref={host} onClick={onClick} />
}

const NONE_FOLDED: readonly string[] = []

/** The Mac's view width (px) of a column, else `auto` (`tableLayout`'s `data-widths`). */
const widthOf = (sizes: Record<string, number> | undefined, key: string): string => {
  const c = canonicalKey(key)
  const found = Object.entries(sizes ?? {}).find(([k, v]) => canonicalKey(k) === c && typeof v === 'number' && v > 0)
  return found === undefined ? 'auto' : String(Math.round(found[1]))
}

/** A column the view clips (`columnWrap: false`); the rest wrap between words, as the phone's tables do. */
const clips = (wrap: Record<string, boolean> | undefined, key: string): boolean => Object.entries(wrap ?? {}).some(([k, v]) => v === false && canonicalKey(k) === canonicalKey(key))

/** The Mac's row heights (px, `TableView.tsx`'s `ROW_HEIGHTS`): a view's `rowHeight`, Short when it names none. */
export const ROW_HEIGHTS: Readonly<Record<string, number>> = { short: 28, medium: 44, tall: 68 }

/**
 * A table of the view's rows: its header, its groups and rows, its summaries. `drawn`: each row by its `data-row`.
 * `folded`: the groups folded (YAZ-5598, `foldKeyOf`): the header row stays, its rows and inner groups do not.
 */
export function drawTable(run: ViewRun, folded: ReadonlySet<string> = new Set()): { table: HTMLTableElement; drawn: Row[] } {
  const { view, def, keys, ctx, groups, result, inside } = run
  const name = keys.find((k) => canonicalKey(k) === 'file.name')
  // The Name column first, as the Mac's table holds it at the left (its own `order` otherwise).
  const columns = name === undefined ? keys : [name, ...keys.filter((k) => k !== name)]
  // YAZ-5549: the Mac's `#` column, first, unless the view says no row numbers.
  const numbered = view.rowNumbers !== false
  const gutter = numbered ? 1 : 0
  const table = document.createElement('table')
  table.className = 'folder-table__table'
  table.setAttribute('data-freeze-rows', '1')
  table.setAttribute('data-freeze-cols', String(gutter + Math.max(1, Math.min(columns.length, Number(view.frozenColumns) || 1))))
  table.setAttribute('data-widths', [...(numbered ? ['auto'] : []), ...columns.map((k) => widthOf(view.columnSize, k))].join(' '))
  const rowHeight = ROW_HEIGHTS[view.rowHeight ?? ''] ?? ROW_HEIGHTS.short!
  table.dataset.rowHeight = String(rowHeight)
  table.style.setProperty('--folder-row-h', `${rowHeight}px`)
  /** The `#` cell of a line: its number, or none (a header, a group, the foot). */
  const numberCell = (tag: 'th' | 'td', text = '') => {
    const el = document.createElement(tag)
    el.className = 'folder-table__num'
    el.textContent = text
    return el
  }
  const cellOf = (el: HTMLTableCellElement, key: string) => {
    const align = columnAlignOf(view, key)
    if (align !== null) el.setAttribute('align', align)
    const fill = columnFillOf(view, key)
    if (fill !== undefined) el.setAttribute('data-fill', fill === 'gray' ? 'grey' : fill)
    if (clips(view.columnWrap, key)) el.setAttribute('data-clip', '')
    return el
  }
  const head = table.createTHead().insertRow()
  if (numbered) head.append(numberCell('th', '#'))
  for (const key of columns) {
    const th = cellOf(document.createElement('th'), key)
    th.textContent = propertyLabel(def, key)
    head.append(th)
  }
  const body = table.createTBody()
  const drawn: Row[] = []
  /** The Mac's line number: from 1, again from 1 under each group header. */
  let n = 0
  const addRow = (row: Row) => {
    const tr = body.insertRow()
    tr.dataset.row = String(drawn.length)
    drawn.push(row)
    const folder = isFolderRow(row.record)
    if (folder) tr.dataset.folder = ''
    if (row.crossed === true) tr.dataset.crossed = ''
    if (numbered) tr.append(numberCell('td', String(++n)))
    for (const key of columns) {
      const td = cellOf(document.createElement('td'), key)
      const text = folder && canonicalKey(key) === 'file.name' ? row.record.title : cellText(row, key, ctx)
      td.textContent = text
      if (canonicalKey(key) === 'file.name') {
        td.dataset.name = ''
        if (folder && inside !== null) td.append(insideCount(inside(row)))
      }
      tr.append(td)
    }
  }
  const showEmpty = view.showEmptyColumns === true
  const addGroups = (list: readonly Group[], level: number, parents: readonly Group[]) => {
    for (const g of list) {
      if (g.rows.length === 0 && !showEmpty) continue
      const tr = body.insertRow()
      tr.className = 'folder-table__group'
      tr.dataset.level = String(level)
      const gk = foldKeyOf(g, parents)
      const shut = folded.has(gk)
      tr.dataset.gk = gk
      if (shut) tr.dataset.folded = ''
      if (numbered) tr.append(numberCell('td'))
      n = 0
      const th = document.createElement('th')
      th.scope = 'rowgroup'
      const label = document.createElement('span')
      label.textContent = g.label
      const count = document.createElement('span')
      count.className = 'folder-table__count'
      count.textContent = ` ${g.rows.length}`
      th.append(foldButton(g.label, !shut), label, count)
      tr.append(th)
      for (let i = 1; i < columns.length; i++) tr.append(document.createElement('td'))
      if (shut) continue
      for (const row of g.children === undefined ? g.rows : (g.direct ?? [])) addRow(row)
      if (g.children !== undefined) addGroups(g.children, level + 1, [...parents, g])
    }
  }
  if (groups === null) for (const row of result.rows) addRow(row)
  else addGroups(groups, 0, [])
  // The view's summaries (the Mac's foot row): each column's, under it.
  const summaries = Object.keys(result.summaries)
  if (summaries.length > 0) {
    const foot = table.createTFoot().insertRow()
    if (numbered) foot.append(numberCell('td'))
    for (const key of columns) {
      const td = cellOf(document.createElement('td'), key)
      const v = result.summaries[key]
      if (v !== undefined) td.textContent = render(v, ctx.resolve)
      foot.append(td)
    }
  }
  return { table, drawn }
}

const SVG = 'http://www.w3.org/2000/svg'
/** A group row's ⌄ (YAZ-5598, the Mac's `view-group__toggle`): open, it points down; folded, right (CSS). */
function foldButton(label: string, open: boolean): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'folder-table__fold'
  button.setAttribute('aria-expanded', String(open))
  button.setAttribute('aria-label', `Toggle group ${label}`)
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', 'm4 6 4 4 4-4')
  svg.append(path)
  button.append(svg)
  return button
}

/** A subfolder row's "N inside" (the Mac's `view-folder-row__inside`), after its title. */
export function insideCount(n: number): HTMLElement {
  const span = document.createElement('span')
  span.className = 'folder-inside'
  span.textContent = `${n} inside`
  return span
}
