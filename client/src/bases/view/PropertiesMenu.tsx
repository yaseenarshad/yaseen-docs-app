import { useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView } from '../baseFile'
import { propertyKeys, propertyLabel } from '../engine'
import type { Mutate } from './FilterMenu'
import { canonicalKey } from './filterRows'
import { PencilIcon } from './icons'
import { markerStyleOf } from './ListView'
import { allPropertyKeys } from './properties'
import { TextField } from './TextField'

export interface PropertiesMenuProps {
  def: BaseDefinition
  view: BaseView
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
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
 */
export function PropertiesMenu({ def, view, viewIndex, records, onUpdate }: PropertiesMenuProps) {
  const [editing, setEditing] = useState<string | null>(null)
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
