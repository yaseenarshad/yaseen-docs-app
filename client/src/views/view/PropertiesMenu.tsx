import { useState, type DragEvent } from 'react'
import { PROPERTY_KINDS, PROPERTY_NAME, type IndexRecord, type PropertiesResponse, type PropertyDecl, type PropertyKind } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import type { ColumnDecl } from '../folderPageSettings'
import type { FolderPageMode } from '../ViewsPane'
import { propertyKeys, propertyLabel } from '../engine'
import { properties as propertiesApi } from '../useProperties'
import { canonicalKey } from './keys'
import { DragHandleIcon, PencilIcon, RelationIcon } from './icons'
import { markerStyleOf } from './ListView'
import { allPropertyKeys } from './properties'
import { TextField } from './TextField'
import { frozenColumnCount } from './frozenColumns'
import { cardWidth } from './cardWidth'

export interface PropertiesMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
  /** Relation columns (5E, GRO-2217): the vault root (null = unknown, no relation editor) and the vault-wide declarations. */
  root?: string | null
  properties?: PropertiesResponse | null
  /** The folder page's own declarations (the ladder's TOP rung) and `setColumns`, the door they go back through (YAZ-895). */
  folderPage: FolderPageMode
}

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

/** Board's width editor accepts finite numbers, then rounds and clamps only its lower bound. */
export const normalizeBoardWidth = (draft: string): string | null => {
  if (draft.trim() === '') return null
  const width = Number(draft)
  return Number.isFinite(width) ? String(Math.max(180, Math.round(width))) : null
}

/** One property's card styling (YAZ-1206), keyed by canonical key under `view.cardStyle`. */
type CardStyle = NonNullable<ViewDef['cardStyle']>[string]

/** The `def.properties` entry a key's display name lives in: as written, bare, or `note.`-prefixed; else the bare form. */
function entryKey(def: ViewSet, key: string): string {
  const b = bare(key)
  for (const k of [key, b, `note.${b}`]) if (def.properties?.[k] !== undefined) return k
  return b
}

/**
 * Properties menu (GRO-2135): shown ⇄ hidden checklist (writes `view.order`; Table and Board views
 * may hide `file.name`, while Cards and List keep their existing behavior), a 6-dot grip to
 * reorder (YAZ-1207: the ↑↓ arrows are gone), pencil to set `def.properties[key].displayName`.
 * Board views add four per-row card-style toggles (YAZ-1206/YAZ-1217) writing `view.cardStyle` —
 * bold, underline, hide label, and ⤴ join onto the row above; the shown `file.name` row carries
 * ONLY ⤴, since the title takes part in the card's layout and never in its text styling.
 * List views (4F, GRO-2140) get a trailing "List" section for how those properties display —
 * `markerStyle` / `indentProperties` / `propertySeparator`, one write per change, the default
 * value DELETES the key (like SortMenu clearing `sort` / `groupBy`).
 * Note properties additionally offer the relation editor (5E, GRO-2217): single/multi toggle +
 * target, saved through `properties.setProperty` to the vault-wide declarations — the per-type
 * scope died with the type system (YAZ-836).
 * A trailing "+ Add column" (YAZ-896) declares a column on the FOLDER PAGE instead, and shows it.
 * Each `note.*` row carries that declaration's kind (YAZ-897) — `auto` when undeclared.
 */
export function PropertiesMenu({ def, view, viewIndex, records, onUpdate, root = null, properties = null, folderPage }: PropertiesMenuProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [relationFor, setRelationFor] = useState<string | null>(null)
  /** The drag in flight (YAZ-1207): `from` is an index in `shown`, `to` the insertion slot it would land in. */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const shown = propertyKeys(def, view, records)
  const keys = allPropertyKeys(def, view, records, folderPage.settings.columns)
  const isShown = (key: string) => shown.some((k) => canonicalKey(k) === canonicalKey(key))

  const writeOrder = (order: string[]) =>
    onUpdate((d) => {
      const next = d.views[viewIndex]
      next.order = order
      if (next.frozenColumns !== undefined) {
        const count = frozenColumnCount(next.frozenColumns, order.length)
        if (count === 0) delete next.frozenColumns
        else next.frozenColumns = count
      }
    })
  const toggle = (key: string) => writeOrder(isShown(key) ? shown.filter((k) => canonicalKey(k) !== canonicalKey(key)) : [...shown, key])
  /** The slot a pointer at `clientY` over shown row `i` means: before (i) or after (i+1) it. */
  const insertionAt = (e: DragEvent<HTMLElement>, i: number): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? i : i + 1
  }
  /**
   * Reorder (YAZ-1207), TabBar's move rule (GRO-2235): the slot is an index in the WITH-dragged-row
   * list, so past the grab point it shifts one left. ONE `writeOrder` — never a bypass, it is what
   * keeps `frozenColumns` following positionally.
   */
  const move = (from: number, insertion: number) => {
    const to = insertion > from ? insertion - 1 : insertion
    if (to === from) return
    const next = [...shown]
    const [key] = next.splice(from, 1)
    next.splice(to, 0, key)
    writeOrder(next)
  }
  /**
   * A column's declared kind (YAZ-897), in ONE `folder_page_settings` write (🔒 D3) — `views` is
   * NOT passed, so the order is untouched. C1 (locked): member VALUES are never migrated or
   * rewritten; the declaration alone moves, and its `target` / `required` ride along on the spread
   * (so a link ⇄ multi-link switch keeps the target it was given at add-time, YAZ-896).
   */
  const setKind = (name: string, kind: PropertyKind) => {
    const columns = folderPage.settings.columns
    folderPage.setColumns({ ...columns, [name]: { ...columns[name], kind } })
  }
  /** A declared link column's per-page target (YAZ-897) — same one-write door; empty DELETES the key. */
  const setTarget = (name: string, target: string) => {
    const columns = folderPage.settings.columns
    const { target: _prev, ...rest } = columns[name]
    folderPage.setColumns({ ...columns, [name]: target.trim() === '' ? rest : { ...rest, target: target.trim() } })
  }
  const setDisplayName = (key: string, name: string) =>
    onUpdate((d) => {
      const k = entryKey(d, key)
      const props = d.properties ?? {}
      const entry = { ...props[k] }
      if (name.trim()) entry.displayName = name.trim()
      else delete entry.displayName
      if (Object.keys(entry).length) props[k] = entry
      else delete props[k]
      if (Object.keys(props).length) d.properties = props
      else delete d.properties
    })

  const cardStyleOf = (key: string): CardStyle => view.cardStyle?.[canonicalKey(key)] ?? {}
  /** One cardStyle write (YAZ-1206): flags that fall back to absent delete themselves; an empty entry, then an empty map, deletes too — the YAML default-deletes rule. */
  const writeCardStyle = (key: string, edit: (style: CardStyle) => void) =>
    onUpdate((d) => {
      const v = d.views[viewIndex]
      const k = canonicalKey(key)
      const style: CardStyle = { ...v.cardStyle?.[k] }
      edit(style)
      const map = { ...v.cardStyle }
      if (Object.keys(style).length) map[k] = style
      else delete map[k]
      if (Object.keys(map).length) v.cardStyle = map
      else delete v.cardStyle
    })
  const toggleCardFlag = (key: string, flag: 'bold' | 'underline' | 'hideLabel' | 'join') =>
    writeCardStyle(key, (style) => {
      if (style[flag] === true) delete style[flag]
      else style[flag] = true
    })

  return (
    <div className="view-menu">
      <ul className="view-menu__list">
        {keys.map((key) => {
          const on = isShown(key)
          const i = shown.indexOf(key)
          const label = propertyLabel(def, key)
          const decl = folderPage.settings.columns[bare(key)]
          const isNote = canonicalKey(key).startsWith('note.')
          /** The title's row: no declaration, no relation, no text styling — only the join toggle, and only on a board (YAZ-1217). */
          const isName = canonicalKey(key) === 'file.name'
          const cls = ['view-prop']
          if (drag !== null && i >= 0) {
            if (drag.from === i) cls.push('view-prop--dragging')
            // The insertion indicator: an accent edge on the row the drop would land before — or
            // after the LAST row for the end slot.
            if (drag.to === i) cls.push('view-prop--insert-before')
            if (drag.to === shown.length && i === shown.length - 1) cls.push('view-prop--insert-after')
          }
          return (
            <li
              key={key}
              className={cls.join(' ')}
              onDragOver={(e) => {
                if (drag === null || i < 0) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                const to = insertionAt(e, i)
                if (drag.to !== to) setDrag({ ...drag, to })
              }}
              onDrop={(e) => {
                if (drag === null || i < 0) return
                e.preventDefault()
                setDrag(null)
                move(drag.from, insertionAt(e, i))
              }}
            >
              <div className="view-prop__identity">
                {on && (
                  <button
                    type="button"
                    className="view-rule__nav view-prop__handle"
                    aria-label={`Reorder ${label}`}
                    title="Reorder"
                    draggable
                    onDragStart={(e) => {
                      // The groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none.
                      e.dataTransfer?.setData('text/plain', key)
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                      setDrag({ from: i, to: i })
                    }}
                    onDragEnd={() => setDrag(null)}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                      e.preventDefault()
                      if (e.key === 'ArrowUp') {
                        if (i > 0) move(i, i - 1)
                      } else if (i < shown.length - 1) move(i, i + 2)
                    }}
                  >
                    <DragHandleIcon />
                  </button>
                )}
                <input
                  type="checkbox"
                  aria-label={`Show ${label}`}
                  checked={on}
                  disabled={canonicalKey(key) === 'file.name' && view.type !== 'table' && view.type !== 'board'}
                  onChange={() => toggle(key)}
                />
                {editing === key ? (
                  <TextField
                    className="view-input view-prop__rename"
                    aria-label="Display name"
                    placeholder={bare(key)}
                    autoFocus
                    value={def.properties?.[entryKey(def, key)]?.displayName ?? ''}
                    onCommit={(name) => setDisplayName(key, name)}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <span className="view-prop__name">
                    {label}
                    {label !== key && <small>{key}</small>}
                  </span>
                )}
                <button type="button" className="view-rule__nav" aria-label={`Rename ${label}`} title="Display name" onClick={() => setEditing(key)}>
                  <PencilIcon />
                </button>
              </div>
              {/* Note rows since YAZ-1207 (the ↑↓ arrows were the shown row's other reason to have this line), plus the shown board title for its join toggle alone. */}
              {(isNote || (isName && view.type === 'board' && on)) && (
                <div className="view-prop__controls">
                  {isNote && (
                    <>
                      <select
                        className="view-select"
                        aria-label={`Type of ${label}`}
                        value={decl?.kind ?? ''}
                        onChange={(e) => setKind(bare(key), e.target.value as PropertyKind)}
                      >
                        {/* Undeclared: the ladder's LOWER rungs decide — a placeholder, never a choice. */}
                        <option value="" disabled>
                          auto
                        </option>
                        {PROPERTY_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      {(decl?.kind === 'link' || decl?.kind === 'multi-link') && (
                        <TextField
                          className="view-input view-relation__target"
                          aria-label={`Target of ${label}`}
                          placeholder="Any page"
                          value={decl.target ?? ''}
                          onCommit={(target) => setTarget(bare(key), target)}
                        />
                      )}
                    </>
                  )}
                  {/* Card styling (YAZ-1206) belongs to the property, so it rides this line — shown board rows only; the title gets ⤴ alone, since it takes part in the LAYOUT and never in text styling (YAZ-1217). */}
                  {view.type === 'board' && on && (
                    <>
                      {isNote && (
                        <>
                          <button
                            type="button"
                            className="view-rule__nav view-card-toggle"
                            aria-label={`Bold ${label} on cards`}
                            title={`Bold ${label} on cards`}
                            aria-pressed={cardStyleOf(key).bold === true}
                            onClick={() => toggleCardFlag(key, 'bold')}
                          >
                            <b>B</b>
                          </button>
                          <button
                            type="button"
                            className="view-rule__nav view-card-toggle"
                            aria-label={`Underline ${label} on cards`}
                            title={`Underline ${label} on cards`}
                            aria-pressed={cardStyleOf(key).underline === true}
                            onClick={() => toggleCardFlag(key, 'underline')}
                          >
                            <u>U</u>
                          </button>
                          <button
                            type="button"
                            className="view-rule__nav view-card-toggle"
                            aria-label={`Hide ${label} label on cards`}
                            title={`Hide ${label} label on cards`}
                            aria-pressed={cardStyleOf(key).hideLabel === true}
                            onClick={() => toggleCardFlag(key, 'hideLabel')}
                          >
                            –L
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="view-rule__nav view-card-toggle"
                        aria-label={`Join ${label} to the row above`}
                        title={`Join ${label} to the row above`}
                        aria-pressed={cardStyleOf(key).join === true}
                        onClick={() => toggleCardFlag(key, 'join')}
                      >
                        ⤴
                      </button>
                    </>
                  )}
                  {root !== null && isNote && (
                    <button
                      type="button"
                      className="view-rule__nav"
                      aria-label={`Relation for ${label}`}
                      title="Relation"
                      aria-expanded={relationFor === key}
                      onClick={() => setRelationFor(relationFor === key ? null : key)}
                    >
                      <RelationIcon />
                    </button>
                  )}
                </div>
              )}
              {relationFor === key && root !== null && (
                <RelationEditor root={root} propKey={bare(key)} properties={properties} onDone={() => setRelationFor(null)} />
              )}
            </li>
          )
        })}
      </ul>
      <AddColumn
        taken={keys}
        onSave={(name, column) =>
          folderPage.setColumns(
            { ...folderPage.settings.columns, [name]: column },
            // The new column shown TOO, in that same one write (🔒 D3): `shown` is what `writeOrder`
            // writes — the view's own `order`, or the derived keys when it has none.
            def.views.map((v, i) => (i === viewIndex ? { ...v, order: [...shown, `note.${name}`] } : v)),
          )
        }
      />
      {view.type === 'table' && (
        <>
          <p className="view-menu__label">Table</p>
          <label className="view-settings-row">
            <span>Frozen columns</span>
            <select
              className="view-select"
              aria-label="Frozen columns"
              value={frozenColumnCount(view.frozenColumns, shown.length)}
              onChange={(e) =>
                onUpdate((d) => {
                  const count = Number(e.target.value)
                  if (count === 0) delete d.views[viewIndex].frozenColumns
                  else d.views[viewIndex].frozenColumns = count
                })
              }
            >
              <option value={0}>None</option>
              {shown.map((key, index) => (
                <option key={key} value={index + 1}>
                  {index + 1} — through {propertyLabel(def, key)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {view.type === 'board' && (
        <>
          <p className="view-menu__label">Board</p>
          <label className="view-settings-row">
            <span>Column width</span>
            <span className="view-width-setting">
              <TextField
                className="view-input"
                aria-label="Column width in pixels"
                type="number"
                inputMode="decimal"
                min={180}
                step={1}
                value={String(cardWidth(view.cardSize))}
                normalize={normalizeBoardWidth}
                onCommit={(next) =>
                  onUpdate((d) => {
                    const active = d.views[viewIndex]
                    if (Number(next) === 280) delete active.cardSize
                    else active.cardSize = Number(next)
                  })
                }
              />
              <span>px</span>
            </span>
          </label>
        </>
      )}
      {view.type === 'list' && (
        <>
          <p className="view-menu__label">List</p>
          <div className="view-list-settings">
            <select
              className="view-select"
              aria-label="Marker style"
              value={markerStyleOf(view)}
              onChange={(e) =>
                onUpdate((d) => {
                  if (e.target.value === 'bullet') delete d.views[viewIndex].markerStyle
                  else d.views[viewIndex].markerStyle = e.target.value
                })
              }
            >
              <option value="bullet">Bullet</option>
              <option value="number">Number</option>
              <option value="none">None</option>
            </select>
            <label className="view-menu__toggle">
              <input
                type="checkbox"
                aria-label="Indent properties"
                checked={view.indentProperties === true}
                onChange={(e) =>
                  onUpdate((d) => {
                    if (e.target.checked) d.views[viewIndex].indentProperties = true
                    else delete d.views[viewIndex].indentProperties
                  })
                }
              />
              Indent properties
            </label>
            <TextField
              className="view-input"
              aria-label="Property separator"
              placeholder=", "
              value={typeof view.propertySeparator === 'string' ? view.propertySeparator : ''}
              onCommit={(sep) =>
                onUpdate((d) => {
                  if (sep === '' || sep === ', ') delete d.views[viewIndex].propertySeparator
                  else d.views[viewIndex].propertySeparator = sep
                })
              }
            />
          </div>
        </>
      )}
      {/* The folder-page-level setting (YAZ-1104) — the saved START, through its own door; never a views write. */}
      <p className="view-menu__label">Page</p>
      <label className="view-settings-row">
        <span>Default view</span>
        <select
          className="view-select"
          aria-label="Default view"
          value={folderPage.settings.defaultView ?? ''}
          onChange={(e) => folderPage.setDefaultView(e.target.value === '' ? undefined : e.target.value)}
        >
          <option value="">First view</option>
          {def.views.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

interface AddColumnProps {
  /** Every key the menu already offers — the folder page's DECLARED columns among them (YAZ-895). */
  taken: readonly string[]
  onSave: (name: string, column: ColumnDecl) => void
}

/**
 * "+ Add column" (YAZ-896): declare a column on the FOLDER PAGE — the typing ladder's top rung
 * (🔒 Q8) — and show it, in one `folder_page_settings` write (🔒 D3). A name that is not a
 * property name, or one the menu already offers, is refused inline and nothing is written.
 */
function AddColumn({ taken, onSave }: AddColumnProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<PropertyKind>('text')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open)
    return (
      <button type="button" className="view-menu__action" onClick={() => setOpen(true)}>
        + Add column
      </button>
    )

  const save = () => {
    const key = name.trim()
    if (!PROPERTY_NAME.test(key)) {
      setError('Use lower case letters, digits and _, starting with a letter')
      return
    }
    if (taken.some((k) => canonicalKey(k) === canonicalKey(key))) {
      setError(`${key} is already a column`)
      return
    }
    const column: ColumnDecl = { kind }
    // A target typed under a link kind must not ride into a non-link declaration after a kind switch.
    if ((kind === 'link' || kind === 'multi-link') && target.trim() !== '') column.target = target.trim()
    onSave(key, column)
    setOpen(false)
    setName('')
    setKind('text')
    setTarget('')
    setError(null)
  }

  return (
    <div className="view-relation">
      <input className="view-input" aria-label="Column name" placeholder="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <select className="view-select" aria-label="Column kind" value={kind} onChange={(e) => setKind(e.target.value as PropertyKind)}>
        {PROPERTY_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {(kind === 'link' || kind === 'multi-link') && (
        <input
          className="view-input view-relation__target"
          aria-label="Column target"
          placeholder="Any page"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      )}
      <button type="button" className="view-menu__action" aria-label="Save column" onClick={save}>
        Save
      </button>
      {error !== null && (
        <span className="view-relation__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

interface RelationEditorProps {
  root: string
  /** Bare frontmatter key — vault-wide declarations are keyed bare, never canonicalised. */
  propKey: string
  properties: PropertiesResponse | null
  onDone: () => void
}

/**
 * The relation editor for one column (5E, GRO-2217; contract GRO-2120 §4): single-vs-multiple
 * toggle (link vs multi-link) and a target — free text, since a target naming nothing just
 * widens the picker (§3). Saving calls `properties.setProperty(root, key, { kind, target })`:
 * the per-type scope (and the type-name suggestions that went with it) died with the type system
 * (YAZ-836) — 5.1 re-points the target at folder pages. Values are untouched: cells keep
 * committing wiki-link strings/lists through `writeProperty`.
 */
function RelationEditor({ root, propKey, properties, onDone }: RelationEditorProps) {
  const declared = properties?.properties[propKey]
  const relation = declared?.kind === 'link' || declared?.kind === 'multi-link' ? declared : undefined
  const [multiple, setMultiple] = useState(relation?.kind === 'multi-link')
  const [target, setTarget] = useState(relation?.target ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    const def: PropertyDecl = { kind: multiple ? 'multi-link' : 'link' }
    if (target.trim() !== '') def.target = target.trim()
    setError(null)
    propertiesApi.setProperty(root, propKey, def).then(onDone, (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  return (
    <div className="view-relation">
      <label className="view-menu__toggle">
        <input type="checkbox" aria-label="Multiple" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
        Multiple
      </label>
      <input
        className="view-input view-relation__target"
        aria-label="Target folder page"
        placeholder="Any page"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />
      <button type="button" className="view-menu__action" aria-label="Save relation" onClick={save}>
        Save
      </button>
      <small className="view-relation__dest">Saved to vault properties</small>
      {error !== null && (
        <span className="view-relation__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
