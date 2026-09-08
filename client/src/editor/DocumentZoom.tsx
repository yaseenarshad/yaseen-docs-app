import { useId, useRef, useState } from 'react'

const PRESETS = [50, 75, 90, 100, 125, 150, 200]

export function DocumentZoom({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = (next: number) => {
    onChange(next)
    setDraft(null)
    setError(false)
    setOpen(false)
  }
  const apply = () => {
    if (draft === null) return
    const text = draft.trim()
    const next = Number(text.replace(/%$/, ''))
    if (!/^\d{1,3}%?$/.test(text) || next < 50 || next > 200) {
      setError(true)
      return
    }
    commit(next)
  }

  return (
    <div className="document-zoom" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setOpen(false)
        apply()
      }
    }} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDraft(null)
        setError(false)
        setOpen(false)
        inputRef.current?.focus()
      }
    }}>
      <div className="document-zoom__field">
        <input ref={inputRef} aria-label="Document zoom" aria-invalid={error}
          aria-describedby={error ? errorId : undefined} inputMode="numeric"
          title="Document zoom (50–200%)" value={draft ?? `${value}%`}
          onFocus={(event) => event.target.select()}
          onChange={(event) => { setDraft(event.target.value); setError(false) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); apply(); inputRef.current?.select() }
          }} />
        <button type="button" aria-label="Zoom presets" aria-expanded={open}
          onClick={() => { setOpen(!open); setError(false) }}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="m2 3 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
      {open && <div className="document-zoom__presets" role="group" aria-label="Zoom presets">
        {PRESETS.map((preset) => <button key={preset} type="button" aria-pressed={value === preset}
          onClick={() => { commit(preset); inputRef.current?.focus(); inputRef.current?.select() }}>
          <span>{preset}%</span><span aria-hidden="true">{value === preset ? '✓' : ''}</span>
        </button>)}
      </div>}
      {error && <div id={errorId} role="alert" className="document-zoom__error">Use a whole number from 50–200%.</div>}
    </div>
  )
}
