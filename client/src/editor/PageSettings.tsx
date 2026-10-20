import { useEffect, useId, useRef, useState } from 'react'
import type { TocSource } from '@shared/types'
import { CogIcon } from '../settings/SettingsButton'

/** "TOC made from" (YAZ-2700 D14): Auto is the absence of a choice, `null`, and stands first — it is what a note has until the reader chooses. */
const TOC_SOURCE_CHOICES: readonly { label: string; value: TocSource | null }[] = [
  { label: 'Auto', value: null },
  { label: 'Headings', value: 'headings' },
  { label: 'Bullets', value: 'bullets' },
]

/**
 * The page's own quick switches (YAZ-2643): a cog left of the zoom pill, and a small menu under it.
 * Nothing here is stored. The host editor keeps the state, so a switch lasts as long as its tab —
 * all but section indent (YAZ-2709), "Table of contents" (YAZ-2950) and "TOC made from" (YAZ-2700
 * D14), which the host saves with the note. "Line numbers" and "Heading levels" are never saved.
 */
export function PageSettings({ lineNumbers, onToggleLineNumbers, sectionIndent, onToggleSectionIndent, headingLevels, onToggleHeadingLevels, tableOfContents = true, onToggleTableOfContents, tocSource = null, onChangeTocSource, readText }: {
  lineNumbers: boolean
  onToggleLineNumbers: () => void
  /** This page's text stands below its headings (YAZ-2709); how it looks is in Settings › Editor › Section indent. */
  sectionIndent: boolean
  onToggleSectionIndent: () => void
  /** Every heading wears its level, "H2", after its text (YAZ-2700). Without the switch on, only the heading in hand does. */
  headingLevels: boolean
  onToggleHeadingLevels: () => void
  /** This page shows its table of contents (YAZ-2700). On unless the reader turns it off for this page. */
  tableOfContents?: boolean
  /** Absent → the menu has no "Table of contents" row (the app-wide setting is Off: there is nothing to turn off here). */
  onToggleTableOfContents?: () => void
  /** What this page's table of contents is built from (YAZ-2700 D14): its headings, its bullets, or `null` — Auto, the page's own structure decides. */
  tocSource?: TocSource | null
  /** Absent → the menu has no "TOC made from" choice (this page shows no table of contents: there is nothing to build). */
  onChangeTocSource?: (source: TocSource | null) => void
  /** The page's plain text. Read once when the menu opens, never while it is closed. */
  readText: () => string
}) {
  // The text counted at the open IS the open state: the counts cannot drift while the menu shows.
  const [text, setText] = useState<string | null>(null)
  const open = text !== null
  // The explanation behind the small "i" beside "TOC made from": shown while the mouse or the keyboard is on it.
  const [info, setInfo] = useState(false)
  const setOpen = (next: boolean) => {
    setText(next ? readText() : null)
    // The explanation goes with the menu: a menu that closes under a mouse at rest sends the "i" no
    // `mouseleave`, and the text would stand there, unasked, at the next open.
    if (!next) setInfo(false)
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const tipId = useId()

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
        <button type="button" aria-pressed={headingLevels} onClick={onToggleHeadingLevels}>
          <span>Heading levels</span><span aria-hidden="true">{headingLevels ? '✓' : ''}</span>
        </button>
        {onToggleTableOfContents !== undefined && <button type="button" aria-pressed={tableOfContents} onClick={onToggleTableOfContents}>
          <span>Table of contents</span><span aria-hidden="true">{tableOfContents ? '✓' : ''}</span>
        </button>}
        {/* Three choices that read as ONE control: a label, then the group. All three stay in sight, so a source that gives no list can be changed back. */}
        {onChangeTocSource !== undefined && <>
          <p className="page-settings__label">
            TOC made from:
            <button type="button" className="page-settings__info" aria-label="About “TOC made from”" aria-describedby={info ? tipId : undefined}
              onMouseEnter={() => setInfo(true)} onMouseLeave={() => setInfo(false)} onFocus={() => setInfo(true)} onBlur={() => setInfo(false)}>
              <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
                <circle cx="8" cy="8" r="6.3" /><path d="M8 7.4v3.4M8 5v.2" />
              </svg>
            </button>
          </p>
          <div className="page-settings__choices" role="group" aria-label="TOC made from">
            {TOC_SOURCE_CHOICES.map(({ label, value }) => (
              <button key={label} type="button" aria-pressed={value === tocSource} onClick={() => onChangeTocSource(value)}>{label}</button>
            ))}
          </div>
        </>}
        <div className="page-settings__divider" aria-hidden="true" />
        <p>{(text.match(/\S+/g)?.length ?? 0).toLocaleString()} words</p>
        <p>{text.length.toLocaleString()} characters</p>
      </div>}
      {/* BESIDE the menu, not in it: the menu scrolls and is 172px wide, and this is a short text to read. */}
      {open && info && <div id={tipId} role="tooltip" className="page-settings__tip">
        <p>This sets what the table of contents of this page shows.</p>
        <dl>
          <dt>Auto</dt>
          <dd>The app selects. A page with two or more headings outside bullets shows its headings. Each other page shows its bullets.</dd>
          <dt>Headings</dt>
          <dd>Shows each heading from H1 to H5. This includes the headings that are in bullets.</dd>
          <dt>Bullets</dt>
          <dd>Shows the bullets, to three levels.</dd>
        </dl>
        <p>If a selection finds less than two lines, no table of contents shows. Select Auto to get it back.</p>
        <p>The app saves the selection for this page.</p>
      </div>}
    </div>
  )
}
