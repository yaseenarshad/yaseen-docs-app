import { createContext, Fragment, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { useUnit } from '../../vault/unitWord'
import { ImageOf } from './imageCell'
import { isFolderRow, isShortcut } from '../../links/shortcuts'
import { HIGHLIGHT_HEX } from '../../editor/marks/highlightColours'
import { type ViewSet, type ViewDef, type GroupBySpec, shownGroupLevels } from '../viewSchema'
import { type Row, propertyLabel } from '../engine'
import { isFolderSettingsPath, type PropertyDecl } from '@shared/types'
import { basename, dirname } from '../../lib/paths'
import { fileKind } from '@shared/fileKind'
import { FileIcon } from '../../sidebar/FileIcon'
import { DateValue, ErrorValue, FileValue, LinkValue, type Resolver, type Value, fromYaml, linkText, render } from '../expr'
import { formatDateValue, formatNumber } from '../columnFormat'
import { WIKILINK_RE } from '@shared/linkRewrite'
import '../../editor/wikilink/wikilink.css'
import type { PathInfo } from '../../editor/wikilink/linkPillLook'
import { PillEnds } from '../../editor/wikilink/LinkPillParts'
import { summarize } from '../summaries'
import { FolderIcon, ShortcutIcon } from './icons'
import { HoverTip } from '../../components/HoverTip'
import { canonicalKey } from './keys'
import { GroupHeaderMenu } from './GroupHeaderMenu'
import { OtherFilesFolderMove } from './otherFilesMove'
import { GroupLevelStepsContext } from '../groupLevelSteps'

/**
 * One group's header content (4C, GRO-2137), shared by Table today and Cards / List / Board
 * later: chevron collapse toggle, the group value rendered by type, count, and the per-group
 * summaries (recomputed over the group's SHOWN rows, like the table's total row in 4B).
 */

/**
 * Stable string identity for one group, the key persisted in the app state's `baseGroups`:
 * `∅` for the trailing "No value" group, `v:<render(key)>` otherwise (the prefix keeps any
 * rendered value from colliding with the sentinel). Deterministic across sessions — and `render`
 * with NO resolver on purpose (YAZ-2293 D8): the key is the link as STORED, `v:[[<id>]]`, so
 * renaming the note a group is headed by never reopens the group.
 */
export const groupKeyOf = (key: Value | null): string => (key === null ? '∅' : `v:${render(key)}`)

/**
 * The same identity at ANY level (YAZ-745, YAZ-4531): the `groupKeyOf` of each ancestor, outer
 * first, then the group's own, joined by U+001F — so the same value under two parents collapses
 * independently, a top-level key is plain `groupKeyOf`, and an inner key stored when there were
 * two levels (outer, U+001F, inner) still names its group. It is persisted in `baseGroups`, so the
 * encoding is a contract.
 */
export const groupPathKeyOf = (keys: readonly (Value | null)[]): string => keys.map(groupKeyOf).join('\u001f')

/** The stored summary kind for a column, whichever key form (`priority` / `note.priority`) the file uses. */
export function summaryKindOf(view: ViewDef, key: string): string | undefined {
  const s = view.summaries
  if (s === undefined) return undefined
  const k = Object.keys(s).find((x) => canonicalKey(x) === canonicalKey(key))
  return k !== undefined && typeof s[k] === 'string' ? s[k] : undefined
}

/** One value inside a list / link cell (shared with TableView's cells); through `resolve`, an id link reads as its note's title (`linkText`, YAZ-2293 D8). */
export function chip(v: Value, key?: number, resolve?: Resolver) {
  if (v instanceof LinkValue || v instanceof FileValue) return <LinkChip key={key} link={v} resolve={resolve} />
  const text = render(v, resolve)
  return (
    <span key={key} className="view-table__chip" title={text}>
      {text}
    </span>
  )
}

/**
 * A folder page's cells show links as pills (YAZ-4601 D47): `ViewsPane` turns this on, and its delegated handlers
 * open and preview a pill by its `data-link-path`. Off (the properties panel) a link keeps its plain chip.
 */
export const LinkPills = createContext(false)

/**
 * A link value (YAZ-4601 D47): the note editor's wikilink pill on the page it resolves to, by its title. A link that
 * resolves to nothing has no pill and no path: it reads as the editor's unresolved link. Off a folder page: the chip.
 */
function LinkChip({ link, resolve }: { link: LinkValue | FileValue; resolve?: Resolver }) {
  const pills = useContext(LinkPills)
  const text = link instanceof LinkValue ? linkText(link, resolve) : link.record.title
  if (!pills)
    return (
      <span className="view-table__chip view-table__chip--link" title={text}>
        {text}
      </span>
    )
  const record = link instanceof FileValue ? link.record : resolve?.(link.target)?.record
  return record === undefined ? (
    <span className="wikilink wikilink--unresolved view-link-pill" title={text}>
      <PillEnds text={text} />
    </span>
  ) : (
    <PillWithIcon path={record.path} text={text} info={record.id === undefined ? { folder: record.folder } : { id: record.id, folder: record.folder }} />
  )
}

/**
 * A resolved pill with the icon its page has in the sidebar (YAZ-4544 4G), as the note editor's pill has (YAZ-3609
 * D13): a `FileIcon` inside the pill, before the name and after the head piece (YAZ-4924), so the pill reads as the
 * note's. Settings › File icons reach it through the app's CSS (`data-sidebar-file-icons`) and `IconsContext`, as
 * they reach the note's pills.
 */
function PillWithIcon({ path, text, info }: { path: string; text: string; info?: PathInfo }) {
  // A folder resolves to its directory, the editor's rule (no file kind); a folder row's page is its `.folder.md`.
  const settings = isFolderSettingsPath(path)
  const folder = settings || fileKind(basename(path)) === null
  return (
    <span className="wikilink view-link-pill" data-link-path={path} title={text}>
      <PillEnds text={text} info={info} icon={<FileIcon path={settings ? dirname(path) : path} folder={folder} />} />
    </span>
  )
}

/**
 * A text value with inline `[[links]]` (YAZ-4601 D48): its text, each link a pill (`LinkChip`). No editor mounts; an
 * embed (`![[…]]`) stays text. Off a folder page, the text as it is.
 */
function InlineLinks({ text, resolve }: { text: string; resolve?: Resolver }) {
  const pills = useContext(LinkPills)
  if (!pills) return <>{text}</>
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(WIKILINK_RE)) {
    const link = m[1] === '' ? fromYaml(m[0]) : null
    if (!(link instanceof LinkValue)) continue
    parts.push(text.slice(last, m.index), <LinkChip key={m.index} link={link} resolve={resolve} />)
    last = m.index + m[0].length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

/**
 * The page's TITLE wherever a skin shows its `file.name` column (YAZ-1513/1549): the record's
 * `title` (YAZ-2420 🔒 D14), never the file name — one spelling for the table's name cell, the
 * board's card title, the card's title and the list's primary. `file.name`'s VALUE is the title
 * too (🔒 D18), so the column sorts and filters by what it shows. A row that is in the folder
 * by a SHORTCUT (YAZ-2290 D2) wears the mark after it — here, so every skin marks it alike.
 */
export const rowTitle = (row: Row): ReactNode => <RowTitle row={row} />

/** The folder whose rows the skins are drawing, as the index names it; null (no folder host) marks nothing. */
export const ViewFolder = createContext<string | null>(null)

/**
 * The page's folders for the Folder column and the Folder group headers (YAZ-4564 D26/D27), from `ViewsPane`:
 * the page's folder as the index names it, a folder's title as its Folder group is headed, and the door that
 * opens a folder's page in a new tab (absent: nothing opens). Null outside a folder page.
 */
export interface FolderPagesValue {
  folder: string
  title: (dir: string) => string
  open?: (dir: string) => void
  /** How many notes a folder's page shows (YAZ-4579 D32): a folder row's "N inside". */
  inside?: (dir: string) => number
  /** The view's "Folder icon" and "Notes inside count" (YAZ-4848), Settings filled in: ONE place reads them (`ViewsPane`). */
  folderIcons: boolean
  folderCounts: boolean
  /** The Folder column's look (YAZ-4801): the path from the page, or the last folder only (the look before). */
  folderColumn?: 'path' | 'full' | 'last'
}
export const FolderPages = createContext<FolderPagesValue | null>(null)

/**
 * The folder's column declarations, by bare name (YAZ-4591): a Number or Date cell reads its column's
 * `format` here. Provided around the views alone (`ViewsPane`), so a note's own properties panel —
 * the note window's included — shows its values as stored.
 */
export const ColumnDecls = createContext<Readonly<Record<string, PropertyDecl>>>({})

/** The `file.folder` column (YAZ-4564 D26): every view draws its cell here; a note key's through its column's format (YAZ-4591), the rest through `cellContent`. */
export const rowCell = (row: Row, key: string, resolve?: Resolver): ReactNode => {
  const c = canonicalKey(key)
  if (c === 'file.folder') return <FolderCell row={row} value={row.values[key]} resolve={resolve} />
  if (c.startsWith('note.')) return <NoteCell value={row.values[key]} name={c.slice('note.'.length)} resolve={resolve} />
  return cellContent(row.values[key], resolve)
}

/** The pills a Linked mentions cell shows (YAZ-4738 L3); the rest are "+N", their titles in its tooltip. */
export const MENTIONS_SHOWN = 3

function NoteCell({ value, name, resolve }: { value: Value; name: string; resolve?: Resolver }) {
  const decl = useContext(ColumnDecls)[name]
  // An Image column's picture (YAZ-4802), at its column's size and shape: a board card's line, a read-only cell.
  if (decl?.kind === 'image') return <ImageOf value={value} decl={decl} />
  if (decl?.kind === 'mentions' && Array.isArray(value) && value.length > MENTIONS_SHOWN) {
    const rest = value.slice(MENTIONS_SHOWN)
    return (
      <>
        {value.slice(0, MENTIONS_SHOWN).map((item, i) => chip(item, i, resolve))}
        <span className="view-table__chip view-mentions__more" title={rest.map((item) => (item instanceof LinkValue ? linkText(item, resolve) : render(item, resolve))).join('\n')}>
          +{rest.length}
        </span>
      </>
    )
  }
  return <>{cellContent(value, resolve, decl)}</>
}

/**
 * The chip of the folder the note lives in, by the title its Folder group shows (YAZ-4801 demo: "how come no folder
 * showing up here?" — a note directly in the page shows the page, never a blank). A click opens that folder's page,
 * the vault root's too (YAZ-4921: `absFrom(root, '')` is the root itself).
 */
function FolderCell({ row, value, resolve }: { row: Row; value: Value; resolve?: Resolver }) {
  const pages = useContext(FolderPages)
  if (pages === null) return <>{cellContent(value, resolve)}</>
  const dir = row.record.folder
  if (pages.folderColumn !== 'last') return <FolderPath dir={dir} pages={pages} />
  const title = pages.title(dir)
  const open = pages.open
  if (open === undefined) return <span className="view-table__chip" title={title}>{title}</span>
  return (
    <button
      type="button"
      className="view-table__chip view-table__chip--link view-folder-chip"
      title={title}
      onClick={(e) => {
        e.stopPropagation() // a board card's click opens the card
        open(dir)
      }}
    >
      {title}
    </button>
  )
}

/**
 * The Folder column as a path (YAZ-4801: "the breadcrumb … wouldnt u want to know what category (aka page) that thing is
 * in regardless?"): the folders from this page down to the note's, by title, each a link to its page, › between. A
 * note that lives outside this page (a shortcut) shows where it lives from the vault's top, after ↗. A narrow column
 * lets the middle parts shrink to "…"; the last part keeps its width.
 */
function FolderPath({ dir, pages }: { dir: string; pages: FolderPagesValue }) {
  const inside = pages.folder === '' || dir === pages.folder || dir.startsWith(`${pages.folder}/`)
  // Every folder from the vault's top down to the note's; "From this page" (YAZ-4801 demo: "does it hide recipes?")
  // starts at the page itself, "Full path" and a note outside the page keep them all.
  const all = dir.split('/').filter(Boolean).map((_, i, segs) => segs.slice(0, i + 1).join('/'))
  const from = inside && pages.folderColumn !== 'full' && pages.folder !== '' ? all.indexOf(pages.folder) : 0
  const parts = all.slice(Math.max(0, from))
  if (parts.length === 0) return null
  const whole = parts.map((p) => pages.title(p)).join(' › ')
  return (
    <span className="view-folder-path" title={inside ? whole : `Lives in ${whole}`}>
      {!inside && <ShortcutIcon />}
      {parts.map((p, i) => (
        <Fragment key={p}>
          {i > 0 && <span className="view-folder-path__sep" aria-hidden="true">›</span>}
          {pages.open === undefined ? (
            <span className={`view-table__chip view-folder-path__part${i === parts.length - 1 ? ' view-folder-path__part--last' : ''}`}>{pages.title(p)}</span>
          ) : (
            <button
              type="button"
              className={`view-table__chip view-table__chip--link view-folder-chip view-folder-path__part${i === parts.length - 1 ? ' view-folder-path__part--last' : ''}`}
              onClick={(e) => {
                e.stopPropagation() // a board card's click opens the card
                pages.open!(p)
              }}
            >
              {pages.title(p)}
            </button>
          )}
        </Fragment>
      ))}
    </span>
  )
}

function RowTitle({ row }: { row: Row }) {
  const folder = useContext(ViewFolder)
  const pages = useContext(FolderPages)
  // A subfolder's row (YAZ-4579 D32): the folder icon, its title, and how many notes its page shows; each one the
  // view's switch (YAZ-4848: the icon on, the count off by default).
  if (isFolderRow(row.record)) {
    // Outside a folder page (no context) a folder row shows its icon and no count, as the defaults say.
    const inside = pages?.folderCounts ? pages.inside?.(folderOfRow(row.record)) : undefined
    return (
      <>
        {(pages?.folderIcons ?? true) && <FolderIcon size={13} className="view-folder-row__icon" />}
        {row.record.title}
        {inside !== undefined && <span className="view-folder-row__inside">{inside} inside</span>}
      </>
    )
  }
  return (
    <>
      {row.record.title}
      {/* YAZ-4797 demo: the ↗ says where the note lives, on hover. */}
      {folder !== null && isShortcut(row.record, folder) && (
        <HoverTip className="view-shortcut-tip" text={`Shortcut. Lives in ${row.record.folder === '' ? 'the vault' : row.record.folder.split('/').join(' › ')}`}>
          <ShortcutIcon />
        </HoverTip>
      )}
    </>
  )
}

/** A folder row's own folder as the index names it: its parent (the row's `folder`), then its directory's name. */
const folderOfRow = ({ path, folder }: Row['record']): string => {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const name = dir.slice(dir.lastIndexOf('/') + 1)
  return folder === '' ? name : `${folder}/${name}`
}

/**
 * Typed cell body (shared by table cells and board cards): error chip, read-only checkbox (editing is 5B), chips for lists/links,
 * `render()` for the rest. `decl`, the cell's column: a Number or Date column's `format` shapes a number or a date (YAZ-4591).
 */
export function cellContent(v: Value, resolve?: Resolver, decl?: PropertyDecl) {
  if (v instanceof ErrorValue)
    return (
      <span className="view-table__chip view-table__chip--error" title={v.message}>
        #ERROR
      </span>
    )
  if (typeof v === 'boolean') return <input type="checkbox" checked={v} disabled readOnly />
  if (Array.isArray(v)) return v.map((item, i) => chip(item, i, resolve))
  if (v instanceof LinkValue || v instanceof FileValue) return chip(v, undefined, resolve)
  if (decl?.format !== undefined) {
    if (decl.kind === 'number' && typeof v === 'number') return formatNumber(v, decl.format)
    if (decl.kind === 'date' && v instanceof DateValue) return formatDateValue(v.ms, v.hasTime, decl.format) ?? render(v, resolve)
  }
  if (typeof v === 'string' && v.includes('[[')) return <InlineLinks text={v} resolve={resolve} />
  return render(v, resolve)
}

/** The group value by type: chips for lists and links/files, `render()` for the rest. */
function groupValue(v: Value, resolve?: Resolver) {
  if (Array.isArray(v)) return v.map((item, i) => chip(item, i, resolve))
  if (v instanceof LinkValue || v instanceof FileValue) return chip(v, undefined, resolve)
  return render(v, resolve)
}

type Colour = keyof typeof HIGHLIGHT_HEX

/**
 * A group level's header look (YAZ-3742 D5): its `highlight` as a wash of that highlight colour
 * (`--view-group-hl`, painted at 40% by views.css) and `large` as 14px bold. An unknown colour name
 * paints nothing. The Sort menu's "Aa" chip wears the same look under its own `base` class, so a
 * query for the headers' values never finds the chip.
 */
export function groupValueLook(spec: GroupBySpec | undefined, base = 'view-group__value'): { className: string; style?: CSSProperties } {
  const hex = typeof spec?.highlight === 'string' && Object.hasOwn(HIGHLIGHT_HEX, spec.highlight) ? HIGHLIGHT_HEX[spec.highlight as Colour] : undefined
  const className = [base, hex !== undefined && `${base}--highlight`, spec?.large === true && `${base}--large`].filter(Boolean).join(' ')
  return hex === undefined ? { className } : { className, style: { '--view-group-hl': hex } as CSSProperties }
}

export interface GroupHeaderProps {
  def: ViewSet
  view: ViewDef
  /** The host view's column keys (`propertyKeys`); one summary renders per summarised column, in this order. */
  columns: readonly string[]
  /** The engine group's key; null = the "No value" group. */
  groupKey: Value | null
  /** What the engine calls the group (`Group.label`): a Folder group's is its folder's title (YAZ-2541), which its key, the path, does not say. */
  label: string
  /** The group's SHOWN (post-search) rows: the count and summaries are computed over exactly these. */
  rows: readonly Row[]
  collapsed: boolean
  onToggle: () => void
  /** Create a note in this group (5D, GRO-2144); absent → no "+" affordance. */
  onNew?: () => void
  /** "Show New buttons" (YAZ-3746 13BL, demo): false hides the "+"; the right-click "New note in this group" stays. */
  newButton?: boolean
  /** The vault's resolver: a group keyed by an id link is headed by that note's title (YAZ-2293 D8). */
  resolve?: Resolver
  /** The group's `groupBy` level, outer = 0 (the default): its spec gives the header's style (YAZ-3742). */
  level?: number
  /** The group's collapse key (`spotKey`): a nested Folder group's menu finds the groups below it by it (YAZ-4928). */
  gk?: string
}

export function GroupHeader({ def, view, columns, groupKey, label, rows, collapsed, onToggle, onNew, newButton = true, resolve, level = 0, gk }: GroupHeaderProps) {
  const unit = useUnit()
  // `level` counts the levels that group (YAZ-4544): an entry with no property is none.
  const look = groupValueLook(shownGroupLevels(view)[level])
  // A Folder level's group (YAZ-4564 D27) opens that folder's page; the page's own folder and the vault root have none.
  const pages = useContext(FolderPages)
  const open = pages?.open
  const openFolder =
    open !== undefined && typeof groupKey === 'string' && groupKey !== '' && groupKey !== pages?.folder && shownGroupLevels(view)[level]?.property === 'file.folder'
      ? () => open(groupKey)
      : undefined
  // The right-click menu (YAZ-4604, D55): the app's own, never the system's. The event stops here, so no row or
  // selection menu of the view around it opens too. Only this header re-renders when it opens or closes.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // A Folder group of a subfolder directly under the page moves that folder to Other files (YAZ-4747 OF1). Read when
  // the menu opens, so a header that never opens its menu does nothing here.
  const folderTray = useContext(OtherFilesFolderMove)
  const subfolder = menu !== null && folderTray !== null && typeof groupKey === 'string' && shownGroupLevels(view)[level]?.property === 'file.folder' ? folderTray.folderAt(groupKey) : null
  const moveFolder = subfolder === null || folderTray === null ? undefined : { name: subfolder.name, run: () => folderTray.move(subfolder.dir) }
  // "Expand all" / "Collapse all" over the folder groups below a nested Folder header (YAZ-4928): read when the menu opens.
  const levels = useContext(GroupLevelStepsContext)
  const branch = menu !== null && gk !== undefined ? levels?.branch?.(gk) : undefined
  return (
    <div
      className="view-group"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {menu !== null && <GroupHeaderMenu x={menu.x} y={menu.y} collapsed={collapsed} onToggle={onToggle} onNew={onNew} moveFolder={moveFolder} branch={branch} onClose={() => setMenu(null)} />}
      <button type="button" className="view-group__toggle" aria-expanded={!collapsed} aria-label={`Toggle group ${label}`} onClick={onToggle}>
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {/* A text name too long for the header is cut; the tooltip holds the rest, as a chip's does. */}
      <span className={`${look.className}${groupKey === null ? ' view-group__value--none' : ''}`} style={look.style} title={typeof groupKey === 'string' ? label : undefined}>
        {typeof groupKey === 'string' ? label : groupKey === null ? 'No value' : groupValue(groupKey, resolve)}
      </span>
      <span className="view-group__count">{rows.length}</span>
      {openFolder !== undefined && (
        <button type="button" className="view-group__open" aria-label={`Open folder page ${label}`} title="Open folder page" onClick={openFolder}>
          ↗
        </button>
      )}
      {onNew !== undefined && newButton && (
        <button type="button" className="view-group__new" aria-label={unit(`New note in group ${label}`)} title={unit('New note')} onClick={onNew}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      )}
      {columns.map((key) => {
        const kind = summaryKindOf(view, key)
        if (kind === undefined) return null
        return (
          <span key={key} className="view-group__summary" title={`${propertyLabel(def, key)} ${kind}`}>
            <span className="view-group__summary-kind">{kind}</span>
            {render(summarize(kind, rows.map((r) => r.values[key]), def.summaries), resolve)}
          </span>
        )
      })}
    </div>
  )
}
