import { useState } from 'react'
import { PROPERTY_NAME } from '@shared/types'
import type { ColumnDecl } from '../folderPageSettings'
import { PropertyDefinitionEditor } from './PropertyDefinitionEditor'
import { canonicalKey } from './keys'

export interface AddColumnProps {
  /** Every key the menu already offers — the folder page's DECLARED columns among them (YAZ-895). */
  taken: readonly string[]
  onSave: (name: string, column: ColumnDecl) => void
  /** Start on the form rather than the "+ Add column" button (the header menu's "Add column to the right…", YAZ-1513). */
  autoOpen?: boolean
  /** Offered as a Cancel button when given; the form also closes on its own after a save. */
  onCancel?: () => void
}

/**
 * "+ Add column" (YAZ-896): declare a column on the FOLDER PAGE — the typing ladder's top rung
 * (🔒 Q8) — and show it, in one `folder_page_settings` write (🔒 D3). A name that is not a
 * property name, or one the menu already offers, is refused inline and nothing is written. It
 * lived inside `PropertiesMenu.tsx` until YAZ-1513 gave the table header a second doorway to it.
 */
export function AddColumn({ taken, onSave, autoOpen = false, onCancel }: AddColumnProps) {
  const [open, setOpen] = useState(autoOpen)
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState<ColumnDecl>({ kind: 'text' })
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
    const { kind, target, options, optionSort } = definition
    const column: ColumnDecl = { kind, ...((kind === 'select' || kind === 'multi-select') ? { options: options ?? [], ...(optionSort ? { optionSort } : {}) } : {}) }
    // A target typed under a link kind must not ride into a non-link declaration after a kind switch.
    if ((kind === 'link' || kind === 'multi-link') && target?.trim()) column.target = target.trim()
    onSave(key, column)
    setOpen(false)
    setName('')
    setDefinition({ kind: 'text' })
    setError(null)
  }

  return (
    <div className="view-relation">
      <input className="view-input" aria-label="Column name" placeholder="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <PropertyDefinitionEditor value={definition} onChange={setDefinition} />
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
