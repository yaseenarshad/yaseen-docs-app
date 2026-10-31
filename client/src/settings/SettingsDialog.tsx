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
 * Esc is layered: with a query typed it clears the search (back to the page) — the nav's first, then the
 * Hotkeys page's own (YAZ-3397 D5); with none it closes. A key recorder of the Hotkeys page (YAZ-3397 D5, D6) takes Esc before the dialog hears it. Focus goes to the search box on open, and whatever had focus before — the cog, the
 * editor ⌘, was pressed in — gets it back on close.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SystemHotkey } from '@shared/macosHotkeys'
import { api } from '../api'
import { SearchIcon } from '../views/view/icons'
import { KeySearch, NO_FILTER, type HotkeyFilter } from './hotkeysSection'
import { availableSections, groupsOf, isAvailable, resolveHint, resolveWide, type SettingDef, type SettingsCtx, type SettingsGroup, type SettingsSection, type SettingsSectionId } from './registry'
import { searchSettings, settingCandidates, type SettingHit } from './searchSettings'
import { SettingRow } from './SettingRow'
import './settings.css'

interface SettingsDialogProps {
  ctx: SettingsCtx
  onClose: () => void
  /** Open straight onto a page (the Share dialog's "Open Settings › Sharing", YAZ-3040); absent = the first. */
  initialPage?: SettingsSectionId
}

export function SettingsDialog({ ctx: given, onClose, initialPage }: SettingsDialogProps) {
  /** The Mac's own keys (YAZ-3397 D3): asked of main once per open, when the Hotkeys page or a search first shows. */
  const [systemHotkeys, setSystemHotkeys] = useState<SystemHotkey[] | undefined>(undefined)
  /** Settings › Hotkeys' filters (YAZ-3564 K7): the rows read them through `ctx`; a page swap clears them. */
  const [hotkeyFilter, setHotkeyFilter] = useState<HotkeyFilter>(NO_FILTER)
  const ctx = useMemo<SettingsCtx>(() => ({ ...given, ...(systemHotkeys === undefined ? {} : { systemHotkeys }), hotkeyFilter }), [given, systemHotkeys, hotkeyFilter])
  const sections = availableSections(ctx)
  const settingsPages = sections.filter((s) => s.standalone !== true)
  const referencePages = sections.filter((s) => s.standalone === true)
  const paneRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  /** The Hotkeys page's own search bar (YAZ-3397 D5): it filters that page alone, and the nav's search stays the whole dialog's. */
  const [hotkeyQuery, setHotkeyQuery] = useState('')
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
  // inside the dialog changes in a way search needs to see — but a hotkey's text is its key (YAZ-3397 D5),
  // so a changed key, or the Mac's keys arriving, builds them again. Never on a keystroke.
  const hotkeysKey = JSON.stringify(ctx.settings.hotkeys)
  const candidates = useMemo(() => settingCandidates(ctx), [hotkeysKey, systemHotkeys]) // eslint-disable-line react-hooks/exhaustive-deps -- see above
  const searching = query.trim() !== ''
  const hits = searching ? searchSettings(candidates, query) : []
  /** The query "Press keys to search" put in the page's box (D5): its answer shows while that query stands. */
  const [keyQuery, setKeyQuery] = useState<string | null>(null)
  const onHotkeys = shown.id === 'hotkeys'
  const searchingHotkeys = onHotkeys && !searching && hotkeyQuery.trim() !== ''
  const hotkeyHits = searchingHotkeys ? searchSettings(candidates.filter((c) => c.section.id === 'hotkeys'), hotkeyQuery) : []

  const wantsSystemKeys = onHotkeys || searching
  useEffect(() => {
    if (!wantsSystemKeys || systemHotkeys !== undefined) return
    let live = true
    // No bridge (a test) or a failure: the rows stay away, and the recorder checks the Mac's own table.
    void Promise.resolve()
      .then(() => api.state.systemHotkeys())
      .then(
        (rows) => {
          if (live) setSystemHotkeys(rows)
        },
        () => undefined,
      )
    return () => {
      live = false
    }
  }, [wantsSystemKeys, systemHotkeys])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (query !== '') setQuery('')
    else if (onHotkeys && hotkeyQuery !== '') setHotkeyQuery('')
    else onClose()
  }

  /** A nav click is a page swap, and the new page starts at its top; a query in progress is dropped like any other navigation. */
  const showPage = (id: SettingsSectionId): void => {
    setQuery('')
    setHotkeyQuery('')
    setHotkeyFilter(NO_FILTER)
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
  const group = (g: SettingsGroup, items: readonly SettingDef[], key: number | string, titled = true) => items.length > 0 && (
    <div key={key} className="settings-group" {...(g.anchor === undefined ? {} : { id: g.anchor })}>
      {g.header !== undefined ? g.header(ctx) : titled && g.title !== undefined && <h3 className="settings-group__title">{g.title}</h3>}
      {g.vault === true && vaultLine('settings-group__hint')}
      {g.hint !== undefined && <p className="settings-group__hint">{g.hint}</p>}
      <div className={`settings-group__card${g.cardClass === undefined ? '' : ` ${g.cardClass}`}`}>{items.map(row)}</div>
    </div>
  )
  const section = (s: SettingsSection) => (
    <section key={s.id} id={`settings-${s.id}`} data-section={s.id} className="settings-section">
      <h2 className="settings-section__title">{s.title}</h2>
      {s.vault === true && vaultLine('settings-section__note')}
      {s.note !== undefined && <p className="settings-section__note">{s.note}</p>}
      {groupsOf(s, ctx).map((g, i) => group(g, g.items.filter((item) => isAvailable(item, ctx)), g.anchor ?? i))}
    </section>
  )

  // Hits under a breadcrumb per group ("Editor › Bullet threading"; an untitled group is just its
  // section). `candidates` is in registry order, so walking it keeps groups and rows in the order
  // the page shows them; the matcher's ranking decided only WHICH rows are here.
  const hitList = (found: readonly SettingHit[], asked: string, noun = 'settings') => {
    const matched = new Set(found)
    const hitGroups: { section: SettingsSection; group: SettingsGroup; items: SettingDef[] }[] = []
    for (const candidate of candidates) {
      if (!matched.has(candidate) || !isAvailable(candidate.item, ctx)) continue
      const last = hitGroups[hitGroups.length - 1]
      if (last?.group === candidate.group) last.items.push(candidate.item)
      else hitGroups.push({ section: candidate.section, group: candidate.group, items: [candidate.item] })
    }
    return hitGroups.length === 0 ? (
      <p className="settings-empty">
        No {noun} match “{asked}”.
      </p>
    ) : (
      hitGroups.map((entry, i) => (
        <section key={i} className="settings-section">
          <h2 className="settings-section__title">{entry.group.title === undefined ? entry.section.title : `${entry.section.title} › ${entry.group.title}`}</h2>
          {group(entry.group, entry.items, 0, false)}
        </section>
      ))
    )
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
          {onHotkeys && !searching && (
            <KeySearch
              ctx={ctx}
              query={hotkeyQuery}
              answering={hotkeyQuery === keyQuery}
              filter={hotkeyFilter}
              onFilter={setHotkeyFilter}
              onQuery={(next, pressed) => {
                if (pressed) setKeyQuery(next)
                setHotkeyQuery(next)
              }}
            />
          )}
          {searching ? (
            hitList(hits, query)
          ) : searchingHotkeys ? (
            hitList(hotkeyHits, hotkeyQuery, 'hotkeys')
          ) : (
            section(shown)
          )}
        </div>
      </div>
    </div>
  )
}
