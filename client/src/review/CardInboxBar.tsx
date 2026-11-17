/**
 * The Inbox's top row (YAZ-5017, as Mochi's): on the left the filter menu "All cards ▾" (All cards, Up next (YAZ-5028),
 * Due today, New cards, each with how many are left; Up next only while some card of the vault is marked Up next, YAZ-5321; Up next's count in the Up next chip's colours, grey at 0), then what
 * is under review, quiet, by it ("· in spanish-words": "Folder / Sub", or the page) ONLY when the review is narrower than
 * the vault (Review this folder / page; YAZ-5017 round 2, Yaseen: "isnt this redundant?"); then the CURRENT card's place,
 * one card at a time, the Inbox's ONE breadcrumb (YAZ-5132, Yaseen: "we should just have the breadcrumb at the top"):
 * its folders and the page, "spanish-words › Verbs" (no vault, YAZ-5682: the Inbox is one vault's), each with the tree's own icon (`FileIcon`:
 * a folder's, a page's); a card file ends at its folder (its name is its title, the head's). Each part is a link: a
 * folder its folder page (`openPlace`, the folder chips' door), the page as O opens it. A long path gives way in the middle, "…".
 * On the right Mochi's count (YAZ-5674, `SessionCount`): a red ✕ K (the misses waiting; none at 0 and in the missed
 * pass), the open filter's icon, then "done / total" of the filter on show (YAZ-5675). Under it Mochi's progress bar
 * (YAZ-5676, `SessionBar`). Today's work across the vault ("Today: 2 learned · 31 reviews · 9 min", YAZ-5033; the time hidden behind a
 * clock's hover box by default, YAZ-5130, `TodayWork`) is the cards menu's last line, as the phone's sheet has it: Mochi's
 * top row has none (Yaseen: "the today is not needed").
 *
 * Add more for today (YAZ-5042): the counts stay in this one menu. Round 2 (Yaseen: "2 and then its whatever the
 * total is? like / 5"): the Up next row reads "today / total" — "2 / 5" (New cards' count stands alone, YAZ-5434); the total is every
 * card of that kind and never changes with an add. With no limit the count stands alone, as before. A click on a count
 * while cards wait turns the row into "Add [10] more new cards" (`AddMoreField`): Enter adds that many to today
 * (10 + 12 = 22), Esc goes back; the menu stays open, so the count changes before your eyes. After an add the row
 * says "22 / 48 · Reset": Reset sets today back to the Settings number, never below today's work. No pop-up: it
 * changes today only, and the line under the buttons (Undo, ⌘Z) takes back the last add or Reset.
 *
 * Where new cards come from (YAZ-5322; YAZ-5685, Yaseen: "how do i make it so that new cards is just even and smooth"):
 * three even rows, "New cards  9" the same shape as the others (no second line under it). The Today line, the menu's
 * last, ends with a small ⚙ (`ReviewSettingsCog`): a click (Enter, Space) opens the settings part under it
 * (`ReviewSettingsPart`, shared with the phone's sheet): "New cards", then "From" and the folder picker's door
 * ("All folders ▾"; a click opens `NewCardsPicker` beside the menu). A click again, or closing the menu, folds it, so
 * it opens folded each time. While a folder is picked the New cards row says it quietly, "New cards · Spanish"
 * (`newRowNote`), and the chip "New cards: Spanish ×" sits by the filter; × goes back to All folders. The count follows
 * the pick (`cardPlan`).
 *
 * No Archived row (YAZ-5319, Yaseen: "there will be too many to review that way"): a folder page's table finds archived
 * cards (Show cards as rows, Card status), and a card's ⋯ menu unarchives it.
 */
import { Fragment, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import type { AddKind } from '@shared/cardSchedule'
import type { CardFilter, CardPlacePart, CardReviewApi, CardReviewSession } from './useCardReview'
import { FileIcon } from '../sidebar/FileIcon'
import { todayCards } from './reviewTime'
import { TodayWork } from './TodayWork'
import type { TimeSoFar } from '@shared/reviews'
import { AddMoreField } from './AddMoreField'
import { SessionBar, SessionCount } from './SessionCount'
import { useNewCardsPicker } from './NewCardsPicker'
import { kindCount, kindCountText, newRowNote, pickLabel, showsFilter } from './inboxMenu'
import { ReviewSettingsCog, ReviewSettingsPart, newCardsSettings, useSettingsFold } from './ReviewSettingsPart'
import { ChevronIcon, DueIcon, FolderIcon, InboxTrayIcon, NewIcon, PageIcon, UpNextIcon, VaultIcon } from './cardInboxIcons'

const NO_PICK: Pick<CardReviewApi, 'setNewFrom' | 'newCardFolders'> = { setNewFrom: () => undefined, newCardFolders: () => ({ all: 0, folders: [] }) }

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

/**
 * The filters the cards menu offers (YAZ-5321, Yaseen: "Up next should only show if they have in the card base, in the
 * vault, up next selected"): the rule is `showsFilter` (`inboxMenu.ts`, shared with the phone).
 */
export const inboxFilters = (session: Pick<CardReviewSession, 'upNext' | 'filter'>): typeof CARD_FILTERS => CARD_FILTERS.filter((f) => showsFilter(f.id, session))

interface CardInboxBarProps {
  session: CardReviewSession
  setFilter: (filter: CardFilter) => void
  /** Add more for today (YAZ-5042): the Up next or New cards row's "Add [n] more" (round 2: the typed number). */
  addCards?: (kind: AddKind, count?: number) => void
  /** Reset (YAZ-5042 round 2): today's number of the kind back to the Settings number. */
  resetCards?: (kind: AddKind) => void
  /** A click on a part of the card's place: the folder page of the vault or a folder, or the page. */
  openPlace?: (part: CardPlacePart) => void
  /** Time so far (YAZ-5130): how today's time shows, Settings › Review. */
  time: TimeSoFar
  /** The folder pick for new cards (YAZ-5322): the picker's rows and its save; without it the row has no "from". */
  pick?: Pick<CardReviewApi, 'setNewFrom' | 'newCardFolders'>
  /** The bar's own controls at its right end, quiet until the bar is pointed at (YAZ-5372: the Inbox's zoom). */
  tools?: ReactNode
}

export function CardInboxBar({ session, setFilter, addCards, resetCards, openPlace, time, pick, tools }: CardInboxBarProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // YAZ-5042 round 2: the row whose count turned into "Add [n] more"; it closes with the menu.
  const [adding, setAdding] = useState<AddKind | null>(null)
  const picker = useNewCardsPicker(pick ?? NO_PICK, session)
  // YAZ-5685: the ⚙'s settings part, folded each time the menu opens.
  const settings = useSettingsFold()
  const closeMenu = () => {
    setMenu(null)
    setAdding(null)
    picker.close()
    settings.fold()
  }
  const picked = pickLabel(session.newFrom)
  const note = newRowNote(session)
  const current = CARD_FILTERS.find((f) => f.id === session.filter) ?? CARD_FILTERS[0]
  const ScopeIcon = session.scope === 'page' ? PageIcon : session.scope === 'folder' ? FolderIcon : VaultIcon
  const toggle = () => {
    if (menu !== null) return closeMenu()
    const r = button.current?.getBoundingClientRect()
    setMenu({ x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4 })
  }
  return (
    <div className="card-inbox__top">
      <div className="card-inbox__bar">
        <button
          ref={button}
          type="button"
          className="card-inbox__filter"
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
        {/* YAZ-5322: the saved pick, while it is on; × goes back to All folders. */}
        {pick !== undefined && picked !== '' && (
          <span className="card-inbox__pick-chip" title={`New cards come from ${picked}`}>
            <span className="card-inbox__pick-chip-name">New cards: {picked}</span>
            <button type="button" className="card-inbox__pick-chip-x" aria-label="New cards from All folders" onMouseDown={(e) => e.preventDefault()} onClick={() => pick.setNewFrom([])}>
              ×
            </button>
          </span>
        )}
        {/* The scope only when narrower than the vault (YAZ-5017 round 2): the whole vault says nothing here. */}
        {session.scope !== 'vault' && (
          <span className="card-inbox__from" title={`Reviewing ${session.from.join(' / ')}`}>
            <span className="card-inbox__from-sep">·</span>
            <ScopeIcon />
            <span className="card-inbox__from-part">in {session.from.join(' / ')}</span>
          </span>
        )}
        {session.place.length > 0 && (
          <nav className="card-inbox__path" aria-label="Card's place" title={session.place.map((p) => p.label).join(' › ')}>
            {session.place.map((part, i) => (
              <Fragment key={part.path}>
                {i > 0 && (
                  <span className="card-inbox__path-sep" aria-hidden="true">
                    ›
                  </span>
                )}
                <button type="button" className="card-inbox__path-part" data-kind={part.kind} disabled={openPlace === undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => openPlace?.(part)}>
                  <FileIcon path={part.path} folder={part.kind !== 'page'} />
                  <span className="card-inbox__path-name">{part.label}</span>
                </button>
              </Fragment>
            ))}
          </nav>
        )}
        {/* YAZ-5680 check 2: on every finish screen too, as Mochi ("Finished learning cards." with 4 / 4). */}
        {session.progress.total > 0 && (
          <span className="card-inbox__place">
            <SessionCount session={session} icon={<current.icon />} />
          </span>
        )}
        {tools !== undefined && <span className="card-inbox__tools">{tools}</span>}
        {menu !== null && (
          <ContextMenuSurface x={menu.x} y={menu.y} onClose={closeMenu} className="card-inbox__filter-menu">
            {inboxFilters(session).map((f) => {
              // YAZ-5042: the two rows that have a number a day read "today / total" (round 2), and add on a click.
              const kind: AddKind | null = f.id === 'new' ? 'new' : f.id === 'next' ? 'next' : null
              const add = kind === null || addCards === undefined ? 0 : session.adds[kind]
              const count = session.counts[f.id]
              // YAZ-5434: New cards' count stands alone ("9", not "9 / 23"); only Up next keeps its total. The phone's rule too (`kindCount`, YAZ-5624).
              const counted = kind === null ? { count, total: null } : kindCount(session, kind)
              const reset = kind !== null && resetCards !== undefined && session.canReset[kind]
              if (kind !== null && adding === kind && add > 0)
                return (
                  <div key={f.id} className="card-inbox__filter-row" role="none" data-adding="">
                    <span className="ctx-menu__item card-inbox__filter-item card-inbox__filter-adding">
                      <span className="card-inbox__filter-name">
                        <f.icon />
                        <AddMoreField
                          kind={kind}
                          look="menu"
                          start={add}
                          onAdd={(n) => {
                            setAdding(null)
                            addCards?.(kind, n)
                          }}
                          onCancel={() => setAdding(null)}
                        />
                      </span>
                    </span>
                  </div>
                )
              const choose = (e: MouseEvent) => {
                // A click on a count while cards wait: "Add [n] more" (the menu stays open); elsewhere on the row: the filter.
                if (kind !== null && add > 0 && e.target instanceof Element && e.target.closest('.card-inbox__count') !== null) return setAdding(kind)
                closeMenu()
                setFilter(f.id)
              }
              const item = (
                <button type="button" role="menuitemradio" aria-checked={f.id === session.filter} className="ctx-menu__item card-inbox__filter-item" data-filter={f.id} onMouseDown={(e) => e.preventDefault()} onClick={choose}>
                  <span className="card-inbox__filter-name">
                    <f.icon />
                    {f.label}
                    {/* YAZ-5685: the pick, quietly; nothing for All folders. */}
                    {f.id === 'new' && pick !== undefined && note !== '' && <span className="card-inbox__filter-note">· {note}</span>}
                  </span>
                  <span
                      className="card-inbox__count"
                      data-filter={f.id}
                      data-empty={count === 0 || undefined}
                      data-add={add > 0 || undefined}
                      title={kind !== null && add > 0 ? `${session.more[kind]} more wait. Click to add.` : undefined}
                    >
                    {kindCountText(counted)}
                  </span>
                </button>
              )
              return (
                <div key={f.id} className="card-inbox__filter-row" role="none">
                  {item}
                  {reset && (
                    <button type="button" role="menuitem" className="card-inbox__reset" data-kind={kind} aria-label={`Reset today's ${kind === 'new' ? 'new cards' : 'Up next cards'} to the Settings number`} onMouseDown={(e) => e.preventDefault()} onClick={() => resetCards?.(kind)}>
                      Reset
                    </button>
                  )}
                </div>
              )
            })}
            {/* YAZ-5674: today's work, out of the top row (Mochi has none there); the phone's sheet ends the same way.
                YAZ-5685: the ⚙ at its right opens the settings part under it. */}
            {(todayCards(session.today) !== '' || pick !== undefined) && (
              <div className="card-inbox__menu-foot" role="none">
                {todayCards(session.today) !== '' && (
                  <p className="card-inbox__menu-today" role="none">
                    <TodayWork today={session.today} time={time} />
                  </p>
                )}
                {pick !== undefined && <ReviewSettingsCog fold={settings} className="card-inbox__cog" />}
              </div>
            )}
            {pick !== undefined && (
              <ReviewSettingsPart
                fold={settings}
                look="card-inbox"
                sections={[
                  newCardsSettings(
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      className="card-inbox__new-from"
                      data-on={picked !== '' || undefined}
                      title={`New cards come from ${picked === '' ? 'All folders' : picked}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => picker.open(e.currentTarget, 'right')}
                    >
                      <FolderIcon size={12} />
                      <span className="card-inbox__new-from-name">{picked === '' ? 'All folders' : picked}</span>
                      <ChevronIcon size={10} />
                    </button>,
                  ),
                ]}
              />
            )}
          </ContextMenuSurface>
        )}
        {menu !== null && picker.picker}
      </div>
      <SessionBar session={session} className="card-inbox__progress" />
    </div>
  )
}
