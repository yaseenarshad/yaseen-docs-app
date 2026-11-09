import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { api } from '../../api'
import { createPreviewCache } from '../../lib/previewCache'
import { type ViewSet, type ViewDef, groupIndentOf } from '../viewSchema'
import { type LinkCandidate } from '../../links/completion'
import { belongsToTitles, cellLinkCandidates } from '../../links/folderLinks'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { cellEditor, columnTyping } from '../editorType'
import type { Resolver } from '../expr'
import { pageColumnKeys, type FolderSettings } from '../folderSettings'
import { cardWidth } from './cardWidth'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, rowCell, rowTitle } from './GroupHeader'
import { type GroupSpot, TOP_SPOT, childSpot, groupTakesNew, spotKey } from './groupDrag'
import { PageContextMenu } from './PageContextMenu'
import { openByKey } from '../../lib/openGesture'
import { type NoteWindowLink, currentItemClass, shownRows, useNoteWindowItems } from './NoteWindow'
import { NO_READ_ONLY, writableKey } from '../readOnlyRows'
import { ReadOnlyName } from './ReadOnlyMark'
import type { ViewHover } from './viewHover'

export interface CardsViewProps {
  /** The folder's hover panel (YAZ-3403, `viewHover.ts`): `ViewsPane` always passes it; Settings › Preview on hover › Folder views starts or stops the dwell (YAZ-3743). */
  hover: ViewHover
  def: ViewSet
  view: ViewDef
  /** Vault root, for resolving local cover assets over the bridge. */
  root: string
  records: readonly IndexRecord[]
  /** The post-search rows — the one flat grid when the view has no `groupBy`. */
  rows: readonly Row[]
  /** Post-search groups from ViewsPane (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this page + view; owned by ViewsPane, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onOpenFile: (path: string) => void
  /** The card's right-click menu (`PageContextMenu`): its two opens, and where a failed action says so. */
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  /** "Open in mini window ⇧↩" (D57) and ⇧Enter (YAZ-4605 D56) in the right-click menu (YAZ-4547 D24): ViewsPane's card; absent = no item. */
  onOpenWindow?: (path: string) => void
  /** The card's link: this view writes the order it shows and marks the card's note (D24). */
  windowLink?: NoteWindowLink
  onNotice?: (message: string) => void
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. */
  onNewInGroup?: (group: Group, name?: string, at?: GroupSpot) => void
  /** The vault's property declarations (5E, GRO-2217): vault-wide editor inference and relation targets. */
  properties?: PropertiesResponse | null
  /** The settings of the folder whose rows these are (YAZ-819): the typing ladder's TOP rung (🔒 Q8). */
  settings: FolderSettings
  /** The WHOLE index snapshot (🔒 D2, YAZ-819) — `records` is only the folder's rows: link resolution and the pickers read this. */
  vaultRecords: readonly IndexRecord[]
  /** The snapshot's folder settings records, for a link column narrowed to a folder. */
  vaultFolders: readonly IndexRecord[]
  /** ViewsPane's resolver: a cell reads an id link as the title of the note, or folder, it names (YAZ-2293 D8). */
  resolve: Resolver
  /** The window's link resolver, by which a link column's target names its folder. */
  resolveLink: ResolveLink
  /** A cell's commit: one value of one row, through the host's writer (`FolderHost.writeValues`). */
  onWriteValue: (path: string, key: string, value: unknown) => Promise<unknown>
  /** The read-only notes (YAZ-3076 D6): their cells open no editor and their cards do not move. Absent = none. */
  readOnly?: ReadonlySet<string>
}

// ---------- covers ----------

/** What the note's `image` property value asks for; null = no value → placeholder. */
type Cover = { kind: 'color'; color: string } | { kind: 'remote'; src: string } | { kind: 'asset'; ref: string } | null

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const WIKILINK_RE = /^\[\[([^[\]]*)\]\]$/

/**
 * The view's `image` names a per-note property (Obsidian cards semantics); ITS VALUE on each
 * note decides the cover: `#rgb`/`#rrggbb` → colour block, `http(s)://` → remote URL, a
 * wikilink or plain path → local vault asset via `readAsset`. Only note properties resolve
 * (`file.` / `formula.` keys have no per-note frontmatter value → placeholder).
 */
function coverOf(record: IndexRecord, imageKey: string): Cover {
  const key = canonicalKey(imageKey)
  const raw = key.startsWith('note.') ? record.properties[key.slice(5)] : undefined
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (COLOR_RE.test(value)) return { kind: 'color', color: value }
  if (/^https?:\/\//i.test(value)) return { kind: 'remote', src: value }
  const ref = (WIKILINK_RE.exec(value)?.[1] ?? value).trim()
  return ref === '' ? null : { kind: 'asset', ref }
}

/**
 * `data:` URLs by root + ref, so a grid never fetches one cover twice. Bounded (YAZ-3737): the 100 covers seen
 * last, 32 MB at most, through the shared preview cache. A failed read is not kept: the next mount asks again.
 */
const covers = createPreviewCache(
  async (key) => {
    const [root, ref] = key.split('\0')
    const a = await api.readAsset(root, ref)
    return `data:${a.mime};base64,${a.data}`
  },
  { limit: 100, maxBytes: 32 * 1024 * 1024 },
)

/** Test hook: drops every cached cover. */
export const _resetAssetCache = covers.clear

/** One card's cover box (only rendered when the view sets `image`): colour block, remote img, resolved asset img, or the neutral placeholder. */
function CardCover({ root, cover }: { root: string; cover: Cover }) {
  const ref = cover?.kind === 'asset' ? cover.ref : null
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setSrc(null)
    setFailed(false)
    if (ref === null) return
    let live = true
    void covers.load(`${root}\0${ref}`).then((url) => {
      if (!live) return
      if (url === null) setFailed(true)
      else setSrc(url)
    })
    return () => {
      live = false
    }
  }, [root, ref])
  if (cover?.kind === 'color') return <div className="view-card__cover" style={{ background: cover.color }} />
  const url = cover === null || failed ? null : cover.kind === 'remote' ? cover.src : src
  if (url === null) return <div className="view-card__cover view-card__cover--empty" />
  return <img className="view-card__cover" src={url} alt="" onError={() => setFailed(true)} />
}

// ---------- the view ----------

/**
 * Cards view (4E, GRO-2139): `type: cards` — Obsidian's schema — renders a responsive grid of
 * cards: an optional cover from the view's `image` property (see `coverOf`; missing value or a
 * failed load → neutral placeholder, never a broken image), `file.name` as the title button →
 * `onOpenFile`, then the view's other `order` properties as small label/value rows typed like
 * table cells. Grid columns are `repeat(auto-fill, minmax(<cardWidth>px, 1fr))` — `cardSize` is
 * Obsidian's numeric px or legacy small/medium/large compatibility values (one shared mapping).
 * `imageFit` (cover|contain) and `imageAspectRatio` (number, default 1:1) land as CSS custom
 * properties on the grid. Grouped results render 4C sections — the shared `GroupHeader` over
 * each group's grid, with the SAME persisted collapse state as the table/board (never the
 * page's card); search narrows cards and drops empty groups. Note-property rows edit inline
 * through `EditableCell` (5B, GRO-2142); a lightbox stays out of scope.
 */
export function CardsView({ def, view, root, records, rows, groups, collapsed, onToggleGroup, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow, windowLink, onNotice, onNewInGroup, properties = null, settings, vaultRecords, vaultFolders, resolve, resolveLink, onWriteValue, readOnly = NO_READ_ONLY, hover }: CardsViewProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null)
  // The note window (YAZ-4547 D24): the order shown through the groups, once per rows, groups or collapse change.
  const windowOrder = useMemo(() => shownRows(groups, rows, collapsed), [groups, rows, collapsed])
  const rootRef = useRef<HTMLDivElement>(null)
  useNoteWindowItems(windowLink, windowOrder, rootRef)
  /** A typed editor keeps its own (native) menu, as in the table. */
  const openMenu = (event: ReactMouseEvent, row: Row): void => {
    if (event.target instanceof Element && event.target.closest('[data-editing]') !== null) return
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, path: row.record.path, title: row.record.title })
  }
  const keys = useMemo(() => propertyKeys(def, view, records, pageColumnKeys(settings)), [def, view, records, settings])
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = useMemo(() => keys.filter((k) => k !== nameKey), [keys, nameKey])
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows;
  // memoised so unrelated re-renders skip the per-column row walk (7B, GRO-2148)
  const rowRecords = useMemo(() => rows.map((r) => r.record), [rows])
  const bares = useMemo(
    () => new Map(rest.map((k) => [k, writableKey(k)])),
    [rest],
  )
  const typings = useMemo(
    () => new Map(rest.map((k) => [k, columnTyping(k, rowRecords, properties, settings)])),
    [rest, rowRecords, properties, settings],
  )
  /** What the pickers resolve and complete over: the WHOLE vault, never the folder's rows alone (🔒 D2). */
  // The note editor's `[[` rows, notes and folders (YAZ-4601 D49).
  const titles = useMemo(() => cellLinkCandidates(vaultRecords, vaultFolders, resolveLink, root), [vaultRecords, vaultFolders, resolveLink, root])
  // Relation columns narrow the link picker to the notes in the FOLDER the target names
  // (YAZ-2290 D10: `belongsToTitles`); a target naming no folder falls back to all titles.
  const linkNames = useMemo(() => {
    const m = new Map<string, LinkCandidate[]>()
    for (const [key, t] of typings) if (t?.target !== undefined) m.set(key, belongsToTitles(vaultRecords, vaultFolders, resolveLink, root, t.target))
    return m
  }, [typings, vaultRecords, vaultFolders, resolveLink, root])
  const imageKey = typeof view.image === 'string' && view.image.trim() !== '' ? view.image : null
  const ratio = Number(view.imageAspectRatio)
  const style = {
    '--view-card-w': `${cardWidth(view.cardSize)}px`,
    '--view-card-fit': view.imageFit === 'contain' ? 'contain' : 'cover',
    '--view-card-ratio': Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
    // The nested-group step, the same setting as the table and the list (YAZ-4532 D10).
    '--view-group-indent': `${groupIndentOf(view)}px`,
  } as CSSProperties

  /** The title's Enter keys (YAZ-4605 D56), the table's: this tab, ⌘ a background tab, ⌥ the right panel, ⇧ the mini window. */
  const openTitleByKey = (e: ReactKeyboardEvent, path: string): void => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    openByKey(e, path, { onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow })
  }

  const grid = (shown: readonly Row[]) => (
    <ul className="view-cards__grid">
      {shown.map((row) => (
        <li key={row.record.path} className={`view-card${currentItemClass(windowLink, row.record.path)}`} onContextMenu={(event) => openMenu(event, row)} {...hover.itemProps(row.record.path)}>
          {imageKey !== null && <CardCover root={root} cover={coverOf(row.record, imageKey)} />}
          <div className="view-card__body">
            <button type="button" className="view-card__title" onClick={() => onOpenFile(row.record.path)} onKeyDown={(e) => openTitleByKey(e, row.record.path)}>
              {readOnly.has(row.record.path) ? <ReadOnlyName>{rowTitle(row)}</ReadOnlyName> : rowTitle(row)}
            </button>
            {rest.map((key) => {
              const bare = bares.get(key) ?? null
              return (
                <div key={key} className="view-card__prop">
                  <span className="view-card__prop-name">{propertyLabel(def, key)}</span>
                  <span className="view-card__prop-value">
                    {bare === null ? (
                      rowCell(row, key, resolve)
                    ) : (
                      <EditableCell
                        propKey={bare}
                        raw={row.record.properties[bare]}
                        value={row.values[key]}
                        editor={cellEditor(row.record.properties[bare], typings.get(key) ?? null)}
                        options={typings.get(key)?.options}
                        titles={linkNames.get(key) ?? titles}
                        resolve={resolve}
                        readOnly={readOnly.has(row.record.path)}
                        onCommit={(next) => onWriteValue(row.record.path, bare, next)}
                      />
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </li>
      ))}
    </ul>
  )

  /**
   * One group's section. A nested group (YAZ-4531) shows the merge rule's direct rows, then each
   * child's section INSIDE its own, so a collapsed group folds its whole branch.
   */
  const section = (g: Group, at: GroupSpot): ReactNode => {
    const gk = spotKey(g, at)
    const isCollapsed = collapsed.includes(gk)
    return (
      <section key={gk} className="view-cards__group">
        <GroupHeader
          def={def}
          view={view}
          columns={keys}
          groupKey={g.key}
          label={g.label}
          rows={g.rows}
          collapsed={isCollapsed}
          onToggle={() => onToggleGroup(gk)}
          // A level a new note cannot take (a `file.*` one) has no "+", as in Table and Board (YAZ-4544).
          onNew={onNewInGroup === undefined || !groupTakesNew(view, at.level) ? undefined : () => onNewInGroup(g, undefined, at)}
          resolve={resolve}
          level={at.level}
        />
        {!isCollapsed && (g.children === undefined ? grid(g.rows) : (g.direct?.length ?? 0) > 0 && grid(g.direct ?? []))}
        {!isCollapsed && g.children?.map((child) => section(child, childSpot(g, at)))}
      </section>
    )
  }

  return (
    <div ref={rootRef} className="view-cards" style={style}>
      {groups === null
        ? grid(rows)
        : groups.map((g) => section(g, TOP_SPOT))}
      {menu !== null && <PageContextMenu {...menu} onOpenRight={onOpenFileRight} onOpenBackground={onOpenFileBackground} onOpenWindow={onOpenWindow} onNotice={onNotice} onClose={() => setMenu(null)} />}
    </div>
  )
}
