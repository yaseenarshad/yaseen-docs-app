/**
 * The Inbox's top row (YAZ-5017, as Mochi's): on the left the filter menu "All cards ▾" (All cards, Up next (YAZ-5028),
 * Due today, New cards, each with how many are left; Up next only while some card of the vault is marked Up next, YAZ-5321; Up next's count in the Up next chip's colours, grey at 0), then what
 * is under review, quiet, by it ("· in spanish-words": "Folder / Sub", or the page) ONLY when the review is narrower than
 * the vault (Review this folder / page; YAZ-5017 round 2, Yaseen: "isnt this redundant?"); then the CURRENT card's place,
 * one card at a time, the Inbox's ONE breadcrumb (YAZ-5132, Yaseen: "we should just have the breadcrumb at the top"):
 * the vault, its folders and the page, "Cards Demo › spanish-words › Verbs", each with the tree's own icon (`FileIcon`:
 * a folder's, a page's); a card file ends at its folder (its name is its title, the head's). Each part is a link: a
 * folder its folder page (`openPlace`, the folder chips' door), the page as O opens it. A long path gives way in the middle, "…".
 * On the right today's work across the vault, quiet ("Today: 31 cards · 9 min", YAZ-5033; the time hidden behind a
 * clock's hover box by default, YAZ-5130, `TodayWork`), then "3 of 12", which counts the filter's cards. Under it the progress bar (YAZ-5020, as
 * Mochi's): it fills as the filter's cards are answered, a Forgot in red, a Remembered in grey; only the tab on show
 * counts (YAZ-5432, `filterProgress`), so Due today done fills it.
 *
 * Add more for today (YAZ-5042): the counts stay in this one menu. Round 2 (Yaseen: "2 and then its whatever the
 * total is? like / 5"): the Up next row reads "today / total" — "2 / 5" (New cards' count stands alone, YAZ-5434); the total is every
 * card of that kind and never changes with an add. With no limit the count stands alone, as before. A click on a count
 * while cards wait turns the row into "Add [10] more new cards" (`AddMoreField`): Enter adds that many to today
 * (10 + 12 = 22), Esc goes back; the menu stays open, so the count changes before your eyes. After an add the row
 * says "22 / 48 · Reset": Reset sets today back to the Settings number, never below today's work. No pop-up: it
 * changes today only, and the line under the buttons (Undo, ⌘Z) takes back the last add or Reset.
 *
 * To fix (YAZ-5097): the cards marked Fix later, the last row, under a line. It is no review: its pick shows the
 * cards as a list, to look at, each with Fixed (`CardInbox`).
 *
 * Where new cards come from (YAZ-5322; YAZ-5434, Yaseen: "go with A one, tree corner line"): the New cards row reads
 * "New cards  9", the same shape as the others (no "/ 23": the total made the row long), so the menu is as wide as its
 * widest plain row and the counts stand in one column. Under it, indented, a second small line: a thin tree corner drops
 * from the New cards glyph into a folder glyph, the pick ("All folders", "Spanish") and a small ▾. The line never widens
 * the menu (a long name gets "…"). A click on it, or Enter, opens the folder picker (`NewCardsPicker`) beside the menu;
 * the first line is the filter, as before. The pointer's wash covers both lines. While a folder is picked, the chip
 * "New cards: Spanish ×" sits by the filter; × goes back to All folders. The count follows the pick (`cardPlan`).
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
import { pickLabel, useNewCardsPicker } from './NewCardsPicker'
import { ChevronIcon, DueIcon, FixIcon, FolderIcon, InboxTrayIcon, NewIcon, PageIcon, UpNextIcon, VaultIcon } from './cardInboxIcons'

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
  { id: 'fix', label: 'To fix', icon: FixIcon },
]

/**
 * The filters the cards menu offers (YAZ-5321, Yaseen: "Up next should only show if they have in the card base, in the
 * vault, up next selected"): Up next only while some card of the vault is marked Up next, or while it is the filter
 * on show (its last card answered just now). One mark brings the row back.
 */
export const inboxFilters = (session: Pick<CardReviewSession, 'upNext' | 'filter'>): typeof CARD_FILTERS => CARD_FILTERS.filter((f) => f.id !== 'next' || session.upNext || session.filter === 'next')

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
  const closeMenu = () => {
    setMenu(null)
    setAdding(null)
    picker.close()
  }
  const picked = pickLabel(session.newFrom)
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
        {todayCards(session.today) !== '' && (
          <span className="card-inbox__today">
            <TodayWork today={session.today} time={time} />
          </span>
        )}
        {session.card !== null && (
          <span className="card-inbox__place">
            {session.position} of {session.total}
          </span>
        )}
        {tools !== undefined && <span className="card-inbox__tools">{tools}</span>}
        {menu !== null && (
          <ContextMenuSurface x={menu.x} y={menu.y} onClose={closeMenu} className="card-inbox__filter-menu">
            {inboxFilters(session).map((f) => {
              // YAZ-5042: the two rows that have a number a day read "today / total" (round 2), and add on a click.
              const kind: AddKind | null = f.id === 'new' ? 'new' : f.id === 'next' ? 'next' : null
              const add = kind === null || addCards === undefined ? 0 : session.adds[kind]
              const count = f.id === 'fix' ? session.toFix.length : session.counts[f.id]
              // YAZ-5434: New cards' count stands alone ("9", not "9 / 23"); only Up next keeps its total.
              const total = kind === 'next' && session.limited.next ? count + session.more.next : null
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
                  </span>
                  <span
                      className="card-inbox__count"
                      data-filter={f.id}
                      data-empty={count === 0 || undefined}
                      data-add={add > 0 || undefined}
                      title={kind !== null && add > 0 ? `${session.more[kind]} more wait. Click to add.` : undefined}
                    >
                    {total === null ? count : `${count} / ${total}`}
                  </span>
                </button>
              )
              // YAZ-5434: the pick on its own small line under New cards, joined to the row by a tree corner.
              const from = f.id === 'new' && pick !== undefined
              return (
                <Fragment key={f.id}>
                  {/* YAZ-5097: a line sets the To fix list apart: its cards are to look at, not to review. */}
                  {f.id === 'fix' && <div className="card-inbox__filter-sep" role="separator" />}
                  <div className="card-inbox__filter-row" role="none" data-from={from || undefined}>
                  {from ? (
                    <div className="card-inbox__new-group" role="none">
                      {item}
                      <button
                        type="button"
                        role="menuitem"
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
                      </button>
                    </div>
                  ) : (
                    item
                  )}
                  {reset && (
                    <button type="button" role="menuitem" className="card-inbox__reset" data-kind={kind} aria-label={`Reset today's ${kind === 'new' ? 'new cards' : 'Up next cards'} to the Settings number`} onMouseDown={(e) => e.preventDefault()} onClick={() => resetCards?.(kind)}>
                      Reset
                    </button>
                  )}
                  </div>
                </Fragment>
              )
            })}
          </ContextMenuSurface>
        )}
        {menu !== null && picker.picker}
      </div>
      <div className="card-inbox__progress" role="progressbar" aria-label="Cards answered" aria-valuemin={0} aria-valuemax={session.progress.size} aria-valuenow={session.progress.done}>
        {session.progress.runs.map((run, i) => (
          <span
            key={i}
            className="card-inbox__progress-part"
            data-missed={run.missed || undefined}
            style={{
              width: `${(100 * run.count) / Math.max(1, session.progress.size)}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
