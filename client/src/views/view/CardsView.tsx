import { type CSSProperties, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { api } from '../../api'
import type { ViewSet, ViewDef } from '../viewSchema'
import { basenameCandidates, type LinkCandidate } from '../../links/completion'
import { belongsToBasenames } from '../../links/folderLinks'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { cellEditor, columnTyping } from '../editorType'
import type { Resolver } from '../expr'
import type { FolderSettings } from '../folderSettings'
import { cardWidth } from './cardWidth'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, groupKeyOf, rowTitle } from './GroupHeader'
import { PageContextMenu } from './PageContextMenu'

export interface CardsViewProps {
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
  onNotice?: (message: string) => void
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. */
  onNewInGroup?: (group: Group) => void
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

/** `data:` URLs by root + ref, so a grid never fetches one cover twice; failures cache too (→ placeholder). */
const assetCache = new Map<string, Promise<string>>()

function loadAsset(root: string, ref: string): Promise<string> {
  const key = `${root}\0${ref}`
  let p = assetCache.get(key)
  if (p === undefined) {
    p = api.readAsset(root, ref).then((a) => `data:${a.mime};base64,${a.data}`)
    p.catch(() => undefined) // consumers handle; this only silences the unhandled-rejection noise
    assetCache.set(key, p)
  }
  return p
}

/** Test hook: drops every cached cover. */
export function _resetAssetCache(): void {
  assetCache.clear()
}

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
    loadAsset(root, ref).then(
      (url) => live && setSrc(url),
      () => live && setFailed(true),
    )
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
export function CardsView({ def, view, root, records, rows, groups, collapsed, onToggleGroup, onOpenFile, onOpenFileRight, onOpenFileBackground, onNotice, onNewInGroup, properties = null, settings, vaultRecords, vaultFolders, resolve, resolveLink, onWriteValue }: CardsViewProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null)
  /** A typed editor keeps its own (native) menu, as in the table. */
  const openMenu = (event: ReactMouseEvent, row: Row): void => {
    if (event.target instanceof Element && event.target.closest('[data-editing]') !== null) return
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, path: row.record.path, title: row.record.title })
  }
  const keys = useMemo(() => propertyKeys(def, view, records, Object.keys(settings.columns)), [def, view, records, settings])
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = useMemo(() => keys.filter((k) => k !== nameKey), [keys, nameKey])
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows;
  // memoised so unrelated re-renders skip the per-column row walk (7B, GRO-2148)
  const rowRecords = useMemo(() => rows.map((r) => r.record), [rows])
  const bares = useMemo(
    () => new Map(rest.map((k) => [k, canonicalKey(k).startsWith('note.') ? canonicalKey(k).slice(5) : null])),
    [rest],
  )
  const typings = useMemo(
    () => new Map(rest.map((k) => [k, columnTyping(k, rowRecords, properties, settings)])),
    [rest, rowRecords, properties, settings],
  )
  /** What the pickers resolve and complete over: the WHOLE vault, never the folder's rows alone (🔒 D2). */
  const basenames = useMemo(() => basenameCandidates(vaultRecords), [vaultRecords])
  // Relation columns narrow the link picker to the notes in the FOLDER the target names
  // (YAZ-2290 D10: `belongsToBasenames`); a target naming no folder falls back to all basenames.
  const linkNames = useMemo(() => {
    const m = new Map<string, LinkCandidate[]>()
    for (const [key, t] of typings) if (t?.target !== undefined) m.set(key, belongsToBasenames(vaultRecords, vaultFolders, resolveLink, root, t.target))
    return m
  }, [typings, vaultRecords, vaultFolders, resolveLink, root])
  const imageKey = typeof view.image === 'string' && view.image.trim() !== '' ? view.image : null
  const ratio = Number(view.imageAspectRatio)
  const style = {
    '--view-card-w': `${cardWidth(view.cardSize)}px`,
    '--view-card-fit': view.imageFit === 'contain' ? 'contain' : 'cover',
    '--view-card-ratio': Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
  } as CSSProperties

  const grid = (shown: readonly Row[]) => (
    <ul className="view-cards__grid">
      {shown.map((row) => (
        <li key={row.record.path} className="view-card" onContextMenu={(event) => openMenu(event, row)}>
          {imageKey !== null && <CardCover root={root} cover={coverOf(row.record, imageKey)} />}
          <div className="view-card__body">
            <button type="button" className="view-card__title" onClick={() => onOpenFile(row.record.path)}>
              {rowTitle(row)}
            </button>
            {rest.map((key) => {
              const bare = bares.get(key) ?? null
              return (
                <div key={key} className="view-card__prop">
                  <span className="view-card__prop-name">{propertyLabel(def, key)}</span>
                  <span className="view-card__prop-value">
                    {bare === null ? (
                      cellContent(row.values[key], resolve)
                    ) : (
                      <EditableCell
                        propKey={bare}
                        raw={row.record.properties[bare]}
                        value={row.values[key]}
                        editor={cellEditor(row.record.properties[bare], typings.get(key) ?? null)}
                        options={typings.get(key)?.options}
                        basenames={linkNames.get(key) ?? basenames}
                        resolve={resolve}
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

  return (
    <div className="view-cards" style={style}>
      {groups === null
        ? grid(rows)
        : groups.map((g) => {
            const gk = groupKeyOf(g.key)
            const isCollapsed = collapsed.includes(gk)
            return (
              <section key={gk} className="view-cards__group">
                <GroupHeader
                  def={def}
                  view={view}
                  columns={keys}
                  groupKey={g.key}
                  rows={g.rows}
                  collapsed={isCollapsed}
                  onToggle={() => onToggleGroup(gk)}
                  onNew={onNewInGroup === undefined ? undefined : () => onNewInGroup(g)}
                  resolve={resolve}
                />
                {!isCollapsed && grid(g.rows)}
              </section>
            )
          })}
      {menu !== null && <PageContextMenu {...menu} onOpenRight={onOpenFileRight} onOpenBackground={onOpenFileBackground} onNotice={onNotice} onClose={() => setMenu(null)} />}
    </div>
  )
}
