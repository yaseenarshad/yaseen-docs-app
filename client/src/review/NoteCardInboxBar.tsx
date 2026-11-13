/**
 * The Inbox's top row (YAZ-5017, as Mochi's): on the left the filter menu "All cards ▾" (All cards, Due today, New
 * cards, each with how many are left), then where the cards come from as a quiet path (the vault, "Folder / Sub", or
 * the page); on the right "3 of 12", which counts the filter's cards.
 */
import { useRef, useState, type ReactElement } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import type { CardFilter, CardReviewSession } from './useCardReview'
import { ChevronIcon, DueIcon, FolderIcon, InboxTrayIcon, NewIcon, PageIcon, VaultIcon } from './noteCardInboxIcons'

/** The filters in menu order, with their names and glyphs. */
export const CARD_FILTERS: readonly { id: CardFilter; label: string; icon: () => ReactElement }[] = [
  { id: 'all', label: 'All cards', icon: InboxTrayIcon },
  { id: 'due', label: 'Due today', icon: DueIcon },
  { id: 'new', label: 'New cards', icon: () => <NewIcon /> },
]

interface NoteCardInboxBarProps {
  session: CardReviewSession
  setFilter: (filter: CardFilter) => void
}

export function NoteCardInboxBar({ session, setFilter }: NoteCardInboxBarProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const current = CARD_FILTERS.find((f) => f.id === session.filter) ?? CARD_FILTERS[0]
  const ScopeIcon = session.scope === 'page' ? PageIcon : session.scope === 'folder' ? FolderIcon : VaultIcon
  const toggle = () => {
    if (menu !== null) return setMenu(null)
    const r = button.current?.getBoundingClientRect()
    setMenu({ x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4 })
  }
  return (
    <div className="note-card-inbox__bar">
      <button
        ref={button}
        type="button"
        className="note-card-inbox__filter"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        // Not the menu's close-on-press: the click toggles it. The keyboard stays in the Inbox.
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={toggle}
      >
        <current.icon />
        <span>{current.label}</span>
        <ChevronIcon />
      </button>
      <span className="note-card-inbox__from" title={session.from.join(' / ')}>
        <ScopeIcon />
        {session.from.map((part, i) => (
          <span key={i} className="note-card-inbox__from-part">
            {i > 0 && <span className="note-card-inbox__from-sep">/</span>}
            {part}
          </span>
        ))}
      </span>
      {session.card !== null && (
        <span className="note-card-inbox__place">
          {session.position} of {session.total}
        </span>
      )}
      {menu !== null && (
        <ContextMenuSurface x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="note-card-inbox__filter-menu">
          {CARD_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitemradio"
              aria-checked={f.id === session.filter}
              className="ctx-menu__item note-card-inbox__filter-item"
              data-filter={f.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenu(null)
                setFilter(f.id)
              }}
            >
              <span className="note-card-inbox__filter-name">
                <f.icon />
                {f.label}
              </span>
              <span className="note-card-inbox__count">{session.counts[f.id]}</span>
            </button>
          ))}
        </ContextMenuSurface>
      )}
    </div>
  )
}
