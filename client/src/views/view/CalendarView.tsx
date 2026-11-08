import { type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { openTarget } from '../../lib/openGesture'
import { type DayKey, bucketByDay, addDays, monthStart, monthWeeks, timeFirst, timeOf, todayKey, weekDays, weekLabel } from '../calendar'
import { type Row, propertyLabel } from '../engine'
import { NO_READ_ONLY } from '../readOnlyRows'
import type { Mutate, ViewDef, ViewSet } from '../viewSchema'
import { type NoteWindowLink, currentItemClass, useNoteWindowItems } from './NoteWindow'
import { PageContextMenu } from './PageContextMenu'
import { ReadOnlyName } from './ReadOnlyMark'
import { FolderIcon } from './icons'
import { isFolderRow } from '../../links/shortcuts'
import type { ViewHover } from './viewHover'

export interface CalendarViewProps {
  hover: ViewHover
  /** The engine's filtered and sorted rows, after search (D4): group by does not apply, days are the groups. */
  rows: readonly Row[]
  /** The bare key the calendar shows by (`calendarDateKey`); null = the folder has no date column. */
  dateKey: string | null
  /** Read-only notes do not drag (YAZ-3076 D6). */
  readOnly?: ReadonlySet<string>
  onOpenFile?: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  /** "Open in a window" in the card's right-click menu (YAZ-4547 D24): ViewsPane's card; absent = no item. */
  onOpenWindow?: (path: string) => void
  /** The card's link: the calendar writes its order and marks the card's note (D24). */
  windowLink?: NoteWindowLink
  /** Where a failed page action of the right-click menu says so. */
  onNotice?: (message: string) => void
  /** A drop on a day, or on the "No date" tray (`null`): ViewsPane's optimistic write. */
  onMoveToDay: (path: string, day: DayKey | null) => void
  /** The last failed move, flagged on its card. */
  moveError: { path: string; message: string } | null
  /** "+" on a day (S10): a new note with that date. */
  onNewOnDay?: (day: DayKey) => void
  /** The tab's `calendarScale` (YAZ-4558 D22): a month grid, or one week of 7 tall days. */
  scale: 'month' | 'week'
  /** The Month / Week switch: ViewsPane writes `calendarScale` (Settings' scale deletes it). */
  onScale: (scale: 'month' | 'week') => void
  /** `cardTitles: wrap` (YAZ-4558 D23): titles take more lines and the day grows; else one line with "…". */
  wrap?: boolean
  /** Settings › Folder pages › Week starts on Sunday (YAZ-4585); else Monday (D11). */
  sundayFirst?: boolean
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SUNDAY_FIRST = ['Sun', ...WEEKDAYS.slice(0, 6)]
/** Cards a day shows before "+N more" (D11). */
const DAY_CARDS = 3
/** Cards the "No date" tray shows before "+N more" (YAZ-4544): a folder with no dates yet renders 20, not 1000, on each drag over. */
const TRAY_CARDS = 20
/** The drop id of the "No date" tray; a day's id is its key. */
const NO_DATE = 'none'
const SCALES = [
  ['month', 'Month'],
  ['week', 'Week'],
] as const

/**
 * The calendar view (YAZ-4540, YAZ-949): a month grid, Monday first (D11), with ‹, › and Today.
 * Each note goes on the date part of its `dateKey` value as written (S3); a day shows 3 cards and
 * "+N more", which opens the whole day in place. Today's date wears a ring (S7). A plain click opens
 * the note in a background tab, ⌥-click in the right panel, Enter in this tab (D11). Dragging a card
 * to a day writes that day and keeps the time (D4); the "No date" tray below takes a card (its date
 * goes) and gives one. Only the drag and the shown day are state here: the rows go into days ONCE per
 * rows change, in a `useMemo`, and a dragover sets state only when the hovered target changes.
 * Week (YAZ-4558 D22): Monday to Sunday as 7 tall days with every card, the timed ones first in time
 * order; ‹ › step a week. Both scales show the month or the week that holds `anchor`, so the switch
 * keeps the place.
 */
export function CalendarView({ hover, rows, dateKey, readOnly = NO_READ_ONLY, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow, windowLink, onNotice, onMoveToDay, moveError, onNewOnDay, scale, onScale, wrap = false, sundayFirst = false }: CalendarViewProps) {
  // The day whose month (or week) shows: today at first; Month's ‹ › set it to the 1st of a month.
  const [anchor, setAnchor] = useState<DayKey>(todayKey)
  const month = { y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 }
  const [expanded, setExpanded] = useState<DayKey | null>(null)
  const [trayAll, setTrayAll] = useState(false)
  const [drag, setDrag] = useState<{ path: string; from: DayKey | null } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  /** The card's right-click menu (YAZ-4547 D24), as the board's. */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null)
  const { days, undated } = useMemo(() => bucketByDay(rows, dateKey), [rows, dateKey])
  const weeks = useMemo(() => (scale === 'week' ? [weekDays(anchor, sundayFirst)] : monthWeeks(month.y, month.m, sundayFirst)), [scale, anchor, month.y, month.m, sundayFirst])
  // Each day on screen in its order, the timed cards first in time order (D22), in Month and in Week alike, so the
  // note window steps exactly as the days show. Once per rows or page change, not on each dragover.
  const dayCards = useMemo(
    () => new Map(weeks.flat().map((day) => [day, dateKey === null ? [] : timeFirst(days.get(day) ?? [], dateKey)])),
    [weeks, days, dateKey],
  )
  // The note window (YAZ-4547 D24): day by day across the days on screen, the timed cards first within a day (every
  // card, also those behind "+N more"), then "No date". Once per rows or page change, not on each dragover.
  const windowOrder = useMemo(
    () => (dateKey === null ? [] : [...weeks.flat().flatMap((day) => dayCards.get(day) ?? []), ...undated]),
    [weeks, dayCards, undated, dateKey],
  )
  const rootRef = useRef<HTMLDivElement>(null)
  useNoteWindowItems(windowLink, windowOrder, rootRef)

  const clear = () => {
    setDrag(null)
    setOver(null)
  }
  // Esc cancels a drag, as on the board (`useGroupDrag`).
  useEffect(() => {
    if (drag === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drag])

  if (dateKey === null)
    return (
      <div className="view-cal__hint">
        <p>Calendar views place notes on a date. Add a Date column in Properties, or give a note a date such as 2026-12-03.</p>
      </div>
    )

  const today = todayKey()
  const isWeek = scale === 'week'
  const step = (by: number) => setAnchor((a) => (isWeek ? addDays(a, 7 * by) : monthStart(a, by)))
  const goToday = () => setAnchor(todayKey())
  const unit = isWeek ? 'week' : 'month'
  const title = isWeek ? weekLabel(weeks[0]) : `${MONTHS[month.m]} ${month.y}`

  /** The click rule here (D11): plain and ⌘ → a background tab, ⌥ → the right panel, ⇧ / ⌃ → nothing. */
  const open = (e: ReactMouseEvent, path: string) => {
    const target = openTarget(e)
    if (target === 'right') onOpenFileRight?.(path)
    else if (target !== null) onOpenFileBackground?.(path)
  }

  const target = (day: DayKey | null) => {
    const id = day ?? NO_DATE
    return {
      onDragOver: (e: ReactDragEvent) => {
        if (drag === null || drag.from === day) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        if (over !== id) setOver(id)
      },
      onDragLeave: (e: ReactDragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        if (over === id) setOver(null)
      },
      onDrop: (e: ReactDragEvent) => {
        e.preventDefault()
        const d = drag
        clear()
        if (d !== null && d.from !== day) onMoveToDay(d.path, day)
      },
    }
  }

  const card = (row: Row, from: DayKey | null) => {
    const path = row.record.path
    const locked = readOnly.has(path)
    const time = from === null ? null : timeOf(row.record.properties[dateKey])
    return (
      <li
        key={path}
        className={`view-cal__card${wrap ? ' view-cal__card--wrap' : ''}${drag?.path === path ? ' view-cal__card--drag' : ''}${currentItemClass(windowLink, path)}`}
        tabIndex={0}
        {...(!locked && {
          draggable: true,
          onDragStart: (e: ReactDragEvent) => {
            e.dataTransfer?.setData('text/plain', path)
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
            setDrag({ path, from })
          },
          onDragEnd: clear,
        })}
        {...hover.itemProps(path)}
        onClick={(e) => open(e, path)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, path, title: row.record.title })
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || e.key !== 'Enter') return
          e.preventDefault()
          onOpenFile?.(path)
        }}
      >
        {time !== null && <span className="view-cal__time">{time}</span>}
        {/* Clip shows the full title on a hover (D23); a wrapped title is all there. */}
        <span className="view-cal__card-title" title={wrap ? undefined : row.record.title}>
          {/* A subfolder's row (YAZ-4579 D32) wears the folder icon here too. */}
          {isFolderRow(row.record) && <FolderIcon size={12} className="view-folder-row__icon" />}
          {locked ? <ReadOnlyName>{row.record.title}</ReadOnlyName> : row.record.title}
        </span>
        {moveError?.path === path && (
          <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
            Move failed
          </span>
        )}
      </li>
    )
  }

  return (
    <div ref={rootRef} className="view-cal">
      <div className="view-cal__nav">
        <button type="button" className="view-toolbar__btn" aria-label={`Previous ${unit}`} title={`Previous ${unit}`} onClick={() => step(-1)}>
          ‹
        </button>
        <button type="button" className="view-toolbar__btn" aria-label={`Next ${unit}`} title={`Next ${unit}`} onClick={() => step(1)}>
          ›
        </button>
        <button type="button" className="view-toolbar__btn view-cal__today" aria-label="Today" onClick={goToday}>
          Today
        </button>
        <div className="view-seg view-cal__scale" role="group" aria-label="Calendar scale">
          {SCALES.map(([value, text]) => (
            <button key={value} type="button" className="view-seg__opt" data-scale={value} aria-pressed={scale === value} onClick={() => scale !== value && onScale(value)}>
              {text}
            </button>
          ))}
        </div>
        <h3 className="view-cal__month">{title}</h3>
      </div>
      <div className={`view-cal__grid${isWeek ? ' view-cal__grid--week' : ''}`} role="grid" aria-label={title}>
        <div className="view-cal__week" role="row">
          {(sundayFirst ? SUNDAY_FIRST : WEEKDAYS).map((d) => (
            <span key={d} className="view-cal__weekday" role="columnheader">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="view-cal__week" role="row">
            {week.map((day) => {
              const list = dayCards.get(day) ?? []
              const all = expanded === day
              // Week shows every card (D22); Month shows DAY_CARDS and "+N more". Both put the timed cards first.
              const shown = isWeek || all ? list : list.slice(0, DAY_CARDS)
              const inMonth = isWeek || Number(day.slice(5, 7)) === month.m + 1
              return (
                <div
                  key={day}
                  role="gridcell"
                  data-day={day}
                  aria-current={day === today ? 'date' : undefined}
                  className={`view-cal__day${inMonth ? '' : ' view-cal__day--other'}${day === today ? ' view-cal__day--today' : ''}${over === day ? ' view-cal__day--drop' : ''}`}
                  {...target(day)}
                >
                  <div className="view-cal__day-head">
                    <span className="view-cal__date">{Number(day.slice(8))}</span>
                    {onNewOnDay !== undefined && (
                      <button type="button" className="view-cal__add" aria-label={`New note on ${day}`} title="New note on this day" onClick={() => onNewOnDay(day)}>
                        +
                      </button>
                    )}
                  </div>
                  {shown.length > 0 && <ul className="view-cal__cards">{shown.map((row) => card(row, day))}</ul>}
                  {!isWeek && list.length > DAY_CARDS && (
                    <button type="button" className="view-cal__more" onClick={() => setExpanded(all ? null : day)}>
                      {/* A narrow day shows "+3" (YAZ-4544): views.css hides the word. */}
                      {all ? 'Show less' : <>+{list.length - DAY_CARDS}<span className="view-cal__more-word"> more</span></>}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <section className={`view-cal__tray${over === NO_DATE ? ' view-cal__tray--drop' : ''}`} aria-label="No date" {...target(null)}>
        <h4 className="view-cal__tray-title">
          No date <span className="view-cal__tray-count">{undated.length}</span>
        </h4>
        {undated.length > 0 && <ul className="view-cal__cards view-cal__tray-cards">{(trayAll ? undated : undated.slice(0, TRAY_CARDS)).map((row) => card(row, null))}</ul>}
        {undated.length > TRAY_CARDS && (
          <button type="button" className="view-cal__more" onClick={() => setTrayAll(!trayAll)}>
            {trayAll ? 'Show less' : `+${undated.length - TRAY_CARDS} more`}
          </button>
        )}
      </section>
      {menu !== null && (
        <PageContextMenu
          x={menu.x}
          y={menu.y}
          path={menu.path}
          title={menu.title}
          onOpenRight={onOpenFileRight}
          onOpenBackground={onOpenFileBackground}
          onOpenWindow={onOpenWindow}
          onNotice={onNotice}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

export interface CalendarShowByProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  /** The folder's date columns (`dateColumns`), worked out once per records change by `ViewsPane` (YAZ-4544). */
  columns: readonly string[]
  onUpdate: Mutate
}

/** "Show by" (D4): every date column of the folder, one per calendar tab; on the toolbar and in Properties › Calendar. */
export function CalendarShowBy({ def, view, viewIndex, columns, onUpdate }: CalendarShowByProps) {
  const current = typeof view.dateProperty === 'string' ? view.dateProperty : columns[0]
  if (current === undefined) return null
  const options = columns.includes(current) ? columns : [current, ...columns]
  return (
    <select
      className="view-select"
      aria-label="Show by"
      value={current}
      onChange={(e) =>
        onUpdate((d) => {
          d.views[viewIndex].dateProperty = e.target.value
        })
      }
    >
      {options.map((key) => (
        <option key={key} value={key}>
          {propertyLabel(def, key)}
        </option>
      ))}
    </select>
  )
}
