import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { api } from '../../api'
import type { BaseDefinition, BaseView } from '../baseFile'
import { belongsToBasenames } from '../../links/folderPages'
import { type Group, type Row, propertyKeys, propertyLabel, resolverFor } from '../engine'
import { render } from '../expr'
import { cellEditor, columnTyping } from '../editorType'
import { cardWidth } from './cardWidth'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './filterRows'
import { GroupHeader, cellContent, groupKeyOf } from './GroupHeader'

export interface CardsViewProps {
  def: BaseDefinition
  view: BaseView
  /** Vault root, for resolving local cover assets over the bridge; null → local covers stay placeholders. */
  root: string | null
  records: readonly IndexRecord[]
  /** The post-search rows — the one flat grid when the view has no `groupBy`. */
  rows: readonly Row[]
  /** Post-search groups from BaseView (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this base file + view; owned by BaseView, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onOpenFile: (path: string) => void
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. */
  onNewInGroup?: (group: Group) => void
  /** Embed chrome (6A, GRO-2145): no inline property editing. */
  readOnly?: boolean
  /** Assigned property types from `.obsidian/types.json`, for editor inference (5B, GRO-2142). */
  types?: Record<string, string>
  /** The vault's property declarations (5E, GRO-2217): vault-wide editor inference and relation targets. */
  properties?: PropertiesResponse | null
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
function CardCover({ root, cover }: { root: string | null; cover: Cover }) {
  const ref = cover?.kind === 'asset' ? cover.ref : null
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setSrc(null)
    setFailed(false)
    if (ref === null || root === null) return
    let live = true
    loadAsset(root, ref).then(
      (url) => live && setSrc(url),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [root, ref])
  if (cover?.kind === 'color') return <div className="base-card__cover" style={{ background: cover.color }} />
  const url = cover === null || failed ? null : cover.kind === 'remote' ? cover.src : src
  if (url === null) return <div className="base-card__cover base-card__cover--empty" />
  return <img className="base-card__cover" src={url} alt="" onError={() => setFailed(true)} />
}

// ---------- the view ----------

/**
 * Cards view (4E, GRO-2139): `type: cards` — Obsidian's schema — renders a responsive grid of
 * cards: an optional cover from the view's `image` property (see `coverOf`; missing value or a
 * failed load → neutral placeholder, never a broken image), `file.name` as the title button →
 * `onOpenFile`, then the view's other `order` properties as small label/value rows typed like
 * table cells. Grid columns are `repeat(auto-fill, minmax(<cardWidth>px, 1fr))` — `cardSize` is
 * Obsidian's numeric px or the board's small/medium/large presets (one shared mapping).
 * `imageFit` (cover|contain) and `imageAspectRatio` (number, default 1:1) land as CSS custom
 * properties on the grid. Grouped results render 4C sections — the shared `GroupHeader` over
 * each group's grid, with the SAME persisted collapse state as the table/board (never the
 * `.base` file); search narrows cards and drops empty groups. Note-property rows edit inline
 * through `EditableCell` (5B, GRO-2142); a lightbox stays out of scope.
 */
export function CardsView({ def, view, root, records, rows, groups, collapsed, onToggleGroup, onOpenFile, onNewInGroup, types, properties = null, readOnly = false }: CardsViewProps) {
  const keys = useMemo(() => propertyKeys(def, view, records), [def, view, records])
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
    () => new Map(rest.map((k) => [k, columnTyping(k, rowRecords, types, properties)])),
    [rest, rowRecords, types, properties],
  )
  const basenames = useMemo(() => records.map((r) => r.basename), [records])
  // Relation columns narrow the link picker to the pages of the folder page the target names
  // (YAZ-836: `belongsToBasenames` succeeded the type-keyed helper); missing key = all basenames.
  const resolve = useMemo(() => {
    const resolver = resolverFor(records)
    return (target: string) => resolver(target)?.record.path ?? null
  }, [records])
  const linkNames = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [key, t] of typings) if (t?.target !== undefined) m.set(key, belongsToBasenames(records, resolve, t.target))
    return m
  }, [typings, records, resolve])
  const imageKey = typeof view.image === 'string' && view.image.trim() !== '' ? view.image : null
  const ratio = Number(view.imageAspectRatio)
  const style = {
    '--base-card-w': `${cardWidth(view.cardSize)}px`,
    '--base-card-fit': view.imageFit === 'contain' ? 'contain' : 'cover',
    '--base-card-ratio': Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
  } as CSSProperties

  const grid = (shown: readonly Row[]) => (
    <ul className="base-cards__grid">
      {shown.map((row) => (
        <li key={row.record.path} className="base-card">
          {imageKey !== null && <CardCover root={root} cover={coverOf(row.record, imageKey)} />}
          <div className="base-card__body">
            <button type="button" className="base-card__title" onClick={() => onOpenFile(row.record.path)}>
              {nameKey === undefined ? row.record.name : render(row.values[nameKey])}
            </button>
            {rest.map((key) => {
              const bare = bares.get(key) ?? null
              return (
                <div key={key} className="base-card__prop">
                  <span className="base-card__prop-name">{propertyLabel(def, key)}</span>
                  <span className="base-card__prop-value">
                    {bare === null || readOnly ? (
                      cellContent(row.values[key])
                    ) : (
                      <EditableCell
                        path={row.record.path}
                        propKey={bare}
                        raw={row.record.properties[bare]}
                        value={row.values[key]}
                        editor={cellEditor(row.record.properties[bare], typings.get(key) ?? null)}
                        basenames={linkNames.get(key) ?? basenames}
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
    <div className="base-cards" style={style}>
      {groups === null
        ? grid(rows)
        : groups.map((g) => {
            const gk = groupKeyOf(g.key)
            const isCollapsed = collapsed.includes(gk)
            return (
              <section key={gk} className="base-cards__group">
                <GroupHeader
                  def={def}
                  view={view}
                  columns={keys}
                  groupKey={g.key}
                  rows={g.rows}
                  collapsed={isCollapsed}
                  onToggle={() => onToggleGroup(gk)}
                  onNew={onNewInGroup === undefined ? undefined : () => onNewInGroup(g)}
                />
                {!isCollapsed && grid(g.rows)}
              </section>
            )
          })}
    </div>
  )
}
