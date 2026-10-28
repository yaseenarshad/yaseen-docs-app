import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { PICKER_COLUMNS, PICKER_W } from './iconSuggestions'
import { iconUrl, pickableIcons, useMaterialIcons } from './materialIcons'

/**
 * The icon picker (YAZ-3440 D8): a panel of Material icons, opened right of the sidebar by "Change icon ▸
 * This file…" and "Change icon ▸ All .gif files…", and by Settings › Sidebar › Icon rules (D9). Its header
 * says what it changes; "Reset to default" removes the pick or the rule. A "Suggested" row (the row's icon, icons
 * of its kind, the common ones), then "All icons" A to Z; the search box filters both by name. Each icon is an
 * `<img loading="lazy">`, so opening it fetches only the icons in view. Out of the sidebar zoom (fixed, at `x`,
 * `y`), so it is sized in screen px. The name of the icon under the mouse, or of the one the keyboard is on, shows
 * in the footer. Keys: the arrows move in the grid (ArrowDown from the search box goes to the first icon), Enter
 * picks, Escape closes.
 *
 * Closing (D8): the × in its header, Escape, or a click outside. Each closes the picker ALONE: Escape stops
 * at the picker, and a transparent layer under it takes the outside click, so the Settings dialog behind it (or a
 * row of the tree) gets nothing. Closing without a pick changes nothing.
 */
export function IconPicker({ x, y, anchor, title, current, canReset = current !== null, suggested = [], onPick, onClose }: {
  x: number
  y: number
  /**
   * The button it was opened from (the rules editor's icon button): it opens below it, or above when there is no
   * room below, so the row it edits stays in view. Without one it opens at `x`, `y` (right of the sidebar).
   */
  anchor?: { left: number; top: number; bottom: number }
  /** What it changes: "Icon for this file: mixed 24.gif", "Icon for all .gif files", "Icon for 3 items". */
  title: string
  /** The icon the pick or rule has now, marked in the grid; null for none of its own. */
  current: string | null
  /** "Reset to default" has something to clear: a pick of its own (a selection: any row's), or the rule. */
  canReset?: boolean
  /** The "Suggested" row, in order (`suggestIcons`). */
  suggested?: readonly string[]
  /** An id, or null for "Reset to default". The picker closes after either. */
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  // Material's tables (YAZ-3470) are in by the time a menu opens the picker; if not, it lists them once they land.
  const material = useMaterialIcons()
  const all = useMemo(() => pickableIcons().sort(), [material]) // eslint-disable-line react-hooks/exhaustive-deps -- `material` is read by pickableIcons
  const words = query.trim().toLowerCase().split(/[\s-]+/).filter((w) => w !== '')
  const matches = (id: string) => words.every((w) => id.includes(w))
  const sections = [
    { title: 'Suggested', ids: suggested.filter(matches) },
    { title: 'All icons', ids: words.length === 0 ? all : all.filter(matches) },
  ].filter((section) => section.ids.length > 0)
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(() => (anchor === undefined ? { x, y } : { x: anchor.left, y: anchor.bottom + 4 }))
  useLayoutEffect(() => {
    if (anchor === undefined) return
    const height = panel.current?.getBoundingClientRect().height ?? 0
    const below = window.innerHeight - anchor.bottom - 4
    const above = anchor.top - 4
    setAt({ x: anchor.left, y: height <= below || below >= above ? anchor.bottom + 4 : Math.max(0, anchor.top - 4 - height) })
  }, [anchor])
  const choose = (id: string | null) => {
    onPick(id)
    onClose()
  }
  /** The icon buttons in on-screen order, each with its section and its place in it. */
  const buttons = () => [...(panel.current?.querySelectorAll<HTMLButtonElement>('.icon-picker__icon') ?? [])]
  const move = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const list = buttons()
    const at = list.indexOf(e.currentTarget)
    const section = e.currentTarget.closest('.icon-picker__grid')
    const inSection = list.filter((b) => b.closest('.icon-picker__grid') === section)
    const i = inSection.indexOf(e.currentTarget)
    let to: HTMLButtonElement | undefined
    if (e.key === 'ArrowRight') to = list[at + 1]
    else if (e.key === 'ArrowLeft') to = list[at - 1]
    else if (e.key === 'ArrowDown') to = inSection[i + PICKER_COLUMNS] ?? list[list.indexOf(inSection[inSection.length - 1]) + 1] ?? inSection[inSection.length - 1]
    else if (e.key === 'ArrowUp') to = i >= PICKER_COLUMNS ? inSection[i - PICKER_COLUMNS] : (list[list.indexOf(inSection[0]) - 1] ?? panel.current?.querySelector<HTMLButtonElement>('.icon-picker__search') ?? undefined)
    else return
    e.preventDefault()
    to?.focus()
  }
  const named = hovered ?? focused ?? current
  return (
    <>
      <div
        className="icon-picker__outside"
        aria-hidden="true"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      />
      <ContextMenuSurface x={at.x} y={at.y} width={PICKER_W} role="dialog" className="icon-picker" onClose={onClose}>
      <div
        ref={panel}
        className="icon-picker__panel"
        aria-label={title}
        onKeyDown={(e) => {
          // Escape is the picker's alone: the Settings dialog behind it must not hear it.
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      >
        <div className="icon-picker__top">
          <div className="icon-picker__head">{title}</div>
          <button type="button" className="icon-picker__close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          className="icon-picker__search"
          type="search"
          placeholder="Search icons"
          aria-label="Search icons"
          autoFocus
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && sections.length > 0) choose(sections[0].ids[0])
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              buttons()[0]?.focus()
            }
          }}
        />
        <button type="button" className="ctx-menu__item icon-picker__reset" disabled={!canReset} onClick={() => choose(null)}>
          Reset to default
        </button>
        <div className="icon-picker__scroll">
          {sections.map((section) => (
            <section key={section.title} className="icon-picker__section">
              <div className="icon-picker__label">{section.title}</div>
              <div className="icon-picker__grid" role="listbox" aria-label={section.title}>
                {section.ids.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={id === current}
                    className={`icon-picker__icon${id === current ? ' icon-picker__icon--current' : ''}`}
                    title={id}
                    aria-label={id}
                    onClick={() => choose(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        choose(id)
                      } else move(e)
                    }}
                    onMouseEnter={() => setHovered(id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setFocused(id)}
                    onBlur={() => setFocused(null)}
                  >
                    <img src={iconUrl(id)} alt="" width={28} height={28} loading="lazy" draggable={false} />
                  </button>
                ))}
              </div>
            </section>
          ))}
          {sections.length === 0 && <div className="icon-picker__empty">No icon has that name.</div>}
        </div>
        <div className="icon-picker__foot" aria-live="polite">
          {named ?? ' '}
        </div>
      </div>
      </ContextMenuSurface>
    </>
  )
}
