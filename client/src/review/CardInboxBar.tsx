/**
 * The Inbox's top row (YAZ-5017, as Mochi's): on the left the filter menu "All cards ▾" (All cards, Up next (YAZ-5028),
 * Due today, New cards, each with how many are left; Up next's count in the Up next chip's colours, grey at 0), then what
 * is under review, quiet, by it ("· in spanish-words": "Folder / Sub", or the page) ONLY when the review is narrower than
 * the vault (Review this folder / page; YAZ-5017 round 2, Yaseen: "isnt this redundant?"); then the CURRENT card's place,
 * one card at a time, the Inbox's ONE breadcrumb (YAZ-5132, Yaseen: "we should just have the breadcrumb at the top"):
 * the vault, its folders and the page, "Cards Demo › spanish-words › Verbs", each with the tree's own icon (`FileIcon`:
 * a folder's, a page's); a card file ends at its folder (its name is its title, the head's). Each part is a link: a
 * folder its folder page (`openPlace`, the folder chips' door), the page as O opens it. A long path gives way in the middle, "…".
 * On the right today's work across the vault, quiet ("Today: 31 cards · 9 min", YAZ-5033; the time hidden behind a
 * clock's hover box by default, YAZ-5130, `TodayWork`), then "3 of 12", which counts the filter's cards. Under it the progress bar (YAZ-5020, as
 * Mochi's): it fills as the session's cards are answered, a Forgot in red, a Remembered in grey.
 *
 * Add more for today (YAZ-5042): the counts stay in this one menu. Round 2 (Yaseen: "2 and then its whatever the
 * total is? like / 5"): the Up next and New cards rows read "today / total" — "2 / 5", "10 / 48"; the total is every
 * card of that kind and never changes with an add. With no limit the count stands alone, as before. A click on a count
 * while cards wait turns the row into "Add [10] more new cards" (`AddMoreField`): Enter adds that many to today
 * (10 + 12 = 22), Esc goes back; the menu stays open, so the count changes before your eyes. After an add the row
 * says "22 / 48 · Reset": Reset sets today back to the Settings number, never below today's work. No pop-up: it
 * changes today only, and the line under the buttons (Undo, ⌘Z) takes back the last add or Reset.
 *
 * Archived (YAZ-5046): the last row, under a line, with how many cards of the scope are archived. It is no review: its
 * pick shows the archived cards as a list, to look at, each with Unarchive (`CardInbox`).
 */
import { Fragment, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import type { CardRating } from '@shared/cardLine'
import type { AddKind } from '@shared/cardSchedule'
import type { CardFilter, CardPlacePart, CardReviewSession } from './useCardReview'
import { FileIcon } from '../sidebar/FileIcon'
import { todayCards } from './reviewTime'
import { TodayWork } from './TodayWork'
import type { TimeSoFar } from '@shared/reviews'
import { AddMoreField } from './AddMoreField'
import { ArchiveIcon, ChevronIcon, DueIcon, FolderIcon, InboxTrayIcon, NewIcon, PageIcon, UpNextIcon, VaultIcon } from './cardInboxIcons'

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
  { id: 'archived', label: 'Archived', icon: ArchiveIcon },
]

/** The bar's parts (YAZ-5020): each run of the same answer as one part, so a long session draws a few boxes, not one per card. */
export function progressRuns(answered: readonly CardRating[]): { missed: boolean; count: number }[] {
  const runs: { missed: boolean; count: number }[] = []
  for (const rating of answered) {
    const missed = rating === 'again'
    const last = runs.at(-1)
    if (last !== undefined && last.missed === missed) last.count++
    else runs.push({ missed, count: 1 })
  }
  return runs
}

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
}

export function CardInboxBar({ session, setFilter, addCards, resetCards, openPlace, time }: CardInboxBarProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // YAZ-5042 round 2: the row whose count turned into "Add [n] more"; it closes with the menu.
  const [adding, setAdding] = useState<AddKind | null>(null)
  const closeMenu = () => {
    setMenu(null)
    setAdding(null)
  }
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
          <span className="card-inbox__today" title="Reviewed today in this vault">
            <TodayWork today={session.today} time={time} />
          </span>
        )}
        {session.card !== null && (
          <span className="card-inbox__place">
            {session.position} of {session.total}
          </span>
        )}
        {menu !== null && (
          <ContextMenuSurface x={menu.x} y={menu.y} onClose={closeMenu} className="card-inbox__filter-menu">
            {CARD_FILTERS.map((f) => {
              // YAZ-5042: the two rows that have a number a day read "today / total" (round 2), and add on a click.
              const kind: AddKind | null = f.id === 'new' ? 'new' : f.id === 'next' ? 'next' : null
              const add = kind === null || addCards === undefined ? 0 : session.adds[kind]
              const count = f.id === 'archived' ? session.archived.length : session.counts[f.id]
              const total = kind !== null && session.limited[kind] ? count + session.more[kind] : null
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
              const pick = (e: MouseEvent) => {
                // A click on a count while cards wait: "Add [n] more" (the menu stays open); elsewhere on the row: the filter.
                if (kind !== null && add > 0 && e.target instanceof Element && e.target.closest('.card-inbox__count') !== null) return setAdding(kind)
                closeMenu()
                setFilter(f.id)
              }
              return (
                <Fragment key={f.id}>
                  {/* YAZ-5046: a line sets Archived apart: its cards are to look at, not to review. */}
                  {f.id === 'archived' && <div className="card-inbox__filter-sep" role="separator" />}
                  <div className="card-inbox__filter-row" role="none">
                    <button type="button" role="menuitemradio" aria-checked={f.id === session.filter} className="ctx-menu__item card-inbox__filter-item" data-filter={f.id} onMouseDown={(e) => e.preventDefault()} onClick={pick}>
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
      </div>
      <div className="card-inbox__progress" role="progressbar" aria-label="Cards answered" aria-valuemin={0} aria-valuemax={session.size} aria-valuenow={session.answered.length}>
        {progressRuns(session.answered).map((run, i) => (
          <span
            key={i}
            className="card-inbox__progress-part"
            data-missed={run.missed || undefined}
            style={{
              width: `${(100 * run.count) / Math.max(1, session.size)}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
