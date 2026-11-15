import { useState } from 'react'
import { findKey, keyFold } from '@shared/propertyKeys'
import { PROPERTY_KINDS, builtInPrefixRefusal, isPropertyName } from '@shared/types'
import { reservedKeyText } from '../../links/reservedKeys'
import type { ColumnDecl } from '../folderSettings'
import { PropertyDefinitionEditor } from './PropertyDefinitionEditor'
import { declarationForKind } from './declarationForKind'
import { canonicalKey } from './keys'

export interface AddColumnProps {
  /** Every key the menu already offers — the folder's DECLARED columns among them (YAZ-895). */
  taken: readonly string[]
  /** The view's shown keys: a taken name that is not among them is SHOWN, not refused (YAZ-4535 S1). */
  shown: readonly string[]
  /** The app's own keys in this vault (`reservedKeys`): refused, as the Properties panel refuses them (D19, YAZ-4544). */
  reserved: ReadonlySet<string>
  onSave: (name: string, column: ColumnDecl) => void
  /** S1: show the existing column `key` (as `taken` spells it) — no declaration, no twin. */
  onShow: (key: string) => void
  /** Start on the form rather than the "+ Add column" button (the header menu's "Add column to the right…", YAZ-1513). */
  autoOpen?: boolean
  /** Offered as a Cancel button when given; the form also closes on its own after a save. */
  onCancel?: () => void
}

/**
 * "+ Add column" (YAZ-896): declare a column on the FOLDER — the typing ladder's top rung
 * (🔒 Q8) — and show it, in one `folder_settings` write (🔒 D3). Any name is the key, as typed
 * (YAZ-4535, D19: `isPropertyName`). A name the folder has already — a note property or a declared
 * column — is SHOWN when the view hides it (S1: no twin), and refused when the view shows it. It
 * lived inside `PropertiesMenu.tsx` until YAZ-1513 gave the table header a second doorway to it.
 */
export function AddColumn({ taken, shown, reserved, onSave, onShow, autoOpen = false, onCancel }: AddColumnProps) {
  const [open, setOpen] = useState(autoOpen)
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState<ColumnDecl>({ kind: 'text' })
  const [error, setError] = useState<string | null>(null)
  /** YAZ-4769: the line after a name that was an existing column in other capitals, "Using "Dessert Column", which already exists." */
  const [using, setUsing] = useState<string | null>(null)

  if (!open)
    return (
      <>
        <button
          type="button"
          className="view-menu__action"
          onClick={() => {
            setUsing(null)
            setOpen(true)
          }}
        >
          + Add column
        </button>
        {using !== null && (
          <span className="view-relation__dest" role="status">
            {using}
          </span>
        )}
      </>
    )

  const save = () => {
    const key = name.trim()
    if (!isPropertyName(key)) {
      setError('Type a name')
      return
    }
    // In any capitals (YAZ-4769): "ReadOnly" is the app's `readonly`.
    const app = findKey(reserved, key)
    if (app !== undefined) {
      setError(reservedKeyText(app))
      return
    }
    // A built-in prefix (YAZ-4637 M7): `file.x` would read as a file field, never as this column.
    const clash = builtInPrefixRefusal(key)
    if (clash !== null) {
      setError(clash)
      return
    }
    // YAZ-4769 (one key, capitals ignored): "dessert column" names the existing "Dessert Column", in its spelling.
    const c = keyFold(canonicalKey(key))
    const existing = taken.find((k) => keyFold(canonicalKey(k)) === c)
    const spelled = existing === undefined ? key : canonicalKey(existing).slice('note.'.length)
    if (existing !== undefined && shown.some((k) => keyFold(canonicalKey(k)) === c)) {
      setError(spelled === key ? `${key} is already a column` : `"${spelled}" is already a column`)
      return
    }
    setUsing(existing !== undefined && spelled !== key ? `Using "${spelled}", which already exists.` : null)
    if (existing !== undefined) onShow(existing)
    else {
      // The one kind rule (YAZ-1549): a target typed under a link kind never rides into a non-link
      // declaration after a kind switch, and a choice kind is born with its option list.
      onSave(key, declarationForKind({ ...definition, target: definition.target?.trim() }, definition.kind))
    }
    setOpen(false)
    setName('')
    setDefinition({ kind: 'text' })
    setError(null)
  }

  return (
    <div className="view-relation">
      <input className="view-input" aria-label="Column name" placeholder="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <PropertyDefinitionEditor value={definition} onChange={setDefinition} kinds={PROPERTY_KINDS} />
      <button type="button" className="view-menu__action" aria-label="Save column" onClick={save}>
        Save
      </button>
      {onCancel !== undefined && (
        <button type="button" className="view-menu__action" aria-label="Cancel column" onClick={onCancel}>
          Cancel
        </button>
      )}
      {error !== null && (
        <span className="view-relation__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
