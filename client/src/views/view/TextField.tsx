import { useEffect, useRef, useState } from 'react'

interface TextFieldProps {
  value: string
  /** The new text, once per edit (Enter or blur) and only when it differs from `value`. */
  onCommit: (next: string) => void
  /** Canonicalizes a committed draft; null rejects it and visibly restores `value`. */
  normalize?: (draft: string) => string | null
  /** After Enter, blur or Escape, whether or not anything was committed. */
  onDone?: () => void
  /** Enter commits the text also when it is still `value`: a suggested name that is right as it stands (YAZ-2602 S63). Blur still commits an edit only. */
  commitOnEnter?: boolean
  className?: string
  placeholder?: string
  type?: 'text' | 'date' | 'number'
  inputMode?: 'decimal'
  min?: number
  step?: number
  /** `id` of a `datalist` the caller renders — value suggestions (YAZ-1232). */
  list?: string
  autoFocus?: boolean
  /** Select the whole value when the field mounts, so typing replaces it (Finder's rename, YAZ-1974 D5). */
  selectOnMount?: boolean
  'aria-label'?: string
}

/** Text input that reports its value once per edit (GRO-2135), so every config change is one `onChange`. */
export function TextField({ value, onCommit, normalize, onDone, commitOnEnter, selectOnMount, ...rest }: TextFieldProps) {
  const [draft, setDraft] = useState(value)
  const done = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (selectOnMount === true) input.current?.select()
  }, [])

  const finish = (commit: boolean, same = false) => {
    if (done.current) return
    done.current = true
    if (commit && (same || draft !== value)) {
      const next = normalize === undefined ? draft : normalize(draft)
      if (next === null) setDraft(value)
      else {
        setDraft(next)
        if (same || next !== value) onCommit(next)
      }
    } else if (!commit) setDraft(value)
    onDone?.()
  }

  return (
    <input
      {...rest}
      ref={input}
      value={draft}
      onChange={(e) => {
        done.current = false
        setDraft(e.target.value)
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true, commitOnEnter)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
