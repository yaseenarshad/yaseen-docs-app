/**
 * THE FILTER BUTTON AND MENU (YAZ-4360; round 3 decisions 4 and 5; extras 13, 15, 16). Right of the Add panel's search
 * field. The menu, top to bottom:
 *  - Show: All, Favorites, Components, Shapes, Icons, Photos (Photos only with a Pixabay key);
 *  - Colors: Any, One color, Many colors;
 *  - Style: Any, Outline, Filled, Duotone, Emoji;
 *  - Packs: every pack, or "Choose packs…" with the pinned packs first (YAZ-4361);
 *  - License: Any, Business-safe;
 *  - Similar icons: "Group them (+N)" or "Show each one" (YAZ-4348 demo round 2), a view choice, not a filter.
 * "Clear filters" sits at the top right, on the Show line; Show goes back to All too, and Similar icons stays. It is
 * the last item in the keys' order. A badge on the button counts what is on: each filter, and Show when it is not All.
 *
 * MAIN applies the filters (`MediaSearchRequest.filters`); this menu only picks them. The caller keeps them in the
 * settings (`mediaFilters`, which travel; Show stays in the window's session) and searches again at once. With the
 * packs on the Mac that answer is instant.
 *
 * Keys: Esc closes it and puts the focus back on the button; the arrow keys walk its items; a click outside closes it.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { activeFilterCount, type IconPackInfo, type MediaColorFilter, type MediaFilters, type MediaLicenseFilter, type MediaStyleFilter } from '@shared/iconPacks'
import { STUDIO_CHIP_LABELS, type StudioChip } from './imageStudioSession'

const COLORS: readonly [MediaColorFilter, string][] = [
  ['any', 'Any'],
  ['one', 'One color'],
  ['many', 'Many colors'],
]
const STYLES: readonly [MediaStyleFilter, string][] = [
  ['any', 'Any'],
  ['outline', 'Outline'],
  ['filled', 'Filled'],
  ['duotone', 'Duotone'],
  ['emoji', 'Emoji'],
]
const LICENSES: readonly [MediaLicenseFilter, string][] = [
  ['any', 'Any'],
  ['business', 'Business-safe'],
]

/** The most packs the chooser draws at once; the find field narrows the rest. */
const MAX_PACK_ROWS = 300

export interface FilterMenuProps {
  /** What the tab shows (the old chips). */
  show: StudioChip
  /** The Show choices on offer: Photos only with a Pixabay key. */
  shows: readonly StudioChip[]
  onShow: (show: StudioChip) => void
  filters: MediaFilters
  onChange: (next: MediaFilters) => void
  /** "Clear filters": Show back to All and every filter off. */
  onClear: () => void
  /** The pinned packs, first pinned first: they lead the chooser. */
  pinned: readonly string[]
  /** Every pack that can be chosen; asked the first time "Choose packs…" opens. */
  loadPacks: () => Promise<IconPackInfo[]>
  /** Similar icons (YAZ-4348 demo round 2): true groups look-alikes behind "+N". A view choice: no badge, Clear keeps it. */
  groupSimilar: boolean
  onGroupSimilar: (on: boolean) => void
}

/** The packs in the chooser's order: pinned first (in pin order), then by name. */
export function packOrder(packs: readonly IconPackInfo[], pinned: readonly string[]): IconPackInfo[] {
  const at = (prefix: string) => {
    const i = pinned.indexOf(prefix)
    return i === -1 ? Infinity : i
  }
  return [...packs].sort((a, b) => at(a.prefix) - at(b.prefix) || a.name.localeCompare(b.name))
}

export function FilterMenu({ show, shows, onShow, filters, onChange, onClear, pinned, loadPacks, groupSimilar, onGroupSimilar }: FilterMenuProps) {
  const [open, setOpen] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [packs, setPacks] = useState<IconPackInfo[] | null>(null)
  const [packsFailed, setPacksFailed] = useState(false)
  const [find, setFind] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  const count = activeFilterCount(filters) + (show === 'all' ? 0 : 1)

  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLElement>('[role="menu"] [role^="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  useEffect(() => {
    if (!choosing || packs !== null) return
    let live = true
    setPacksFailed(false)
    loadPacks().then(
      (list) => live && setPacks(list),
      () => live && setPacksFailed(true),
    )
    return () => {
      live = false
    }
  }, [choosing, packs, loadPacks])

  const rows = useMemo(() => {
    if (packs === null) return []
    const words = find.trim().toLowerCase()
    const ordered = packOrder(packs, pinned)
    return (words === '' ? ordered : ordered.filter((p) => p.name.toLowerCase().includes(words) || p.prefix.includes(words))).slice(0, MAX_PACK_ROWS)
  }, [packs, pinned, find])
  const nameOf = (prefix: string) => packs?.find((p) => p.prefix === prefix)?.name ?? prefix

  const close = () => {
    setOpen(false)
    setChoosing(false)
    box.current?.querySelector<HTMLElement>('.image-studio__filter-button')?.focus()
  }
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    // The find field keeps its own arrow keys only for its caret; the list below it is one step away.
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  const radios = <T extends string>(label: string, options: readonly [T, string][], value: T, pick: (value: T) => void) => (
    <div className="image-studio__filter-group" role="group" aria-label={label}>
      <div className="image-studio__filter-label">{label}</div>
      <div className="image-studio__filter-options">
        {options.map(([option, text]) => (
          <button type="button" key={option} role="menuitemradio" aria-checked={value === option} className={value === option ? 'is-active' : undefined} onClick={() => pick(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )

  const togglePack = (prefix: string) =>
    onChange({ ...filters, packs: filters.packs.includes(prefix) ? filters.packs.filter((p) => p !== prefix) : [...filters.packs, prefix] })

  return (
    <span className="image-studio__filter" ref={box}>
      <button
        type="button"
        className={count > 0 ? 'image-studio__filter-button is-on' : 'image-studio__filter-button'}
        aria-label={count > 0 ? `Filter, ${count} on` : 'Filter'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Show and filter"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />
        </svg>
        {count > 0 && (
          <span className="image-studio__filter-badge" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="image-studio__filter-menu" role="menu" aria-label="Show and filter" onKeyDown={keys}>
          {radios(
            'Show',
            shows.map((c): [StudioChip, string] => [c, STUDIO_CHIP_LABELS[c]]),
            show,
            onShow,
          )}
          {radios('Colors', COLORS, filters.colors, (colors) => onChange({ ...filters, colors }))}
          {radios('Style', STYLES, filters.style, (style) => onChange({ ...filters, style }))}
          <div className="image-studio__filter-group" role="group" aria-label="Packs">
            <div className="image-studio__filter-label">Packs</div>
            <div className="image-studio__filter-options">
              <button type="button" role="menuitemradio" aria-checked={filters.packs.length === 0} className={filters.packs.length === 0 ? 'is-active' : undefined} onClick={() => onChange({ ...filters, packs: [] })}>
                All packs
              </button>
              <button type="button" role="menuitem" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
                {filters.packs.length > 0 ? `${filters.packs.length} chosen…` : 'Choose packs…'}
              </button>
            </div>
            {filters.packs.length > 0 && !choosing && <div className="image-studio__filter-chosen">{filters.packs.map(nameOf).join(', ')}</div>}
            {choosing && (
              <div className="image-studio__filter-packs">
                <input type="search" aria-label="Find a pack" placeholder="Find a pack" value={find} onChange={(event) => setFind(event.target.value)} />
                {packs === null && <div className="image-studio__filter-note">{packsFailed ? 'The pack list could not load.' : 'Loading packs…'}</div>}
                <div className="image-studio__filter-pack-list">
                  {rows.map((pack) => (
                    <button
                      type="button"
                      key={pack.prefix}
                      role="menuitemcheckbox"
                      aria-checked={filters.packs.includes(pack.prefix)}
                      className={filters.packs.includes(pack.prefix) ? 'is-active' : undefined}
                      title={`${pack.name} · ${pack.total.toLocaleString()} icons · ${pack.license.title}`}
                      onClick={() => togglePack(pack.prefix)}
                    >
                      <span aria-hidden="true">{filters.packs.includes(pack.prefix) ? '✓' : ''}</span>
                      <span className="image-studio__filter-pack-name">{pack.name}</span>
                      {pinned.includes(pack.prefix) && <span className="image-studio__filter-pin">Pinned</span>}
                      <span className="image-studio__filter-pack-count">{pack.total.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {radios('License', LICENSES, filters.license, (license) => onChange({ ...filters, license }))}
          {radios<'group' | 'each'>(
            'Similar icons',
            [
              ['group', 'Group them (+N)'],
              ['each', 'Show each one'],
            ],
            groupSimilar ? 'group' : 'each',
            (choice) => onGroupSimilar(choice === 'group'),
          )}
          <button type="button" role="menuitem" className="image-studio__filter-clear" disabled={count === 0} onClick={onClear}>
            Clear filters
          </button>
        </div>
      )}
    </span>
  )
}
