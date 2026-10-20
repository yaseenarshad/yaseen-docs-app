/**
 * THE SETTINGS DIALOG (YAZ-1679): a centred modal — one page for each section, grouped rows
 * under the section and group headings on the right; the section titles down the left, under a
 * search box. It replaces the 220px popover that grew above the sidebar cog (GRO-2024) and folds
 * the hotkey reference (GRO-2067) in as its own page. App mounts it, so the cog, ⌘, and the app
 * menu's Settings… all open the ONE dialog.
 *
 * What it shows comes entirely from `SETTINGS_SECTIONS` (registry.tsx): the nav lists the
 * sections this context can show, the page renders the one that is chosen, and search runs over
 * the items of them all — a setting declared once appears in all three.
 *
 * A PAGE FOR EACH SECTION (Yasin's call in the YAZ-2709 demo, ⚡ amending YAZ-1679's one long
 * page): the sections had grown past what one scroll reads well, and a nav click was already the
 * way to each of them. `page` names the section showing; opening always starts at the first.
 * A `standalone` section (Hotkeys — a reference table, noise among settings) is a page like
 * the others, listed under a divider in the nav.
 *
 * ⚡ KEYS ARE THE OVERLAY'S, NEVER `window`'s — the DrawingModal precedent (YAZ-888): React
 * flushes mount effects inside the dispatch of the event that opened the dialog, so a `window`
 * mousedown listener installed on mount would hear the cog click that opened it and close it in
 * the same tick. Bound to the overlay, it only hears what happens inside itself.
 *
 * Esc is layered: with a query typed it clears the search (back to the page); with none it
 * closes. Focus goes to the search box on open, and whatever had focus before — the cog, the
 * editor ⌘, was pressed in — gets it back on close.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SearchIcon } from '../views/view/icons'
import { availableSections, isAvailable, resolveHint, resolveWide, type SettingDef, type SettingsCtx, type SettingsGroup, type SettingsSection, type SettingsSectionId } from './registry'
import { searchSettings, settingCandidates } from './searchSettings'
import { SettingRow } from './SettingRow'
import './settings.css'

interface SettingsDialogProps {
  ctx: SettingsCtx
  onClose: () => void
  /** Open straight onto a page (the Share dialog's "Open Settings › Sharing", YAZ-3040); absent = the first. */
  initialPage?: SettingsSectionId
}

export function SettingsDialog({ ctx, onClose, initialPage }: SettingsDialogProps) {
  const sections = availableSections(ctx)
  const settingsPages = sections.filter((s) => s.standalone !== true)
  const referencePages = sections.filter((s) => s.standalone === true)
  const paneRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  /** The section asked for. Search leaves it alone, so clearing a query returns to it. */
  const [page, setPage] = useState<SettingsSectionId>(initialPage ?? sections[0].id)
  /** The section showing: a section this context stops showing while its page is open (Sync, Review) gives way to the first, in the pane and in the nav alike. */
  const shown = sections.find((s) => s.id === page) ?? sections[0]

  useEffect(() => {
    const previous = document.activeElement
    searchRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  // Built once per open: the searchable text is labels, hints and keywords, none of which a click
  // inside the dialog changes in a way search needs to see.
  const candidates = useMemo(() => settingCandidates(ctx), [])
  const searching = query.trim() !== ''
  const hits = searching ? searchSettings(candidates, query) : []

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (query !== '') setQuery('')
    else onClose()
  }

  /** A nav click is a page swap, and the new page starts at its top; a query in progress is dropped like any other navigation. */
  const showPage = (id: SettingsSectionId): void => {
    setQuery('')
    setPage(id)
    if (paneRef.current !== null) paneRef.current.scrollTop = 0
  }

  const row = (item: SettingDef) => (
    <SettingRow key={item.id} id={item.id} label={item.label} hint={resolveHint(item, ctx)} wide={resolveWide(item, ctx)} bare={item.bare === true}>
      {item.render(ctx)}
    </SettingRow>
  )
  /** A per-vault page says which vault it acts on (YAZ-2602 R10), where App names one: a window with two or more. */
  const vaultLine = (className: string) => ctx.vaultName !== undefined && <p className={className}>Vault: {ctx.vaultName}</p>
  /** `titled` is false under a search breadcrumb, which already names the group. A group with no row to show is not there. */
  const group = (g: SettingsGroup, items: readonly SettingDef[], key: number, titled = true) => items.length > 0 && (
    <div key={key} className="settings-group">
      {titled && g.title !== undefined && <h3 className="settings-group__title">{g.title}</h3>}
      {g.vault === true && vaultLine('settings-group__hint')}
      {g.hint !== undefined && <p className="settings-group__hint">{g.hint}</p>}
      <div className="settings-group__card">{items.map(row)}</div>
    </div>
  )
  const section = (s: SettingsSection) => (
    <section key={s.id} id={`settings-${s.id}`} data-section={s.id} className="settings-section">
      <h2 className="settings-section__title">{s.title}</h2>
      {s.vault === true && vaultLine('settings-section__note')}
      {s.note !== undefined && <p className="settings-section__note">{s.note}</p>}
      {s.groups.map((g, i) => group(g, g.items.filter((item) => isAvailable(item, ctx)), i))}
    </section>
  )

  // Hits under a breadcrumb per group ("Editor › Bullet threading"; an untitled group is just its
  // section). `candidates` is in registry order, so walking it keeps groups and rows in the order
  // the page shows them; the matcher's ranking decided only WHICH rows are here.
  const matched = new Set(hits)
  const hitGroups: { section: SettingsSection; group: SettingsGroup; items: SettingDef[] }[] = []
  for (const candidate of candidates) {
    if (!matched.has(candidate) || !isAvailable(candidate.item, ctx)) continue
    const last = hitGroups[hitGroups.length - 1]
    if (last?.group === candidate.group) last.items.push(candidate.item)
    else hitGroups.push({ section: candidate.section, group: candidate.group, items: [candidate.item] })
  }

  return (
    <div className="settings-overlay" tabIndex={-1} onMouseDown={onClose} onKeyDown={onKeyDown}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-search">
            <SearchIcon />
            <input ref={searchRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings…" aria-label="Search settings" autoComplete="off" spellCheck={false} />
            {query !== '' && (
              <button
                type="button"
                aria-label="Clear search settings"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              >
                ×
              </button>
            )}
          </div>
          {settingsPages.map((s) => (
            <button key={s.id} type="button" className="settings-nav__item" aria-current={shown === s ? 'page' : undefined} onClick={() => showPage(s.id)}>
              {s.title}
            </button>
          ))}
          <hr className="settings-nav__divider" />
          {referencePages.map((s) => (
            <button key={s.id} type="button" className="settings-nav__item" aria-current={shown === s ? 'page' : undefined} onClick={() => showPage(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
        <button type="button" className="settings-dialog__close" aria-label="Close settings" onClick={onClose}>
          ✕
        </button>
        <div ref={paneRef} className="settings-pane">
          {searching ? (
            hitGroups.length === 0 ? (
              <p className="settings-empty">No settings match “{query}”.</p>
            ) : (
              hitGroups.map((entry, i) => (
                <section key={i} className="settings-section">
                  <h2 className="settings-section__title">{entry.group.title === undefined ? entry.section.title : `${entry.section.title} › ${entry.group.title}`}</h2>
                  {group(entry.group, entry.items, 0, false)}
                </section>
              ))
            )
          ) : (
            section(shown)
          )}
        </div>
      </div>
    </div>
  )
}
