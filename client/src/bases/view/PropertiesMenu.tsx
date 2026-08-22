import { useState } from 'react'
import type { IndexRecord, RegistryPropertyDef, RegistryResponse, RegistryScope } from '@shared/types'
import type { BaseDefinition, BaseView } from '../baseFile'
import { propertyKeys, propertyLabel } from '../engine'
import { registry as registryApi } from '../useRegistry'
import type { Mutate } from './FilterMenu'
import { canonicalKey } from './filterRows'
import { PencilIcon, RelationIcon } from './icons'
import { markerStyleOf } from './ListView'
import { allPropertyKeys } from './properties'
import { TextField } from './TextField'

export interface PropertiesMenuProps {
  def: BaseDefinition
  view: BaseView
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
  /** Relation columns (5E, GRO-2217): the vault root (null = unknown, no relation editor), the view's pinned type, the registry. */
  root?: string | null
  pinned?: string | null
  registry?: RegistryResponse | null
}

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

/** The `def.properties` entry a key's display name lives in: as written, bare, or `note.`-prefixed; else the bare form. */
function entryKey(def: BaseDefinition, key: string): string {
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
 * target type, saved through `registry.setProperty` to the pinned type's schema (or vault
 * properties when the view pins none), with the destination labelled either way.
 */
export function PropertiesMenu({ def, view, viewIndex, records, onUpdate, root = null, pinned = null, registry = null }: PropertiesMenuProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [relationFor, setRelationFor] = useState<string | null>(null)
  const shown = propertyKeys(def, view, records)
  const keys = allPropertyKeys(def, view, records)
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
    <div className="base-menu">
      <ul className="base-menu__list">
        {keys.map((key) => {
          const on = isShown(key)
          const i = shown.indexOf(key)
          const label = propertyLabel(def, key)
          return (
            <li key={key} className="base-prop">
              <input
                type="checkbox"
                aria-label={`Show ${label}`}
                checked={on}
                disabled={canonicalKey(key) === 'file.name'}
                onChange={() => toggle(key)}
              />
              {editing === key ? (
                <TextField
                  className="base-input base-prop__rename"
                  aria-label="Display name"
                  placeholder={bare(key)}
                  autoFocus
                  value={def.properties?.[entryKey(def, key)]?.displayName ?? ''}
                  onCommit={(name) => setDisplayName(key, name)}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <span className="base-prop__name">
                  {label}
                  {label !== key && <small>{key}</small>}
                </span>
              )}
              <button type="button" className="base-rule__nav" aria-label={`Rename ${label}`} title="Display name" onClick={() => setEditing(key)}>
                <PencilIcon />
              </button>
              {root !== null && canonicalKey(key).startsWith('note.') && (
                <button
                  type="button"
                  className="base-rule__nav"
                  aria-label={`Relation for ${label}`}
                  title="Relation"
                  aria-expanded={relationFor === key}
                  onClick={() => setRelationFor(relationFor === key ? null : key)}
                >
                  <RelationIcon />
                </button>
              )}
              {relationFor === key && root !== null && (
                <RelationEditor
                  root={root}
                  propKey={bare(key)}
                  pinned={pinned}
                  registry={registry}
                  onDone={() => setRelationFor(null)}
                />
              )}
              {on && (
                <>
                  <button type="button" className="base-rule__nav" aria-label="Move up" disabled={i <= 0} onClick={() => move(key, -1)}>
                    ↑
                  </button>
                  <button type="button" className="base-rule__nav" aria-label="Move down" disabled={i < 0 || i === shown.length - 1} onClick={() => move(key, 1)}>
                    ↓
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {view.type === 'list' && (
        <>
          <p className="base-menu__label">List</p>
          <div className="base-list-settings">
            <select
              className="base-select"
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
            <label className="base-menu__toggle">
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
              className="base-input"
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

interface RelationEditorProps {
  root: string
  /** Bare frontmatter key — registry declarations are keyed bare, like `.obsidian/types.json`. */
  propKey: string
  pinned: string | null
  registry: RegistryResponse | null
  onDone: () => void
}

/**
 * The relation editor for one column (5E, GRO-2217; contract GRO-2120 §4): single-vs-multiple
 * toggle (link vs multi-link) and a target type — registry type names offered, free text legal
 * since a target naming an unregistered type just widens the picker (§3). Saving calls
 * `registry.setProperty(root, scope, key, { kind, target })` where the scope is the view's
 * pinned type, else `'vault'`; the destination is labelled so the split is legible. Values are
 * untouched: cells keep committing wiki-link strings/lists through `writeProperty`.
 */
function RelationEditor({ root, propKey, pinned, registry, onDone }: RelationEditorProps) {
  const declared = (pinned !== null ? registry?.types[pinned]?.properties[propKey] : undefined) ?? registry?.properties[propKey]
  const relation = declared?.kind === 'link' || declared?.kind === 'multi-link' ? declared : undefined
  const [multiple, setMultiple] = useState(relation?.kind === 'multi-link')
  const [target, setTarget] = useState(relation?.target ?? '')
  const [error, setError] = useState<string | null>(null)
  const listId = `base-relation-types-${propKey}`

  const save = () => {
    const scope: RegistryScope = pinned !== null ? { type: pinned } : 'vault'
    const def: RegistryPropertyDef = { kind: multiple ? 'multi-link' : 'link' }
    if (target.trim() !== '') def.target = target.trim()
    setError(null)
    registryApi.setProperty(root, scope, propKey, def).then(onDone, (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  return (
    <div className="base-relation">
      <label className="base-menu__toggle">
        <input type="checkbox" aria-label="Multiple" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
        Multiple
      </label>
      <input
        className="base-input base-relation__target"
        aria-label="Target type"
        placeholder="Any page"
        list={listId}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />
      <datalist id={listId}>
        {Object.keys(registry?.types ?? {}).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button type="button" className="base-menu__action" aria-label="Save relation" onClick={save}>
        Save
      </button>
      <small className="base-relation__dest">{pinned !== null ? `Saved to ${pinned} schema` : 'Saved to vault properties'}</small>
      {error !== null && (
        <span className="base-relation__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
