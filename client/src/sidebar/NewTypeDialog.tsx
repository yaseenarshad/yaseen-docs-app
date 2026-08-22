import { useEffect, useState } from 'react'
import { REGISTRY_PROPERTY_KINDS, type RegistryPropertyDef, type RegistryPropertyKind } from '@shared/types'
import { createType } from '../bases/scaffold'
import { validateEntryName } from './createEntry'

/**
 * "New type…" (Bible B, GRO-2202): the deliberate database-feel moment — name the type, pick
 * its properties (name + kind + optional link target), and one Create lands the registry entry
 * AND the starter `All <plural>.base` at the vault root (Round 9 record; Q3: NO template stub).
 * The grammars mirror the registry boundary (R2.2), which enforces them again.
 */

const TYPE_NAME = /^[a-z][a-z0-9-]*$/
const PROPERTY_NAME = /^[a-z][a-z0-9_]*$/

/** 'funnel-stage' → 'Funnel Stage'; the dialog derives display names until overridden. */
export function deriveDisplayName(name: string): string {
  return name
    .split('-')
    .filter((s) => s !== '')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ')
}

interface PropertyRow {
  name: string
  kind: RegistryPropertyKind
  target: string
}

interface NewTypeDialogProps {
  root: string
  onClose: () => void
  /** Fired after the registry entry + starter base landed (the sidebar refreshes its tree). */
  onCreated: () => void
}

export function NewTypeDialog({ root, onClose, onCreated }: NewTypeDialogProps) {
  const [name, setName] = useState('')
  /** null = derived from the type name; a string once the user overrides. */
  const [display, setDisplay] = useState<string | null>(null)
  const [plural, setPlural] = useState<string | null>(null)
  const [rows, setRows] = useState<PropertyRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shownDisplay = display ?? deriveDisplayName(name)
  const shownPlural = plural ?? (shownDisplay === '' ? '' : `${shownDisplay}s`)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setRow = (i: number, patch: Partial<PropertyRow>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  const submit = async () => {
    if (busy) return
    const typeName = name.trim()
    if (!TYPE_NAME.test(typeName)) {
      setError('Type names are kebab-case: lowercase letters, digits and "-" (e.g. funnel-stage)')
      return
    }
    const properties: Record<string, RegistryPropertyDef> = {}
    for (const row of rows) {
      const propName = row.name.trim()
      if (propName === '') continue // an untouched row is just skipped
      if (!PROPERTY_NAME.test(propName) || propName === 'page_type') {
        setError(`"${propName}" is not a valid property name (snake_case; page_type is the identity and never declared)`)
        return
      }
      const target = row.target.trim()
      properties[propName] =
        (row.kind === 'link' || row.kind === 'multi-link') && target !== '' ? { kind: row.kind, target } : { kind: row.kind }
    }
    const pluralName = shownPlural.trim()
    const invalidPlural = pluralName === '' ? 'Plural name is required (it names the starter base)' : validateEntryName(pluralName)
    if (invalidPlural !== null) {
      setError(`Plural name: ${invalidPlural}`)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await createType(root, typeName, { displayName: shownDisplay.trim(), pluralName, properties })
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="type-dialog__overlay" onMouseDown={onClose}>
      <div className="type-dialog" role="dialog" aria-label="New type" onMouseDown={(e) => e.stopPropagation()}>
        <p className="type-dialog__title">New type</p>
        <label className="type-dialog__label" htmlFor="type-dialog-name">
          Type name
        </label>
        <input
          id="type-dialog-name"
          className="type-dialog__input"
          aria-label="Type name"
          placeholder="kpi"
          autoFocus
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="type-dialog__label" htmlFor="type-dialog-display">
          Display name
        </label>
        <input
          id="type-dialog-display"
          className="type-dialog__input"
          aria-label="Display name"
          spellCheck={false}
          value={shownDisplay}
          onChange={(e) => setDisplay(e.target.value)}
        />
        <label className="type-dialog__label" htmlFor="type-dialog-plural">
          Plural name
        </label>
        <input
          id="type-dialog-plural"
          className="type-dialog__input"
          aria-label="Plural name"
          spellCheck={false}
          value={shownPlural}
          onChange={(e) => setPlural(e.target.value)}
        />
        <p className="type-dialog__label">Properties</p>
        {rows.map((row, i) => (
          // Rows are append/remove only, so the index is a stable identity here.
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="type-dialog__row">
            <input
              className="type-dialog__input"
              aria-label={`Property ${i + 1} name`}
              placeholder="property_name"
              spellCheck={false}
              value={row.name}
              onChange={(e) => setRow(i, { name: e.target.value })}
            />
            <select
              className="type-dialog__select"
              aria-label={`Property ${i + 1} kind`}
              value={row.kind}
              onChange={(e) => setRow(i, { kind: e.target.value as RegistryPropertyKind })}
            >
              {REGISTRY_PROPERTY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            {(row.kind === 'link' || row.kind === 'multi-link') && (
              <input
                className="type-dialog__input"
                aria-label={`Property ${i + 1} target`}
                placeholder="target type"
                spellCheck={false}
                value={row.target}
                onChange={(e) => setRow(i, { target: e.target.value })}
              />
            )}
            <button
              type="button"
              className="type-dialog__remove"
              aria-label={`Remove property ${i + 1}`}
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="type-dialog__add" onClick={() => setRows((r) => [...r, { name: '', kind: 'text', target: '' }])}>
          Add property
        </button>
        {error !== null && (
          <p className="type-dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="type-dialog__actions">
          <button type="button" className="type-dialog__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="type-dialog__btn type-dialog__btn--primary" disabled={busy} onClick={() => void submit()}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
