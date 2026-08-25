import { useRef, useState } from 'react'
import { validateEntryName, type EntryKind } from './createEntry'

/** Placeholder per entry kind; the extension is implied (added by `entryPath`). */
const PLACEHOLDER: Record<EntryKind, string> = { file: 'New note', folderPage: 'New folder page', dir: 'New folder' }

interface CreateInlineProps {
  kind: EntryKind
  /** Left padding so the input lines up with rows at its depth. */
  indent: number
  /** Called with the validated, non-empty name; rejects with a message to keep editing. */
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/** VS Code-style inline name input rendered inside the tree (GRO-2022 D2). */
export function CreateInline({ kind, indent, onSubmit, onCancel }: CreateInlineProps) {
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)

  const submit = async (value: string) => {
    const name = value.trim()
    if (name === '' || submitting.current) return
    const invalid = validateEntryName(name)
    if (invalid !== null) {
      setError(invalid)
      return
    }
    submitting.current = true
    try {
      await onSubmit(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create')
      submitting.current = false
    }
  }

  return (
    <div className="create-inline" style={{ paddingLeft: indent }}>
      <input
        autoFocus
        className={`create-inline__input${error !== null ? ' create-inline__input--error' : ''}`}
        placeholder={PLACEHOLDER[kind]}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit(e.currentTarget.value)
          else if (e.key === 'Escape') onCancel()
          else setError(null)
        }}
        onBlur={() => {
          if (!submitting.current) onCancel()
        }}
      />
      {error !== null && <p className="create-inline__error">{error}</p>}
    </div>
  )
}
