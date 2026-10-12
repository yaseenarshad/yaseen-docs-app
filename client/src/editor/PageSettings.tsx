import { useEffect, useId, useRef, useState } from 'react'
import { CogIcon } from '../settings/SettingsButton'

/**
 * The page's own quick switches (YAZ-2643): a cog left of the zoom pill, and a small menu under it.
 * Nothing here is stored. The host editor keeps the state: line numbers last as long as the tab,
 * and section indent (YAZ-2709) is remembered for the page.
 */
export function PageSettings({ lineNumbers, onToggleLineNumbers, sectionIndent, onToggleSectionIndent, readText }: {
  lineNumbers: boolean
  onToggleLineNumbers: () => void
  /** This page's text stands below its headings (YAZ-2709); how it looks is in Settings › Editor › Section indent. */
  sectionIndent: boolean
  onToggleSectionIndent: () => void
  /** The page's plain text. Read once when the menu opens, never while it is closed. */
  readText: () => string
}) {
  // The text counted at the open IS the open state: the counts cannot drift while the menu shows.
  const [text, setText] = useState<string | null>(null)
  const open = text !== null
  const setOpen = (next: boolean) => setText(next ? readText() : null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onOutsideClick)
    return () => document.removeEventListener('click', onOutsideClick)
  }, [open])

  return (
    <div ref={rootRef} className="page-settings"
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }}>
      <button ref={triggerRef} type="button" className="page-settings__trigger" aria-label="Page settings"
        aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        <CogIcon size={13} />
      </button>
      {text !== null && <div id={menuId} className="page-settings__menu" role="group" aria-label="Page settings">
        <button type="button" aria-pressed={lineNumbers} onClick={onToggleLineNumbers}>
          <span>Line numbers</span><span aria-hidden="true">{lineNumbers ? '✓' : ''}</span>
        </button>
        <button type="button" aria-pressed={sectionIndent} onClick={onToggleSectionIndent}>
          <span>Section indent</span><span aria-hidden="true">{sectionIndent ? '✓' : ''}</span>
        </button>
        <div className="page-settings__divider" aria-hidden="true" />
        <p>{(text.match(/\S+/g)?.length ?? 0).toLocaleString()} words</p>
        <p>{text.length.toLocaleString()} characters</p>
      </div>}
    </div>
  )
}
