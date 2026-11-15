import { useEffect, useRef } from 'react'
import { propertyLabel, type Group, type Row } from '@client/views/engine'
import { cellText } from '@client/views/exportView'
import { isFolderRow } from '@client/links/folderRows'
import { render } from '@client/views/expr'
import { columnAlignOf } from '@client/views/view/columnAlign'
import { columnFillOf } from '@client/views/view/columnFill'
import { canonicalKey } from '@client/views/view/keys'
import { useApp } from '../app/AppState'
import { openFile } from '../explore/openFile'
import { layoutTables } from '../page/tableLayout'
import { useTables } from '../page/useTables'
import { useVaultLook } from '../page/vaultLook'
import { useVaultData } from '../search/vaultData'
import { rowTarget, type ViewRun } from './folderModel'

/**
 * A FOLDER'S TABLE VIEW ON THE PHONE (YAZ-5460), read only: the rows and the columns the Mac's table shows (the Mac's
 * engine ran it: the same columns in the same order and labels, the same formats, filter, sort and groups), in the
 * phone's own table look (YAZ-5471, YAZ-5480): the header row stays at the top, the Name column at the left, the table
 * scrolls sideways in its box, and ⤢ opens it full screen. The view's own column widths (`columnSize`), alignment,
 * fills and Clip come with it, as a page's table brings the file's (`data-widths`, `align`, `data-fill`, `data-clip`).
 * A group is a header row (its name and count in the Name column, so it stays in sight while the table scrolls
 * sideways), its rows under it, its inner groups after. A tap on a row's Name opens its page (a subfolder's row, its
 * folder's page; a card row, its card) through the one file door.
 *
 * YAZ-5532: a finger on a row bands it, as the Mac's hover band (`rowBand.ts`, the vault's band look): the band follows
 * the finger and stays on the last row after the lift. A tap on the row's Name opens it (its cell at least 44 px tall);
 * a tap on another cell only moves the band; a long press on a cell's text selects in that cell.
 *
 * The table is drawn into its host by hand, as the reader draws a page's table: the phone's table layout
 * (`layoutTables`) wraps and measures it, which React must not see.
 */
export function FolderTable({ run }: { run: ViewRun }) {
  const app = useApp()
  const host = useRef<HTMLDivElement>(null)
  const rows = useRef<Row[]>([])
  // YAZ-5532: the vault's band look (`table-look.json`), as a page's tables.
  const look = useVaultLook(app.services.store, useVaultData())
  useTables(host, look?.table ?? null)
  useEffect(() => {
    const el = host.current
    if (el === null) return
    const { table, drawn } = drawTable(run)
    rows.current = drawn
    el.replaceChildren(table)
    layoutTables(el)
  }, [run])
  // YAZ-5532 (Yaseen picked A): only a tap on the row's Name opens it; a tap elsewhere only moves the band.
  const onClick = (e: React.MouseEvent) => {
    const name = (e.target as Element).closest<HTMLElement>('td[data-name]')
    const tr = name?.closest<HTMLElement>('tr[data-row]') ?? null
    if (tr === null) return
    const row = rows.current[Number(tr.dataset.row)]
    if (row !== undefined) openFile(app, rowTarget(row))
  }
  return <div className="folder-table" ref={host} onClick={onClick} />
}

/** The Mac's view width (px) of a column, else `auto` (`tableLayout`'s `data-widths`). */
const widthOf = (sizes: Record<string, number> | undefined, key: string): string => {
  const c = canonicalKey(key)
  const found = Object.entries(sizes ?? {}).find(([k, v]) => canonicalKey(k) === c && typeof v === 'number' && v > 0)
  return found === undefined ? 'auto' : String(Math.round(found[1]))
}

/** A column the view clips (`columnWrap: false`); the rest wrap between words, as the phone's tables do. */
const clips = (wrap: Record<string, boolean> | undefined, key: string): boolean => Object.entries(wrap ?? {}).some(([k, v]) => v === false && canonicalKey(k) === canonicalKey(key))

/** A table of the view's rows: its header, its groups and rows, its summaries. `drawn`: each row by its `data-row`. */
export function drawTable(run: ViewRun): { table: HTMLTableElement; drawn: Row[] } {
  const { view, def, keys, ctx, groups, result } = run
  const name = keys.find((k) => canonicalKey(k) === 'file.name')
  // The Name column first, as the Mac's table holds it at the left (its own `order` otherwise).
  const columns = name === undefined ? keys : [name, ...keys.filter((k) => k !== name)]
  const table = document.createElement('table')
  table.className = 'folder-table__table'
  table.setAttribute('data-freeze-rows', '1')
  table.setAttribute('data-freeze-cols', String(Math.max(1, Math.min(columns.length, Number(view.frozenColumns) || 1))))
  table.setAttribute('data-widths', columns.map((k) => widthOf(view.columnSize, k)).join(' '))
  const cellOf = (el: HTMLTableCellElement, key: string) => {
    const align = columnAlignOf(view, key)
    if (align !== null) el.setAttribute('align', align)
    const fill = columnFillOf(view, key)
    if (fill !== undefined) el.setAttribute('data-fill', fill === 'gray' ? 'grey' : fill)
    if (clips(view.columnWrap, key)) el.setAttribute('data-clip', '')
    return el
  }
  const head = table.createTHead().insertRow()
  for (const key of columns) {
    const th = cellOf(document.createElement('th'), key)
    th.textContent = propertyLabel(def, key)
    head.append(th)
  }
  const body = table.createTBody()
  const drawn: Row[] = []
  const addRow = (row: Row) => {
    const tr = body.insertRow()
    tr.dataset.row = String(drawn.length)
    drawn.push(row)
    const folder = isFolderRow(row.record)
    if (folder) tr.dataset.folder = ''
    if (row.crossed === true) tr.dataset.crossed = ''
    for (const key of columns) {
      const td = cellOf(document.createElement('td'), key)
      const text = folder && canonicalKey(key) === 'file.name' ? row.record.title : cellText(row, key, ctx)
      td.textContent = text
      if (canonicalKey(key) === 'file.name') td.dataset.name = ''
      tr.append(td)
    }
  }
  const showEmpty = view.showEmptyColumns === true
  const addGroups = (list: readonly Group[], level: number) => {
    for (const g of list) {
      if (g.rows.length === 0 && !showEmpty) continue
      const tr = body.insertRow()
      tr.className = 'folder-table__group'
      tr.dataset.level = String(level)
      const th = document.createElement('th')
      th.scope = 'rowgroup'
      const label = document.createElement('span')
      label.textContent = g.label
      const count = document.createElement('span')
      count.className = 'folder-table__count'
      count.textContent = ` ${g.rows.length}`
      th.append(label, count)
      tr.append(th)
      for (let i = 1; i < columns.length; i++) tr.append(document.createElement('td'))
      for (const row of g.children === undefined ? g.rows : (g.direct ?? [])) addRow(row)
      if (g.children !== undefined) addGroups(g.children, level + 1)
    }
  }
  if (groups === null) for (const row of result.rows) addRow(row)
  else addGroups(groups, 0)
  // The view's summaries (the Mac's foot row): each column's, under it.
  const summaries = Object.keys(result.summaries)
  if (summaries.length > 0) {
    const foot = table.createTFoot().insertRow()
    for (const key of columns) {
      const td = cellOf(document.createElement('td'), key)
      const v = result.summaries[key]
      if (v !== undefined) td.textContent = render(v, ctx.resolve)
      foot.append(td)
    }
  }
  return { table, drawn }
}
