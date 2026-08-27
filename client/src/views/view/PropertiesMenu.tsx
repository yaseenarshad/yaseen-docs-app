import { useState } from 'react'
import { PROPERTY_KINDS, PROPERTY_NAME, type IndexRecord, type PropertiesResponse, type PropertyDecl, type PropertyKind } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import type { ColumnDecl } from '../folderPageSettings'
import type { FolderPageMode } from '../ViewsPane'
import { propertyKeys, propertyLabel } from '../engine'
import { properties as propertiesApi } from '../useProperties'
import { canonicalKey } from './keys'
import { PencilIcon, RelationIcon } from './icons'
import { markerStyleOf } from './ListView'
import { allPropertyKeys } from './properties'
import { TextField } from './TextField'

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

/** The `def.properties` entry a key's display name lives in: as written, bare, or `note.`-prefixed; else the bare form. */
function entryKey(def: ViewSet, key: string): string {
  const b = bare(key)
  for (const k of [key, b, `note.${b}`]) if (def.properties?.[k] !== undefined) return k
  return b
}

/**
 * Properties menu (GRO-2135): shown ⇄ hidden checklist (writes `view.order`, `file.name`
 * always shown), up/down to reorder, pencil to set `def.properties[key].displayName`.
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
  const shown = propertyKeys(def, view, records)
  const keys = allPropertyKeys(def, view, records, folderPage.settings.columns)
  const isShown = (key: string) => shown.some((k) => canonicalKey(k) === canonicalKey(key))

  const writeOrder = (order: string[]) =>
    onUpdate((d) => {
      d.views[viewIndex].order = order
    })
  const toggle = (key: string) => writeOrder(isShown(key) ? shown.filter((k) => canonicalKey(k) !== canonicalKey(key)) : [...shown, key])
  const move = (key: string, dir: -1 | 1) => {
    const i = shown.indexOf(key)
    const next = [...shown]
    next.splice(i, 1)
    next.splice(i + dir, 0, key)
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

  return (
    <div className="view-menu">
      <ul className="view-menu__list">
        {keys.map((key) => {
          const on = isShown(key)
          const i = shown.indexOf(key)
          const label = propertyLabel(def, key)
          const decl = folderPage.settings.columns[bare(key)]
          const isNote = canonicalKey(key).startsWith('note.')
          return (
            <li key={key} className="view-prop">
              <div className="view-prop__identity">
                <input
                  type="checkbox"
                  aria-label={`Show ${label}`}
                  checked={on}
                  disabled={canonicalKey(key) === 'file.name'}
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
              {(isNote || on) && (
                <div className="view-prop__controls">
                  {isNote && (
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
                  )}
                  {(decl?.kind === 'link' || decl?.kind === 'multi-link') && (
                    <TextField
                      className="view-input view-relation__target"
                      aria-label={`Target of ${label}`}
                      placeholder="Any page"
                      value={decl.target ?? ''}
                      onCommit={(target) => setTarget(bare(key), target)}
                    />
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
                  {on && (
                    <>
                      <button type="button" className="view-rule__nav" aria-label="Move up" disabled={i <= 0} onClick={() => move(key, -1)}>
                        ↑
                      </button>
                      <button type="button" className="view-rule__nav" aria-label="Move down" disabled={i < 0 || i === shown.length - 1} onClick={() => move(key, 1)}>
                        ↓
                      </button>
                    </>
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
