import { type FocusEvent, Fragment, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Dropdown } from '../views/view/Dropdown'
import { createPortal } from 'react-dom'
import { BLOCK_WIDTH_MAX, BLOCK_WIDTH_MIN, type OutsideChangeGlow, type TocSource } from '@shared/types'
import { OUTSIDE_CHANGE_GLOW_OPTIONS } from '../settings/options'
import { CogIcon } from '../settings/SettingsButton'

/** "TOC made from" (YAZ-2700 D14): Auto is the absence of a choice, `null`, and stands first — it is what a note has until the reader chooses. */
const TOC_SOURCE_CHOICES: readonly { label: string; value: TocSource | null }[] = [
  { label: 'Auto', value: null },
  { label: 'Headings', value: 'headings' },
  { label: 'Bullets', value: 'bullets' },
]

/**
 * One row of the menu (YAZ-3449): a label, its check mark while on, and what a click does. A drawing's
 * rows (YAZ-3943 D5, D13) add three kinds: an ACTION row (no `on`: no check mark, and a click closes
 * the menu), an INFO row (no `onToggle`: plain text), and a DISABLED action (greyed out, no click).
 */
export interface PageSwitch {
  label: string
  /** Absent: an action row, with no check mark. */
  on?: boolean
  /** Absent: an info row. */
  onToggle?: () => void
  disabled?: boolean
  /** Amber text: a size past its warning line. */
  warn?: boolean
  /** A line above the row. */
  divider?: boolean
  /** An info row's tooltip: the whole of a text the label shortens (a pictures folder's full path, YAZ-3943 demo round 3). */
  title?: string
  /** A CHOICE row (YAZ-4277 demo): the label, then pills, one pressed, as "TOC made from". The menu stays open. */
  choices?: readonly { label: string; on: boolean; onPick: () => void; title?: string }[]
  /** A small heading above the row: it starts a section (the folder ⚙'s "Show", "Preview on hover", "Safety", YAZ-3746 13BP). */
  heading?: string
  /** An (i) after the label: hover shows this sentence (13BP CL4). */
  hint?: Hint
  /** A choice row on ONE line: the label left, the choices right (13BP CL3). */
  inline?: boolean
  /**
   * A one-line DROPDOWN row (YAZ-4909; Yaseen: "as the number of views increases this menu is just going to get wider
   * and wider"): the label left, "<current> ▾" right, the list on the body under it with a ✓ at `value`. The menu keeps
   * its width whatever the number of options.
   */
  menu?: { value: string; options: readonly { value: string; label: string; icon?: ReactNode }[]; onPick: (value: string) => void }
  /**
   * The menu's own "Read only" row stands here, under this row's heading, with its hint (13BP: the folder ⚙'s "Safety";
   * YAZ-4748 demo: a drawing's and a diagram's cog). With `inline`, it is an On / Off choice on one line, as the rows
   * around it (CL7).
   */
  readOnlySlot?: boolean
}

/**
 * An (i)'s words (13BP CL4): one sentence, or a short list (13BP, demo: "reads like a list rather than a paragraph"): an
 * optional line, then each row's symbol or term at the left and its meaning at the right, then an optional last line.
 */
export type Hint = string | { lead?: string; rows: readonly (readonly [ReactNode, string])[]; foot?: string }

/** The cog's props: also what a folder page's Page tab hands its cog (YAZ-3746 D35, `FolderPageTab`). */
export interface PageSettingsProps {
  /** The file's read-only switch (YAZ-3076 D1): a note, a drawing and a diagram have it. */
  readOnly?: boolean
  /** Off → the host turns it on; on → the host opens the "Allow edits?" box (this menu closes first). Absent → no row (a file with no switch, YAZ-3448). */
  onToggleReadOnly?: () => void
  lineNumbers?: boolean
  /** Absent → no row (a board). The same for "Section indent" and "Heading levels". */
  onToggleLineNumbers?: () => void
  /** This page's text stands below its headings (YAZ-2709); how it looks is in Settings › Editor › Section indent. */
  sectionIndent?: boolean
  onToggleSectionIndent?: () => void
  /** This page's thin grey guide lines (YAZ-4094 D2): its own choice, else Settings' "Guide lines default". Absent handler → no row. */
  guideLines?: boolean
  onToggleGuideLines?: () => void
  /** This page's bullets and headings fold (YAZ-4094 F1): its own choice, else Settings' "Folding default". Absent handler → no row. */
  folding?: boolean
  onToggleFolding?: () => void
  /** This page's bullet threading (YAZ-4432): its own choice, else Settings' "Bullet threading default". Absent handler → no row. */
  bulletThreading?: boolean
  onToggleBulletThreading?: () => void
  /** Every heading wears its level, "H2", after its text (YAZ-2700). Without the switch on, only the heading in hand does. */
  headingLevels?: boolean
  onToggleHeadingLevels?: () => void
  /** This page shows its table of contents (YAZ-2700): its own choice, else Settings' "Table of contents default" (YAZ-3558 D1). */
  tableOfContents?: boolean
  /** Absent → the menu has no "Table of contents" row (a board, a drawing, a diagram). Settings' "Table of contents default" Off does not hide it (YAZ-3558 D1). */
  onToggleTableOfContents?: () => void
  /** What this page's table of contents is built from (YAZ-2700 D14): its headings, its bullets, or `null` — Auto, the page's own structure decides. */
  tocSource?: TocSource | null
  /** Absent → the menu has no "TOC made from" choice (this page shows no table of contents: there is nothing to build). */
  onChangeTocSource?: (source: TocSource | null) => void
  /** This page's glow for outside changes (YAZ-4272): its own choice, or `null` (Default), which follows Settings. */
  outsideGlow?: OutsideChangeGlow | null
  /** Settings' glow, which "Default (…)" names. */
  appGlow?: OutsideChangeGlow
  /** Absent → no "Outside changes glow" row (a board, a drawing, a diagram, a code file). `null` is Default. */
  onChangeOutsideGlow?: (glow: OutsideChangeGlow | null) => void
  /** This note's width for every code block (YAZ-4783 layer 2): whole px, or `null` (Default), which follows Settings › Editor › Code blocks › Width. */
  codeWidth?: number | null
  /** Absent → no "Code block width" row (a board, a drawing, a diagram, a code file). `null` is Default. */
  onChangeCodeWidth?: (width: number | null) => void
  /** This note's width for every table (YAZ-4783 layer 2): whole px, or `null` (Default), which follows Settings › Tables › All tables › Width. */
  tableWidth?: number | null
  /** Absent → no "Table width" row. `null` is Default. */
  onChangeTableWidth?: (width: number | null) => void
  /** Plain rows after "Read only" (a code tab's three, YAZ-3449); absent or empty → none. */
  switches?: readonly PageSwitch[]
  /** A small heading over `switches`, which then form one group (a code tab: "All code files"), and a line after it. */
  switchesHeading?: string
  /** Rows after "Read only", made while the menu is open (a drawing's, YAZ-3943); absent → none. */
  rows?: () => readonly PageSwitch[]
  /** The page's plain text. Read once when the menu opens, never while it is closed. Absent → no counts (a board). */
  readText?: () => string
  /**
   * Another button for the menu (YAZ-3746 13BM PS1): the folder page's Page tab opens its text settings from its own
   * toolbar, with that toolbar's look and icon, under a small heading. Absent → the cog.
   */
  trigger?: { icon: ReactNode; className: string; label: string; heading: string }
}

/**
 * The page's own quick switches (YAZ-2643): a cog left of the zoom pill, and a small menu under it.
 * Nothing here is stored. The host editor keeps the state, so a switch lasts as long as its tab —
 * all but section indent (YAZ-2709), "Guide lines" and "Folding" (YAZ-4094), "Table of contents" (YAZ-2950)
 * and "TOC made from" (YAZ-2700 D14), which the host saves with the note. "Line numbers" and "Heading
 * levels" are never saved. "Outside changes glow" (YAZ-4272 D5) is a native dropdown: Default (Settings' glow) or one
 * of the four glows, saved in the note. "Code block width" and "Table width" (YAZ-4783 layer 2) are Default (Settings')
 * or a px you type, saved in the note too (`code-width`, `table-width`).
 *
 * "Read only" (YAZ-3076 D3) is the FIRST row on a note, a drawing and a diagram, and is stored IN
 * the file by the host. A file with no switch (a code file, YAZ-3448) gives no `onToggleReadOnly`. A board's menu has only that row: every Markdown-only row
 * and the counts show only when their handler is given, the rule "Table of contents" already had.
 * While read only is on, the row closes the menu and the host opens the chip's "Allow edits?" box
 * (D4, S47); while it is off, the row turns it on at once and the menu stays open (S43).
 *
 * A folder page (YAZ-3746 D35) passes "Read only" and its `switches` under the heading "This folder page": the
 * "Read only" row then stands first IN that group. Its Page tab adds a note's rows after them (`FolderPageTab`).
 *
 * A code tab (YAZ-3449) passes its own rows instead, as `switches`: "Read only", "Wrap long lines" and
 * "Minimap", under the heading "All code files", each one an app setting for every code file; then "Table of
 * contents" (YAZ-3506), this file's only. The menu stays open, as for any row.
 *
 * A drawing (YAZ-3943 D5, D13) passes `rows`, read while the menu is open and never while it is closed:
 * the pictures' size, "Move pictures out" or "Keep pictures inside", and the two exports.
 */
/** An (i)'s box width (YAZ-4776): `.page-settings__tip--hint` draws it at this width. */
const HINT_WIDTH = 240

/**
 * "Code block width" / "Table width" (YAZ-4783 layer 2): Default (the Settings row `settingsRow` names) or this note's px,
 * typed into the field and kept on ⏎ or when the field loses the focus, clamped to `BLOCK_WIDTH_MIN`–`BLOCK_WIDTH_MAX`. An
 * emptied field is Default too. The menu stays open.
 */
function BlockWidthRow({ label, value, settingsRow, onChange }: { label: string; value: number | null; settingsRow: string; onChange: (width: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  const keep = () => {
    const n = Number.parseInt(draft, 10)
    const next = draft === '' ? null : Number.isFinite(n) ? Math.min(BLOCK_WIDTH_MAX, Math.max(BLOCK_WIDTH_MIN, n)) : value
    setDraft(next === null ? '' : String(next))
    if (next !== value) onChange(next)
  }
  return <>
    <p className="page-settings__label">{label}:</p>
    <div className="page-settings__choices" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === null} title={`Default follows Settings › ${settingsRow}`} onClick={() => onChange(null)}>Default</button>
      <label className="page-settings__px" data-own={value === null ? undefined : ''}>
        <input aria-label={`${label} in px`} inputMode="numeric" placeholder={`${BLOCK_WIDTH_MIN}–${BLOCK_WIDTH_MAX}`} value={draft} spellCheck={false}
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))} onBlur={keep}
          onKeyDown={(event) => {
            if (event.key === 'Enter') keep()
          }} />
        px
      </label>
    </div>
  </>
}

export function PageSettings({ readOnly = false, onToggleReadOnly, lineNumbers = false, onToggleLineNumbers, sectionIndent = false, onToggleSectionIndent, guideLines = true, onToggleGuideLines, folding = true, onToggleFolding, bulletThreading = false, onToggleBulletThreading, headingLevels = false, onToggleHeadingLevels, tableOfContents = true, onToggleTableOfContents, tocSource = null, onChangeTocSource, outsideGlow = null, appGlow, onChangeOutsideGlow, codeWidth = null, onChangeCodeWidth, tableWidth = null, onChangeTableWidth, switches, switchesHeading, rows, readText, trigger }: PageSettingsProps) {
  // The text counted at the open IS the open state: the counts cannot drift while the menu shows.
  // A board has no text to count: its open menu holds '' and shows no counts.
  const [text, setText] = useState<string | null>(null)
  const open = text !== null
  // The explanation behind the small "i" beside "TOC made from": shown while the mouse or the keyboard is on it.
  const [info, setInfo] = useState(false)
  /** An (i)'s sentence (13BP CL4) and how far down the menu its row is: shown while the mouse or the keyboard is on it, or after a click. */
  const [hintTip, setHintTip] = useState<{ label: string; hint: Hint; left: number; top: number } | null>(null)
  const setOpen = (next: boolean) => {
    setText(next ? (readText?.() ?? '') : null)
    // The explanation goes with the menu: a menu that closes under a mouse at rest sends the "i" no
    // `mouseleave`, and the text would stand there, unasked, at the next open.
    if (!next) {
      setInfo(false)
      setHintTip(null)
    }
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  /**
   * The menu, on the page (YAZ-4776): under its button, right-aligned to it, and moved left or right to stay inside the
   * window. Inside the toolbar a narrow window let the sidebar cover its left part.
   */
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return setMenuAt(null)
    const t = triggerRef.current?.getBoundingClientRect()
    const w = menuRef.current?.offsetWidth
    if (t === undefined || w === undefined) return
    setMenuAt({ left: Math.max(8, Math.min(t.right - w, window.innerWidth - w - 8)), top: t.bottom + 6 })
  }, [open])
  const menuId = useId()
  const tipId = useId()
  const hintTipId = useId()
  const glowId = useId()

  // A press outside closes the menu, and so does the window losing focus (YAZ-3121, the rule of the
  // "Allow edits?" box): a `pointerdown` in the capture phase, because a canvas may cancel what follows
  // it, and `blur`, because a press inside the draw.io frame reaches no event of this document at all.
  // The press that opened the menu came before it existed, so it never closes it.
  useEffect(() => {
    if (!open) return
    const onOutside = (event: Event) => {
      const target = event.target as Node
      // A dropdown's list opened from a row (YAZ-4909, `Dropdown`) is on the body, not in the menu: a press in it is a press in the menu.
      if (target instanceof Element && target.closest('.view-dropdown__panel') !== null) return
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const onBlur = () => setOpen(false)
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onOutside, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  /**
   * Where an (i)'s box goes (YAZ-4776): left of the menu, as "TOC made from"'s; else right of it; else under the (i) —
   * always inside the window. The box is fixed on the page (a portal), so no pane's edge can cut it.
   */
  const showHint = (el: HTMLElement, label: string, hint: Hint) => {
    const menu = menuRef.current
    if (menu == null) return
    const m = menu.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const width = HINT_WIDTH + 8
    const below = { left: Math.max(8, Math.min(r.left - 8, window.innerWidth - width)), top: r.bottom + 6 }
    const beside = m.left - width >= 8 ? m.left - width : m.right + width <= window.innerWidth - 8 ? m.right + 8 : null
    setHintTip({ label, hint, ...(beside === null ? below : { left: beside, top: Math.max(8, Math.min(r.top - 10, window.innerHeight - 200)) }) })
  }
  const infoGlyph = <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
    <circle cx="8" cy="8" r="6.3" /><path d="M8 7.4v3.4M8 5v.2" />
  </svg>
  /**
   * The (i) after a label (13BP CL4): the app's own tooltip box beside the menu, as "TOC made from"'s, level with its row.
   * The mouse on it, the keyboard on it, or a click shows it. A native title showed nothing in the app.
   */
  const infoOf = (label: string, hint: Hint | undefined) =>
    hint !== undefined && (
      <button type="button" className="page-settings__info" aria-label={`About ${label}`} aria-describedby={hintTip?.label === label ? hintTipId : undefined}
        onMouseEnter={(e) => showHint(e.currentTarget, label, hint)} onMouseLeave={() => setHintTip(null)}
        onFocus={(e) => showHint(e.currentTarget, label, hint)} onBlur={() => setHintTip(null)}
        onClick={(e) => showHint(e.currentTarget, label, hint)}>
        {infoGlyph}
      </button>
    )
  /**
   * The (i) inside a row that is itself a button (YAZ-4748 demo: "Link preview on hover", the exports): a button may not
   * hold a button, so the (i) is a glyph here. The mouse on it shows the box, and a click on it shows the box and does not
   * press the row. The keyboard on the row shows it too, and the row names it (`aria-describedby`).
   */
  const rowInfoOf = (label: string, hint: Hint | undefined) =>
    hint !== undefined && (
      <span className="page-settings__info" aria-hidden="true"
        onMouseEnter={(e) => showHint(e.currentTarget, label, hint)} onMouseLeave={() => setHintTip(null)}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          showHint(e.currentTarget, label, hint)
        }}>
        {infoGlyph}
      </span>
    )
  /** What a row that holds an (i) glyph adds to its button: the keyboard on it shows the box. */
  const rowHintProps = (label: string, hint: Hint | undefined) => hint === undefined ? {} : {
    'aria-describedby': hintTip?.label === label ? hintTipId : undefined,
    onFocus: (e: FocusEvent<HTMLButtonElement>) => {
      if (e.currentTarget.matches(':focus-visible')) showHint(e.currentTarget, label, hint)
    },
    onBlur: () => setHintTip(null),
  }
  // Under a heading, "Read only" is the group's first row (a folder page's "This folder page", YAZ-3746 D35), or where a row
  // asks for it (`readOnlySlot`, 13BP's "Safety", a drawing's and a diagram's cog); else the menu's.
  const readOnlyRow = (hint?: Hint) => onToggleReadOnly !== undefined && <button type="button" aria-pressed={readOnly} {...rowHintProps('Read only', hint)} onClick={() => {
    // On: the one box, under the chip (D4) — so the menu makes way for it.
    if (readOnly) setOpen(false)
    onToggleReadOnly()
  }}>
    <span>Read only{rowInfoOf('Read only', hint)}</span><span aria-hidden="true">{readOnly ? '✓' : ''}</span>
  </button>
  /**
   * "Read only" as a choice on one line (13BP CL7): On / Off, no "Settings" (no app-wide Read only to follow). On turns it
   * on at once; Off is the chip's "Allow edits?" box, as the check row's click (D4), so the menu makes way for it.
   */
  const readOnlyLine = (hint?: Hint) => onToggleReadOnly !== undefined && <div className="page-settings__line">
    <p className="page-settings__label">Read only{infoOf('Read only', hint)}</p>
    <div className="page-settings__choices" role="group" aria-label="Read only">
      <button type="button" aria-pressed={readOnly} onClick={() => { if (!readOnly) onToggleReadOnly() }}>On</button>
      <button type="button" aria-pressed={!readOnly} onClick={() => {
        if (!readOnly) return
        setOpen(false)
        onToggleReadOnly()
      }}>Off</button>
    </div>
  </div>
  const choicesOf = (label: string, choices: NonNullable<PageSwitch['choices']>, disabled: boolean | undefined) => (
    <div className="page-settings__choices" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button key={choice.label} type="button" aria-pressed={choice.on} disabled={disabled} title={choice.title} onClick={choice.onPick}>{choice.label}</button>
      ))}
    </div>
  )
  const rowOf = ({ label, on, onToggle, disabled, warn, divider, title, choices, heading, hint, inline, readOnlySlot, menu }: PageSwitch) => <Fragment key={label}>
    {divider === true && <div className="page-settings__divider" aria-hidden="true" />}
    {heading !== undefined && <p className="page-settings__label page-settings__heading">{heading}</p>}
    {readOnlySlot === true ? (inline === true ? readOnlyLine(hint) : readOnlyRow(hint))
      : menu !== undefined ? <div className="page-settings__line">
        <p className="page-settings__label">{label}{infoOf(label, hint)}</p>
        <Dropdown label={label} className="page-settings__drop" panelClassName="page-settings__drop-panel ctx-menu--glyphs" trigger={menu.options.find((o) => o.value === menu.value)?.label ?? menu.options[0]?.label}>
          {(close) => (
            <div className="ctx-menu__group" role="group">
              {menu.options.map((o) => (
                <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === menu.value} className="ctx-menu__item" data-hint={o.value === menu.value ? '✓' : undefined} onClick={() => {
                  close()
                  if (o.value !== menu.value) menu.onPick(o.value)
                }}>
                  {o.icon === undefined ? o.label : <span className="ctx-menu__label">{o.icon}{o.label}</span>}
                </button>
              ))}
            </div>
          )}
        </Dropdown>
      </div>
      : choices !== undefined && inline === true ? <div className="page-settings__line">
        <p className="page-settings__label">{label}{infoOf(label, hint)}</p>
        {choicesOf(label, choices, disabled)}
      </div>
      : choices !== undefined ? <>
        <p className="page-settings__label">{label}{hint === undefined ? ':' : infoOf(label, hint)}</p>
        {choicesOf(label, choices, disabled)}
      </>
      : onToggle === undefined ? <p className={warn === true ? 'page-settings__warn' : undefined} title={title}>{label}</p>
      : on === undefined ? <button type="button" disabled={disabled} {...rowHintProps(label, hint)} onClick={() => {
        setOpen(false)
        onToggle()
      }}><span>{label}{rowInfoOf(label, hint)}</span></button>
      : <button type="button" aria-pressed={on} disabled={disabled} {...rowHintProps(label, hint)} onClick={onToggle}>
        <span>{label}{rowInfoOf(label, hint)}</span><span aria-hidden="true">{on ? '✓' : ''}</span>
      </button>}
  </Fragment>
  /**
   * YAZ-4810 5G: the menu is on `document.body` (YAZ-4776), so the page's Tab order no longer runs from the cog into it.
   * Tab on the cog goes to the menu's first control; Shift+Tab on that one goes back to the cog; Tab on the last one
   * closes the menu on the cog, as Esc does. (A portal's keys still reach this root through React.)
   */
  const tabAcross = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])') ?? [])]
    if (items.length === 0) return
    const at = event.target
    const into = at === triggerRef.current && !event.shiftKey
    const back = at === items[0] && event.shiftKey
    const out = at === items[items.length - 1] && !event.shiftKey
    if (!into && !back && !out) return
    event.preventDefault()
    if (into) {
      items[0]!.focus()
      return
    }
    if (out) setOpen(false)
    triggerRef.current?.focus()
  }
  const switchRows = switches?.map(rowOf)
  // Read while the menu is open, never while it is closed (a drawing's rows count its pictures).
  const rowList = open ? rows?.() : undefined
  // A row may ask for "Read only" where it stands, with its (i) (`readOnlySlot`, in `switches` or `rows`); else it is the first row.
  const readOnlyFirst = [...(switches ?? []), ...(rowList ?? [])].some((s) => s.readOnlySlot === true) !== true && readOnlyRow()

  return (
    <div ref={rootRef} className="page-settings"
      onKeyDown={(event) => {
        if (!open) return
        if (event.key === 'Tab') {
          tabAcross(event)
          return
        }
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }}>
      <button ref={triggerRef} type="button" className={trigger?.className ?? 'page-settings__trigger'} aria-label={trigger?.label ?? 'Page settings'}
        title={trigger?.label} aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        {trigger?.icon ?? <CogIcon size={13} />}
      </button>
      {text !== null && createPortal(<div ref={menuRef} id={menuId} className="page-settings__menu page-settings__menu--placed" role="group" aria-label={trigger?.label ?? 'Page settings'}
        style={menuAt === null ? { visibility: 'hidden' } : { left: menuAt.left, top: menuAt.top }}>
        {trigger !== undefined && <p className="page-settings__label" aria-hidden="true">{trigger.heading}</p>}
        {switchesHeading === undefined && readOnlyFirst}
        {rowList?.map(rowOf)}
        {switchesHeading === undefined ? switchRows : <>
          <div role="group" aria-label={switchesHeading}>
            <p className="page-settings__label page-settings__title" aria-hidden="true" title={switchesHeading}>{switchesHeading}</p>
            {readOnlyFirst}
            {switchRows}
          </div>
          <div className="page-settings__divider" aria-hidden="true" />
        </>}
        {onToggleLineNumbers !== undefined && <button type="button" aria-pressed={lineNumbers} onClick={onToggleLineNumbers}>
          <span>Line numbers</span><span aria-hidden="true">{lineNumbers ? '✓' : ''}</span>
        </button>}
        {onToggleSectionIndent !== undefined && <button type="button" aria-pressed={sectionIndent} onClick={onToggleSectionIndent}>
          <span>Section indent</span><span aria-hidden="true">{sectionIndent ? '✓' : ''}</span>
        </button>}
        {onToggleGuideLines !== undefined && <button type="button" aria-pressed={guideLines} onClick={onToggleGuideLines}>
          <span>Guide lines</span><span aria-hidden="true">{guideLines ? '✓' : ''}</span>
        </button>}
        {onToggleFolding !== undefined && <button type="button" aria-pressed={folding} onClick={onToggleFolding}>
          <span>Folding</span><span aria-hidden="true">{folding ? '✓' : ''}</span>
        </button>}
        {onToggleBulletThreading !== undefined && <button type="button" aria-pressed={bulletThreading} onClick={onToggleBulletThreading}>
          <span>Bullet threading</span><span aria-hidden="true">{bulletThreading ? '✓' : ''}</span>
        </button>}
        {onToggleHeadingLevels !== undefined && <button type="button" aria-pressed={headingLevels} onClick={onToggleHeadingLevels}>
          <span>Heading levels</span><span aria-hidden="true">{headingLevels ? '✓' : ''}</span>
        </button>}
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
        {/* A native dropdown: five choices do not fit the menu's width as buttons (YAZ-4272 D5). The menu stays open after a pick.
            "Default" alone: "Default (Until I check it)" ran under the dropdown's arrow at the menu's 172px. Its tooltip names the
            glow it follows. */}
        {onChangeOutsideGlow !== undefined && <>
          <div className="page-settings__divider" aria-hidden="true" />
          <label className="page-settings__label" htmlFor={glowId}>Outside changes glow:</label>
          <select id={glowId} className="page-settings__select" value={outsideGlow ?? ''}
            title={`Default follows Settings: ${OUTSIDE_CHANGE_GLOW_OPTIONS.find((option) => option.value === appGlow)?.label ?? 'Until I check it'}`}
            onChange={(event) => onChangeOutsideGlow(event.target.value === '' ? null : (event.target.value as OutsideChangeGlow))}>
            <option value="">Default</option>
            {OUTSIDE_CHANGE_GLOW_OPTIONS.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </>}
        {/* This note's width for its code blocks and its tables (YAZ-4783 layer 2), saved in the note. */}
        {(onChangeCodeWidth !== undefined || onChangeTableWidth !== undefined) && <div className="page-settings__divider" aria-hidden="true" />}
        {onChangeCodeWidth !== undefined && <BlockWidthRow label="Code block width" value={codeWidth} settingsRow="Editor › Code blocks › Width" onChange={onChangeCodeWidth} />}
        {onChangeTableWidth !== undefined && <BlockWidthRow label="Table width" value={tableWidth} settingsRow="Tables › All tables › Width" onChange={onChangeTableWidth} />}
        {readText !== undefined && <>
          <div className="page-settings__divider" aria-hidden="true" />
          <p>{(text.match(/\S+/g)?.length ?? 0).toLocaleString()} words</p>
          <p>{text.length.toLocaleString()} characters</p>
        </>}
      </div>, document.body)}
      {/* BESIDE the menu, not in it: the menu scrolls and is 172px wide (212px when rows have an (i)), and this is a short text to read. */}
      {open && hintTip !== null && createPortal(<div id={hintTipId} role="tooltip" className="page-settings__tip page-settings__tip--hint" style={{ left: hintTip.left, top: hintTip.top }}>
        {typeof hintTip.hint === 'string' ? <p>{hintTip.hint}</p> : <>
          {hintTip.hint.lead !== undefined && <p>{hintTip.hint.lead}</p>}
          <dl>{hintTip.hint.rows.map(([term, text]) => <Fragment key={text}><dt>{term}</dt><dd>{text}</dd></Fragment>)}</dl>
          {hintTip.hint.foot !== undefined && <p>{hintTip.hint.foot}</p>}
        </>}
      </div>, document.body)}
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
