import { useEffect, useId, useRef, useState } from 'react'

const PRESETS = [50, 75, 90, 100, 125, 150, 200]

const parseZoom = (draft: string): number | null => {
  const text = draft.trim()
  const next = Number(text.replace(/%$/, ''))
  return /^\d{1,3}%?$/.test(text) && next >= 50 && next <= 200 ? next : null
}

export function DocumentZoom({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<string | null>(null)
  const menuId = useId()
  const inputId = useId()
  const errorId = useId()

  const updateDraft = (next: string | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const close = (focusTrigger: boolean) => {
    updateDraft(null)
    setError(false)
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  const commit = (next: number, focusTrigger: boolean) => {
    draftRef.current = null
    onChange(next)
    setDraft(null)
    setError(false)
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  const apply = (focusTrigger: boolean) => {
    const currentDraft = draftRef.current
    if (currentDraft === null) return
    const next = parseZoom(currentDraft)
    if (next === null) {
      setError(true)
      return
    }
    commit(next, focusTrigger)
  }

  const showMenu = () => {
    updateDraft(`${value}%`)
    setError(false)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) apply(false)
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [open, draft, onChange])

  return (
    <div ref={rootRef} className="document-zoom"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) apply(false)
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close(true)
        }
      }}>
      <button ref={triggerRef} type="button" className="document-zoom__trigger"
        aria-label={`Document zoom: ${value}%`} aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => { if (open) close(false); else showMenu() }}>
        <span className="document-zoom__value">{value}%</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="m2 3 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      {open && <div id={menuId} className="document-zoom__menu" role="group" aria-label="Zoom options">
        <div className="document-zoom__custom">
          <label htmlFor={inputId}>Custom</label>
          <input ref={inputRef} id={inputId} inputMode="numeric" title="Document zoom (50–200%)"
            value={draft ?? `${value}%`} aria-invalid={error}
            aria-describedby={error ? errorId : undefined}
            onFocus={(event) => event.target.select()}
            onChange={(event) => { updateDraft(event.target.value); setError(false) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                apply(true)
              }
            }} />
          {error && <div id={errorId} role="alert" className="document-zoom__error">
            Use a whole number from 50–200%.
          </div>}
        </div>
        <div className="document-zoom__divider" aria-hidden="true" />
        <div className="document-zoom__presets" role="group" aria-label="Zoom presets">
          {PRESETS.map((preset) => <button key={preset} type="button" aria-pressed={value === preset}
            onClick={() => commit(preset, true)}>
            <span>{preset}%</span><span aria-hidden="true">{value === preset ? '✓' : ''}</span>
          </button>)}
        </div>
      </div>}
    </div>
  )
}
