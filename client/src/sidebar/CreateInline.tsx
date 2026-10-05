import { useRef, useState } from 'react'
import type { EntryKind } from './createEntry'

/** Placeholder per entry kind; what is typed is its title, and the name on disk is built from it (YAZ-2420 🔒 D6, D20). */
const PLACEHOLDER: Record<EntryKind, string> = { file: 'New note', dir: 'New folder' }

interface CreateInlineProps {
  kind: EntryKind
  /** Left padding so the input lines up with rows at its depth. */
  indent: number
  /** Called with the non-empty title, free text; rejects with a message to keep editing. */
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
  /** Text the box starts with (YAZ-1604); the caret lands at its end. Default empty, as today. */
  seed?: string
}

/** VS Code-style inline name input rendered inside the tree (GRO-2022 D2). */
export function CreateInline({ kind, indent, onSubmit, onCancel, seed = '' }: CreateInlineProps) {
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)

  const submit = async (value: string) => {
    const name = value.trim()
    if (name === '' || name === seed.trim() || submitting.current) return
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
        defaultValue={seed}
        onFocus={(e) => e.currentTarget.setSelectionRange(seed.length, seed.length)}
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
