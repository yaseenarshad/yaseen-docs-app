/**
 * THE PACK PAGE (YAZ-4361; round 3 decision 6, extra 14). "More from this pack" on an Iconify tile's menu opens that
 * pack in the Add panel, so the user can explore it: ‹ Back, the pack's name, its icon count and license, "Pin pack",
 * a search field for this pack only, and every icon of it by scrolling (the grid is the caller's, `children`).
 *
 * It is the same search with `filters.packs = [prefix]` (2C), streaming or from the packs on the Mac. Back returns to
 * the search under it, at the same results and scroll (`imageStudioSession.closePack`). Pinned packs lead Filter ›
 * Packs, and travel with the settings (`mediaPinnedPacks`).
 */
import { useEffect, useRef, type ReactNode } from 'react'
import type { PackPage } from './imageStudioSession'

export interface PackViewProps {
  pack: PackPage
  pinned: boolean
  onBack: () => void
  onPin: () => void
  onType: (query: string) => void
  /** Enter in the field: search now, not after the pause. */
  onSearchNow: () => void
  children: ReactNode
}

export function PackView({ pack, pinned, onBack, onPin, onType, onSearchNow, children }: PackViewProps) {
  const back = useRef<HTMLButtonElement>(null)
  // The page opens from a menu item, which is gone: the focus lands on Back.
  useEffect(() => back.current?.focus(), [pack.prefix])
  const name = pack.info?.name ?? pack.prefix
  return (
    <div className="image-studio__pack" role="region" aria-label={`Pack: ${name}`}>
      <header className="image-studio__pack-head">
        <button type="button" ref={back} className="image-studio__pack-back" onClick={onBack} aria-label="Back to the search">
          ‹ Back
        </button>
        <div className="image-studio__pack-title">
          <h3>{name}</h3>
          {pack.info !== null && (
            <span className="image-studio__pack-facts">
              {pack.info.total.toLocaleString()} icons · {pack.info.license.title}
            </span>
          )}
        </div>
        <button type="button" className={pinned ? 'image-studio__pack-pin is-active' : 'image-studio__pack-pin'} aria-pressed={pinned} onClick={onPin}>
          {pinned ? 'Pinned' : 'Pin pack'}
        </button>
      </header>
      <input
        type="search"
        className="image-studio__pack-search"
        aria-label={`Search ${name}`}
        placeholder={`Search ${name}`}
        value={pack.query}
        onChange={(event) => onType(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSearchNow()
          } else if (event.key === 'Escape' && pack.query === '') {
            event.preventDefault()
            onBack()
          }
        }}
      />
      {children}
    </div>
  )
}
