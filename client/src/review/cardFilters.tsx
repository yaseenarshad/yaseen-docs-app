/**
 * The cards menu's filters (the Mac's `CardInboxBar` and the phone's review sheet, YAZ-5691): each one's name and icon,
 * in menu order. ONE list for both, so the phone wears the Mac's icons (the inbox tray, the arrow up to a line, the
 * circle with a check, the dotted circle) in its count and its sheet, never text signs.
 */
import type { ReactElement } from 'react'
import { DueIcon, InboxTrayIcon, NewIcon, UpNextIcon } from './cardInboxIcons'
import { showsFilter } from './inboxMenu'
import type { CardFilter, CardReviewSession } from './useCardReview'

/** The filters in menu order, with their names and glyphs. */
export const CARD_FILTERS: readonly {
  id: CardFilter
  label: string
  icon: () => ReactElement
}[] = [
  { id: 'all', label: 'All cards', icon: InboxTrayIcon },
  { id: 'next', label: 'Up next', icon: UpNextIcon },
  { id: 'due', label: 'Due today', icon: DueIcon },
  { id: 'new', label: 'New cards', icon: () => <NewIcon /> },
]

/** A filter's name: "Due today". */
export const filterLabel = (filter: CardFilter): string => CARD_FILTERS.find((f) => f.id === filter)?.label ?? 'All cards'

/** A filter's icon, as the Mac's menu draws it. */
export function FilterIcon({ filter }: { filter: CardFilter }): ReactElement {
  const Icon = (CARD_FILTERS.find((f) => f.id === filter) ?? CARD_FILTERS[0]).icon
  return <Icon />
}

/**
 * The filters the cards menu offers (YAZ-5321, Yaseen: "Up next should only show if they have in the card base, in the
 * vault, up next selected"): the rule is `showsFilter` (`inboxMenu.ts`).
 */
export const inboxFilters = (session: Pick<CardReviewSession, 'upNext' | 'filter'>): typeof CARD_FILTERS => CARD_FILTERS.filter((f) => showsFilter(f.id, session))
