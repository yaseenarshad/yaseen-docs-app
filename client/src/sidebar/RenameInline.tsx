import { useRef, useState } from 'react'
import { validateEntryName } from './createEntry'

interface RenameInlineProps {
  /** The current name minus its extension — the prefill (the extension re-appends on commit). */
  initial: string
  /** Left padding so the input lines up with the file row it replaces. */
  indent: number
  /** Called with the validated, non-empty name; rejects with a message to keep editing. */
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/**
 * Inline rename input replacing a file row's label (Links E1, GRO-2194) — the CreateInline
 * idiom: Enter commits, Esc/blur cancels, `validateEntryName` errors keep the input open.
 * Bridge failures never land here: the submit handler routes them to the passive notice.
 */
export function RenameInline({ initial, indent, onSubmit, onCancel }: RenameInlineProps) {
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
      setError(err instanceof Error ? err.message : 'Could not rename')
      submitting.current = false
    }
  }

  return (
    <div className="create-inline" style={{ paddingLeft: indent }}>
      <input
        autoFocus
        className={`create-inline__input${error !== null ? ' create-inline__input--error' : ''}`}
        defaultValue={initial}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          // preventDefault is load-bearing since ⚡ YAZ-888: a NAME change now opens the confirm
          // sheet, which takes focus on CANCEL — and Enter's own default activation would then
          // land on that freshly focused button and cancel the rename the keystroke just asked for.
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit(e.currentTarget.value)
          } else if (e.key === 'Escape') onCancel()
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
