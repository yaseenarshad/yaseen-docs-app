import { type CSSProperties, type DragEvent as ReactDragEvent, Fragment, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { holdColResize } from '../../lib/colResize'
import { openByKey, openTarget } from '../../lib/openGesture'
import {
  type BarPlace, type DayKey, type Span, type SpanPreview, bucketByDay, addDays, calLine, calLineColor, calLineCss, calendarStartColumn, dayLabel, dayOf, daysBetween, layoutWeek, monthStart, monthWeeks, spanOf, timeFirst, timeOf,
  todayKey, weekDays, weekendHomes, weekendOf, weekLabel, withoutWeekends,
} from '../calendar'
import { type ColorStrengthValue, type IndexRecord } from '@shared/types'
import { type Row, propertyKeys, propertyLabel } from '../engine'
import { type Resolver, isEmpty } from '../expr'
import { type FolderSettings, pageColumnKeys } from '../folderSettings'
import { NO_READ_ONLY } from '../readOnlyRows'
import type { Mutate, ViewDef, ViewSet } from '../viewSchema'
import { CardLine, CardProp, cardLines, cardStyleAttrs } from './cardLines'
import { CardStyleFlyout, type CardStyleWrite } from './CardStyleMenu'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { MenuFlyout, useFlyout } from '../../components/Flyout'
import { StyleFlyout, headerRowVars } from './StylePanel'
import { plainHeaderRow, setHeaderRowPart, shownHeaderRow, toggleHeaderRowPlain } from './TableLookSettings'
import type { ValueHistory } from './valueHistory'
import { canonicalKey } from './keys'
import { type NoteWindowLink, currentItemClass, useNoteWindowItems } from './NoteWindow'
import { PageContextMenu } from './PageContextMenu'
import { Popover } from './Popover'
import { type CardNoteDoors, cardMenuItems } from './rowMenuItems'
import { ReadOnlyName } from './ReadOnlyMark'
import { FolderIcon } from './icons'
import { FolderPages } from './GroupHeader'
import { isFolderRow } from '../../links/shortcuts'
import type { ViewHover } from './viewHover'

export interface CalendarViewProps {
  hover: ViewHover
  /** The view's set, the view and its records, the page's settings and the resolver: a card draws the view's shown columns as the board does (YAZ-4857). */
  def: ViewSet
  view: ViewDef
  records: readonly IndexRecord[]
  settings: FolderSettings
  resolve?: Resolver
  /** The engine's filtered and sorted rows, after search (D4): group by does not apply, days are the groups. */
  rows: readonly Row[]
  /** The bare key the calendar shows by (`calendarDateKey`); null = the folder has no date column. */
  dateKey: string | null
  /** The bare key of the End date (`calendarEndKey`, YAZ-4858): a later end makes a card a bar over its days; null = none chosen. */
  endKey?: string | null
  /** The folder's date columns (`dateColumns`): the "Choose End date" picker lists those that are not the start. */
  dateColumns?: readonly string[]
  /** Read-only notes do not drag (YAZ-3076 D6). */
  readOnly?: ReadonlySet<string>
  onOpenFile?: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  /** "Open in mini window ⇧↩" (D57) and ⇧Enter (YAZ-4605 D56) in the card's right-click menu (YAZ-4547 D24): ViewsPane's card; absent = no item. */
  onOpenWindow?: (path: string) => void
  /** The card's link: the calendar writes its order and marks the card's note (D24). */
  windowLink?: NoteWindowLink
  /** Where a failed page action of the right-click menu says so. */
  onNotice?: (message: string) => void
  /** A drop on a day, or on the "No date" tray (`null`): ViewsPane's optimistic write. */
  onMoveToDay: (path: string, day: DayKey | null) => void
  /**
   * A card's new days (YAZ-4858): an edge drag, or a drop of a card with an end. `start` / `end` absent = that date
   * stays; `null` = it goes. ONE optimistic write with the move's Undo, as `onMoveToDay`.
   */
  onMoveSpan?: (path: string, next: { start?: DayKey | null; end?: DayKey | null }) => void
  /** "Choose End date" in the no-End-column message (YAZ-4858): writes `endDateProperty`. */
  onChooseEnd?: (column: string) => void
  /** "Add a date column" there, when the folder has no other date column: a Date column, chosen as the End date. */
  onAddEndColumn?: () => void
  /** The last failed move, flagged on its card. */
  moveError: { path: string; message: string } | null
  /** "+" on a day (S10): a new note with that date. */
  onNewOnDay?: (day: DayKey) => void
  /** The card menu's note items (YAZ-3746 13BO): Open, the new note beside a card, Duplicate, Delete. Absent: none. */
  noteDoors?: CardNoteDoors
  /** "Card style ›" in a card's menu (YAZ-4906): ViewsPane writes the note's `color`, `text_color` and `weight` (undefined removes a key). Absent: no item. */
  onStyle?: (path: string, writes: CardStyleWrite[]) => void
  /** The page's ⌘Z / ⇧⌘Z history of value changes (`valueHistory.ts`): a card colour is one step of it. Absent: the keys do nothing here. */
  history?: ValueHistory
  /** The day names' "Header row ›" (YAZ-4864 round 3): ONE write of this view, as the View tab's row writes it. Absent: no right-click menu there. */
  onHeaderRow?: (mutate: (view: ViewDef) => void) => void
  /** The tab's `calendarScale` (YAZ-4558 D22): a month grid, or one week of 7 tall days. */
  scale: 'month' | 'week'
  /** The Month / Week switch: ViewsPane writes `calendarScale` (Settings' scale deletes it). */
  onScale: (scale: 'month' | 'week') => void
  /** `cardTitles: wrap` (YAZ-4558 D23): titles take more lines and the day grows; else one line with "…". */
  wrap?: boolean
  /** Settings › Folder pages › Week starts on Sunday (YAZ-4585); else Monday (D11). */
  sundayFirst?: boolean
  /** "Hide weekends" (YAZ-4595 S33): Monday to Friday only; a weekend note shows on the Friday before (the Monday after when that Friday is off the grid, YAZ-4635 P3), marked Sat or Sun. */
  hideWeekends?: boolean
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SUNDAY_FIRST = ['Sun', ...WEEKDAYS.slice(0, 6)]
/** The column heads while weekends hide (YAZ-4595 S33). */
const WORKDAYS = WEEKDAYS.filter((d) => d !== 'Sat' && d !== 'Sun')
/** Cards a day shows before "+N more" (D11); the bars on the day count first (YAZ-4858). */
const DAY_CARDS = 3
/** Cards the "No date" tray shows before "+N more" (YAZ-4544): a folder with no dates yet renders 20, not 1000, on each drag over. */
const TRAY_CARDS = 20
/** The drop id of the "No date" tray; a day's id is its key. */
const NO_DATE = 'none'
const NO_COLUMNS: readonly string[] = []
const SCALES = [
  ['month', 'Month'],
  ['week', 'Week'],
] as const

/** The shown day under `x` on a bar (YAZ-4858): its days are in `data-bar-days`, left to right, each an equal part of it. */
function dayInBar(bar: HTMLElement, x: number): DayKey {
  const days = (bar.dataset.barDays ?? '').split(' ')
  const r = bar.getBoundingClientRect()
  const i = r.width > 0 ? Math.floor(((x - r.left) / r.width) * days.length) : 0
  return days[Math.max(0, Math.min(days.length - 1, i))]
}

/** A bar over a weekend alone (YAZ-4858): with the weekends hidden it has no day on the grid, so it is a one-day card on its start's home day. */
const weekendOnly = (span: Span): boolean => daysBetween(span.start, span.end) <= 1 && weekendOf(span.start) !== null && weekendOf(span.end) !== null

/** An edge drag's span (YAZ-4858): the dragged edge on `day`, stopped at the other edge, so the end is never before the start. */
const stretched = (span: { start: DayKey; end: DayKey }, edge: 'start' | 'end', day: DayKey): { start: DayKey; end: DayKey } =>
  edge === 'start' ? { start: day < span.end ? day : span.end, end: span.end } : { start: span.start, end: day > span.start ? day : span.start }

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
 * Days (YAZ-4858): with an End date column, a card that ends after its start is a bar over its days, in the lanes
 * above the one-day cards (`layoutWeek`); each week row is a grid whose days span all its rows (subgrid), so a lane is
 * as tall as its tallest bar. A card's edges stretch it, a day per step, with one write on release.
 */
/**
 * The grid's lines (YAZ-4878): the view's widths and colours (Settings filled in) as custom properties that views.css
 * reads. The look of before (1 px, Gray, Medium) sets nothing; a Gray, Medium line wider than 1 px is a little darker
 * (`calLineCss`), so the step shows in light and dark mode.
 */
function gridLines(view: ViewDef | undefined): CSSProperties | undefined {
  const week = calLine(view?.weekLine)
  const day = calLine(view?.dayLine)
  const weekColor = calLineColor(view?.weekLineColor)
  const dayColor = calLineColor(view?.dayLineColor)
  const plain = (c: ColorStrengthValue) => c.color === 'gray' && c.strength === 'medium'
  if (week === 1 && day === 1 && plain(weekColor) && plain(dayColor)) return undefined
  return {
    '--cal-week-line': `${week}px`,
    '--cal-day-line': `${day}px`,
    ...(week > 1 || !plain(weekColor) ? { '--cal-week-line-color': calLineCss(weekColor, week) } : {}),
    ...(day > 1 || !plain(dayColor) ? { '--cal-day-line-color': calLineCss(dayColor, day) } : {}),
  } as CSSProperties
}

export function CalendarView({ hover, def, view, records, settings, resolve, rows, dateKey, endKey = null, dateColumns = NO_COLUMNS, readOnly = NO_READ_ONLY, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow, windowLink, onNotice, onMoveToDay, onMoveSpan, onChooseEnd, onAddEndColumn, moveError, onNewOnDay, noteDoors, onStyle, history, onHeaderRow, scale, onScale, wrap = false, sundayFirst = false, hideWeekends = false }: CalendarViewProps) {
  // The view's "Folder icon" (YAZ-4848), through the page's folder context; on outside a folder page.
  const folderIcons = useContext(FolderPages)?.folderIcons ?? true
  // The day whose month (or week) shows: today at first; Month's ‹ › set it to the 1st of a month.
  const [anchor, setAnchor] = useState<DayKey>(todayKey)
  const month = { y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 }
  const [expanded, setExpanded] = useState<DayKey | null>(null)
  const [trayAll, setTrayAll] = useState(false)
  /** A whole-card drag: `from` is the day it left (no write on a drop there), `base` the day a drop's shift counts from (YAZ-4858). */
  const [drag, setDrag] = useState<{ path: string; row: Row; from: DayKey | null; base: DayKey | null } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  /** The card's right-click menu (YAZ-4547 D24), as the board's. */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string; day: DayKey | null; locked: boolean } | null>(null)
  /** The day names' right-click (YAZ-4864 round 3): "Header row ›" with the style panel, in place of the page's greyed-out Cut / Copy / Paste. Before the no-date-column return: a hook. */
  const [headMenu, setHeadMenu] = useState<{ x: number; y: number } | null>(null)
  const headFlyout = useFlyout<string>()
  /** An edge drag (YAZ-4858): the card, the edge, its days when it began, and the day the pointer is on now. */
  const [resize, setResize] = useState<{ path: string; edge: 'start' | 'end'; start: DayKey; end: DayKey; day: DayKey } | null>(null)
  /** The message an edge drag shows with no End date column (YAZ-4858 item 4): at that card; `choosing` shows the picker. */
  const [endAsk, setEndAsk] = useState<{ anchor: HTMLElement; choosing: boolean } | null>(null)
  /** The window listeners of an edge drag in progress, taken off on unmount too. */
  const stopResize = useRef<(() => void) | null>(null)
  useEffect(() => () => stopResize.current?.(), [])
  /** A release after an edge drag clicks the card; that click opens nothing. */
  const resized = useRef(false)
  const preview = useMemo<SpanPreview | null>(() => (resize === null ? null : { path: resize.path, ...stretched(resize, resize.edge, resize.day) }), [resize])
  const { days, multi, undated } = useMemo(() => bucketByDay(rows, dateKey, endKey, preview), [rows, dateKey, endKey, preview])
  // While weekends hide, a bar over a Saturday and Sunday alone has no shown day: it is a one-day card on its start,
  // which `weekendHomes` takes to the Friday (or the Monday) as any weekend card.
  const { singles, bars } = useMemo(() => {
    if (!hideWeekends || !multi.some(weekendOnly)) return { singles: days, bars: multi }
    const singles = new Map(days)
    for (const span of multi) if (weekendOnly(span)) singles.set(span.start, [...(singles.get(span.start) ?? []), span.row])
    return { singles, bars: multi.filter((span) => !weekendOnly(span)) }
  }, [days, multi, hideWeekends])
  // The card's lines (YAZ-4857): the view's shown columns in the board's layout (`cardLines`), less the date columns the
  // card sits on; the name's line holds the time and the weekend mark. Once per view or records change.
  const lines = useMemo(() => {
    const dates = new Set([dateKey, endKey].filter((k) => k !== null).map((k) => `note.${k}`))
    const keys = propertyKeys(def, view, records, pageColumnKeys(settings)).filter((k) => !dates.has(canonicalKey(k)))
    const all = cardLines(keys, view)
    return all.some((line) => line.some((k) => canonicalKey(k) === 'file.name')) ? all : [['file.name'], ...all]
  }, [def, view, records, settings, dateKey, endKey])
  // The grid with its weekends; `weeks` is what shows.
  const allWeeks = useMemo(() => (scale === 'week' ? [weekDays(anchor, sundayFirst)] : monthWeeks(month.y, month.m, sundayFirst)), [scale, anchor, month.y, month.m, sundayFirst])
  const weeks = useMemo(() => (hideWeekends ? allWeeks.map(withoutWeekends) : allWeeks), [allWeeks, hideWeekends])
  // Each week row's bars and lanes (YAZ-4858), once per rows or page change.
  const layouts = useMemo(() => weeks.map((week) => layoutWeek(week, bars)), [weeks, bars])
  // Each day on screen in its order, the timed cards first in time order (D22), in Month and in Week alike, so the
  // note window steps exactly as the days show. While weekends hide (YAZ-4595 S33) a weekday also takes the cards of
  // the weekend days that go to it (`weekendHomes`, YAZ-4635 P3: a Friday its Saturday's then its Sunday's; a Monday
  // the Sunday whose Friday is off the grid), each day in that order. Once per rows or page change, not on each dragover.
  const dayCards = useMemo(() => {
    const of = (day: DayKey) => (dateKey === null ? [] : timeFirst(singles.get(day) ?? [], dateKey))
    const homes = hideWeekends ? weekendHomes(allWeeks) : null
    return new Map(weeks.flat().map((day) => [day, homes === null ? of(day) : [...of(day), ...(homes.get(day) ?? []).flatMap(of)]]))
  }, [allWeeks, weeks, singles, dateKey, hideWeekends])
  /**
   * Month's budget per day (D11, YAZ-4858): a week row shows at most `DAY_CARDS` lanes of bars; a day then shows its
   * one-day cards in the room its shown bars leave, and "+N more" counts the rest, hidden bars too.
   */
  const budgets = useMemo(() => {
    const out = new Map<DayKey, { cards: number; hiddenBars: number }>()
    weeks.forEach((week, w) => {
      const cap = Math.min(layouts[w].lanes, DAY_CARDS)
      week.forEach((day, c) => {
        let shownBars = 0
        let hiddenBars = 0
        for (const bar of layouts[w].bars) if (bar.col <= c && c < bar.col + bar.cols) bar.lane < cap ? shownBars++ : hiddenBars++
        out.set(day, { cards: Math.max(0, DAY_CARDS - shownBars), hiddenBars })
      })
    })
    return out
  }, [weeks, layouts])
  // The note window (YAZ-4547 D24): day by day across the days on screen, a day's bars first (a bar once, on its first
  // day there), then its timed cards (every card, also those behind "+N more"), then "No date". Once per rows or page change.
  const windowOrder = useMemo(() => {
    if (dateKey === null) return []
    const seen = new Set<string>()
    const order: Row[] = []
    weeks.forEach((week, w) =>
      week.forEach((day, c) => {
        for (const bar of layouts[w].bars)
          if (bar.col === c && !seen.has(bar.span.row.record.path)) {
            seen.add(bar.span.row.record.path)
            order.push(bar.span.row)
          }
        order.push(...(dayCards.get(day) ?? []))
      }),
    )
    return [...order, ...undated]
  }, [weeks, layouts, dayCards, undated, dateKey])
  const rootRef = useRef<HTMLDivElement>(null)
  // The mini window's card under a "+N more" (YAZ-3746 13J): that day (or `NO_DATE`, the tray) shows every card while
  // the window is on one of its hidden ones, so ‹ › and the arrow keys show each note highlighted; it folds again when
  // the window moves on or closes. `show` tells each step; the revealed card is in the DOM only after that render, so
  // the effect marks and scrolls it then. A bar in a hidden lane (YAZ-4858) opens the first day of its row.
  const [revealed, setRevealed] = useState<string | null>(null)
  const hiddenHome = (current: string | null): string | null => {
    if (current === null) return null
    if (scale !== 'week') {
      for (const [day, list] of dayCards) if (list.findIndex((r) => r.record.path === current) >= (budgets.get(day)?.cards ?? DAY_CARDS)) return day
      let hidden: DayKey | null = null
      for (const [w, layout] of layouts.entries())
        for (const bar of layout.bars) {
          if (bar.span.row.record.path !== current) continue
          if (bar.lane < DAY_CARDS) return null
          hidden ??= weeks[w][bar.col]
        }
      if (hidden !== null) return hidden
    }
    return undated.findIndex((r) => r.record.path === current) >= TRAY_CARDS ? NO_DATE : null
  }
  useNoteWindowItems(windowLink, windowOrder, rootRef, (current) => setRevealed(hiddenHome(current)))
  useEffect(() => {
    if (revealed !== null) windowLink?.show()
  }, [revealed, windowLink])

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
  // The "No date" tray shows every card by its "+N more", or while the mini window is on a hidden one (13J).
  const trayOpen = trayAll || revealed === NO_DATE
  /** The other date columns, for the message's End date picker (YAZ-4858). */
  const endChoices = dateColumns.filter((k) => canonicalKey(k) !== `note.${dateKey}`)

  /** The click rule here (D11): plain and ⌘ → a background tab, ⌥ → the right panel, ⇧ / ⌃ → nothing. */
  const open = (e: ReactMouseEvent, path: string) => {
    if (resized.current) return
    const target = openTarget(e)
    if (target === 'right') onOpenFileRight?.(path)
    else if (target !== null) onOpenFileBackground?.(path)
  }

  /**
   * A whole-card drop (YAZ-4858): a card with an end moves both its dates by the days from `base` to the drop day, and
   * "No date" clears both; any other card writes the day as before (`onMoveToDay`, D4).
   */
  const moveCard = (d: NonNullable<typeof drag>, day: DayKey | null) => {
    const end = endKey === null || onMoveSpan === undefined ? null : dayOf(d.row.record.properties[endKey])
    if (end === null) return onMoveToDay(d.path, day)
    if (day === null) return onMoveSpan!(d.path, { start: null, end: null })
    const start = dayOf(d.row.record.properties[dateKey])
    const by = daysBetween(d.base ?? day, day)
    onMoveSpan!(d.path, { ...(start === null ? {} : { start: addDays(start, by) }), end: addDays(end, by) })
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
        if (d !== null && d.from !== day) moveCard(d, day)
      },
    }
  }

  /** The shown day at a point (YAZ-4858): a day cell of this calendar, or the part of a bar there. */
  const dayAt = (x: number, y: number): DayKey | null => {
    const el = document.elementFromPoint(x, y)
    if (el === null || rootRef.current?.contains(el) !== true) return null
    const cell = el.closest<HTMLElement>('[data-day]')
    if (cell !== null) return cell.dataset.day ?? null
    const bar = el.closest<HTMLElement>('[data-bar-days]')
    return bar === null ? null : dayInBar(bar, x)
  }

  /**
   * An edge's press (YAZ-4858): the table's column resize feel (`TableView` `startResize`) — the left button only, the
   * window's moves and release, the resize cursor held — snapped to the day under the pointer. The card shows its new
   * days as it goes; the release writes once; Escape stops and writes nothing. The press never starts the card's own
   * drag. With no End date column, the press shows the message instead.
   */
  const startEdge = (row: Row, edge: 'start' | 'end') => (e: ReactMouseEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const card = e.currentTarget.closest<HTMLElement>('.view-cal__card')
    if (endKey === null || onMoveSpan === undefined) {
      if (card !== null) setEndAsk({ anchor: card, choosing: false })
      return
    }
    const props = row.record.properties
    const span = spanOf(props, dateKey, endKey)
    if (span === null) return
    const path = row.record.path
    let at: DayKey = edge === 'start' ? span.start : span.end
    setResize({ path, edge, ...span, day: at })
    const move = (ev: MouseEvent) => {
      const day = dayAt(ev.clientX, ev.clientY)
      if (day === null || day === at) return
      at = day
      setResize((r) => (r === null ? r : { ...r, day }))
    }
    const finish = (write: boolean) => {
      stopResize.current?.()
      setResize(null)
      // The release's click on the card opens nothing (the click comes in this task, before any timer).
      resized.current = true
      setTimeout(() => (resized.current = false), 0)
      if (!write) return
      const next = stretched(span, edge, at)
      const start = dayOf(props[dateKey])
      const end = dayOf(props[endKey])
      // Only the dates that change: a one-day card with no end keeps none.
      const out: { start?: DayKey; end?: DayKey } = {}
      if (next.start !== start) out.start = next.start
      if (next.end !== end && !(next.end === next.start && end === null)) out.end = next.end
      if (out.start !== undefined || out.end !== undefined) onMoveSpan(path, out)
    }
    const up = () => finish(true)
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      finish(false)
    }
    stopResize.current = () => {
      stopResize.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('keydown', key, true)
      holdColResize(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', key, true)
    holdColResize(true)
  }

  /**
   * One card: a one-day card on `from` (null in the tray), or a bar (`place`, YAZ-4858) over `place.days` of its row.
   * Both have the same lines; a dated card has an edge at each end its row does not cut.
   */
  const card = (row: Row, from: DayKey | null, place?: { bar: BarPlace; days: readonly DayKey[] }) => {
    const path = row.record.path
    const locked = readOnly.has(path)
    const time = from === null && place === undefined ? null : timeOf(row.record.properties[dateKey])
    // A weekend note on its Friday or Monday (YAZ-4595 S33, YAZ-4635 P3) says its day. A drop on that day is a drop on its own day: no write.
    const real = from === null ? null : dayOf(row.record.properties[dateKey]) ?? (endKey === null ? null : dayOf(row.record.properties[endKey]))
    const weekend = real === null || real === from ? null : weekendOf(real)
    // A card is small (YAZ-4857 item 3): an empty value is left out, and so is a line with nothing left on it.
    const shown = lines.flatMap((line) => {
      const items = line.filter((k) => canonicalKey(k) === 'file.name' || !isEmpty(row.values[k]))
      return items.length === 0 ? [] : [items]
    })
    const item = (key: string) =>
      canonicalKey(key) === 'file.name' ? (
        // Clip shows the full title on a hover (D23); a wrapped title is all there.
        <span key={key} className={`view-cal__card-title${row.crossed === true ? ' view-cal__card-title--crossed' : ''}`} title={wrap ? undefined : row.record.title}>
          {/* A subfolder's row (YAZ-4579 D32) wears the folder icon here too, unless the view's "Folder icon" is off (YAZ-4848). */}
          {isFolderRow(row.record) && folderIcons && <FolderIcon size={12} className="view-folder-row__icon" />}
          {/* "Cross out when" (YAZ-4864) strikes the whole card's text (`view-cal__card--crossed`): the icon stays as it is. */}
          <span className="view-cal__card-name">{locked ? <ReadOnlyName>{row.record.title}</ReadOnlyName> : row.record.title}</span>
        </span>
      ) : (
        <CardProp key={key} def={def} view={view} row={row} field={key} resolve={resolve} />
      )
    const bar = place?.bar
    // The edges (YAZ-4858): a dated card's two ends; a bar's ends where its row does not cut it. None on a read-only note.
    const edges = !locked && (from !== null || bar !== undefined)
    const className = `view-cal__card${wrap && bar === undefined ? ' view-cal__card--wrap' : ''}${bar === undefined ? '' : ` view-cal__bar${bar.cutStart ? ' view-cal__bar--cut-start' : ''}${bar.cutEnd ? ' view-cal__bar--cut-end' : ''}`}${drag?.path === path ? ' view-cal__card--drag' : ''}${resize?.path === path ? ' view-cal__card--resize' : ''}${row.crossed === true ? ' view-cal__card--crossed' : ''}${currentItemClass(windowLink, path)}`
    const props = {
      className,
      tabIndex: 0,
      // The note's `color`, `text_color` and `weight` dress the card (YAZ-4906, views.css); a crossed-out card keeps them.
      ...cardStyleAttrs(row.record.properties),
      ...(!locked && {
        draggable: true,
        onDragStart: (e: ReactDragEvent<HTMLElement>) => {
          e.dataTransfer?.setData('text/plain', path)
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
          // A bar's drop shifts by the days from the day it was taken on (YAZ-4858); a card's from its own day.
          const grabbed = place === undefined ? from : dayInBar(e.currentTarget, e.clientX)
          setDrag({ path, row, from: grabbed, base: place === undefined ? real : grabbed })
        },
        onDragEnd: clear,
      }),
      ...hover.itemProps(path),
      onClick: (e: ReactMouseEvent) => open(e, path),
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, path, title: row.record.title, day: from ?? place?.days[0] ?? null, locked })
      },
      onKeyDown: (e: ReactKeyboardEvent) => {
        if (e.target !== e.currentTarget || e.key !== 'Enter') return
        e.preventDefault()
        // The table's Enter keys (YAZ-4605 D56): this tab, ⌘ a background tab, ⌥ the right panel, ⇧ the mini window.
        openByKey(e, path, { onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow })
      },
    }
    const body = (
      <>
        {edges && bar?.cutStart !== true && <span className="view-cal__edge view-cal__edge--start" aria-hidden onMouseDown={startEdge(row, 'start')} onClick={(e) => e.stopPropagation()} />}
        {shown.map((line) => {
          const head = line.some((k) => canonicalKey(k) === 'file.name')
          return (
            <Fragment key={line[0]}>
              <CardLine
                line={line}
                item={item}
                className={head ? ' view-cal__card-head' : ''}
                lead={
                  head && (
                    <>
                      {time !== null && <span className="view-cal__time">{time}</span>}
                      {weekend !== null && (
                        <span className="view-cal__weekend" title={dayLabel(real!)}>
                          {weekend}
                        </span>
                      )}
                    </>
                  )
                }
              />
              {head && moveError?.path === path && (
                <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
                  Move failed
                </span>
              )}
            </Fragment>
          )
        })}
        {edges && bar?.cutEnd !== true && <span className="view-cal__edge view-cal__edge--end" aria-hidden onMouseDown={startEdge(row, 'end')} onClick={(e) => e.stopPropagation()} />}
      </>
    )
    if (place === undefined)
      return (
        <li key={path} {...props}>
          {body}
        </li>
      )
    // A bar is a grid item of its week row, over its columns, in its lane (the first rows after the day heads). A drop
    // on it is a drop on the day under the pointer.
    const at = (e: ReactDragEvent<HTMLElement>) => dayInBar(e.currentTarget, e.clientX)
    return (
      <div
        key={`${path}@${place.days[0]}`}
        {...props}
        style={{ gridColumn: `${place.bar.col + 1} / span ${place.bar.cols}`, gridRow: place.bar.lane + 2 } as CSSProperties}
        data-bar-days={place.days.join(' ')}
        onDragOver={(e) => target(at(e)).onDragOver(e)}
        onDrop={(e) => target(at(e)).onDrop(e)}
      >
        {body}
      </div>
    )
  }

  /**
   * The card menu's groups: the note items, then "Card style ›" (YAZ-4906) when the pane writes styles and the note is
   * not read-only. The panel's ✓ marks are the card's style NOW (the rows, optimistic), so a strength after a colour
   * keeps that colour.
   */
  const menuItems = (m: NonNullable<typeof menu>) => {
    const items = cardMenuItems(noteDoors, m.path, () => setMenu(null), m.day === null || onNewOnDay === undefined ? undefined : { label: 'New note on this day', run: () => onNewOnDay(m.day!) })
    if (onStyle === undefined || m.locked) return items
    const properties = rows.find((r) => r.record.path === m.path)?.record.properties ?? {}
    return { ...items, extra: [...(items.extra ?? []), <CardStyleFlyout key="style" properties={properties} onPick={(writes) => onStyle(m.path, writes)} />] }
  }
  const shownHead = shownHeaderRow(view)
  /** ⌘Z / ⇧⌘Z on a card (YAZ-4906): the page's value history, as the table reads them; a field keeps its own keys. */
  const onUndoKey = (e: ReactKeyboardEvent) => {
    if (history === undefined || e.key.toLowerCase() !== 'z' || !e.metaKey || e.altKey || e.ctrlKey) return
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') !== null) return
    if (e.shiftKey ? history.redo() : history.undo()) e.preventDefault()
  }
  return (
    <div ref={rootRef} className={`view-cal${resize === null ? '' : ' view-cal--resizing'}`} onKeyDown={onUndoKey}>
      <div className="view-cal__nav">
        {/* The title alone at the left, the controls at the right (YAZ-3746 13M): views.css gives the title the room between. */}
        <h3 className="view-cal__month">{title}</h3>
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
      </div>
      <div className={`view-cal__grid${isWeek ? ' view-cal__grid--week' : ''}${hideWeekends ? ' view-cal__grid--weekdays' : ''}`} role="grid" aria-label={title} style={gridLines(view)}>
        {/* The day names wear the header row's look (YAZ-4864 round 3): the view's `headerRow` over Settings › Tables, as the folder table's; a right-click styles it. */}
        <div
          className="view-cal__week"
          role="row"
          style={headerRowVars(shownHeaderRow(view))}
          onContextMenu={
            onHeaderRow === undefined
              ? undefined
              : (e) => {
                  e.preventDefault()
                  setHeadMenu({ x: e.clientX, y: e.clientY })
                }
          }
        >
          {/* Hide weekends drops Sat and Sun whichever day starts the week (YAZ-4595 S33, YAZ-4585). */}
          {(hideWeekends ? WORKDAYS : sundayFirst ? SUNDAY_FIRST : WEEKDAYS).map((d) => (
            <span key={d} className="view-cal__weekday" role="columnheader">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week, w) => {
          const layout = layouts[w]
          // Week shows every lane; Month at most DAY_CARDS, and every lane while one of its days is open (YAZ-4858).
          const open = week.some((day) => expanded === day || revealed === day)
          const lanes = isWeek || open ? layout.lanes : Math.min(layout.lanes, DAY_CARDS)
          return (
            <div key={week[0]} className="view-cal__week view-cal__week--days" role="row" style={{ gridTemplateRows: `auto${lanes > 0 ? ` repeat(${lanes}, auto)` : ''} 1fr` }}>
              {week.map((day, c) => {
                const list = dayCards.get(day) ?? []
                // Open by its "+N more", or while the mini window is on one of its hidden cards (13J).
                const all = expanded === day || revealed === day
                const budget = budgets.get(day) ?? { cards: DAY_CARDS, hiddenBars: 0 }
                // Week shows every card (D22); Month shows the room the day's bars leave of DAY_CARDS, and "+N more".
                const shown = isWeek || all ? list : list.slice(0, budget.cards)
                const folded = list.length - Math.min(list.length, budget.cards) + budget.hiddenBars
                const more = all ? 0 : folded - (lanes > DAY_CARDS ? budget.hiddenBars : 0)
                const inMonth = isWeek || Number(day.slice(5, 7)) === month.m + 1
                return (
                  <div
                    key={day}
                    role="gridcell"
                    data-day={day}
                    aria-current={day === today ? 'date' : undefined}
                    className={`view-cal__day${inMonth ? '' : ' view-cal__day--other'}${day === today ? ' view-cal__day--today' : ''}${over === day ? ' view-cal__day--drop' : ''}`}
                    style={{ gridColumn: c + 1 }}
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
                    <div className="view-cal__day-body">
                      {shown.length > 0 && <ul className="view-cal__cards">{shown.map((row) => card(row, day))}</ul>}
                      {!isWeek && (all ? folded > 0 : more > 0) && (
                        <button
                          type="button"
                          className="view-cal__more"
                          onClick={() => {
                            setExpanded(all ? null : day)
                            // "Show less" on a day the mini window opened folds it until the window's next step (13J).
                            if (all) setRevealed(null)
                          }}
                        >
                          {/* A narrow day shows "+3" (YAZ-4544): views.css hides the word. */}
                          {all ? 'Show less' : <>+{more}<span className="view-cal__more-word"> more</span></>}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {layout.bars.filter((bar) => bar.lane < lanes).map((bar) => card(bar.span.row, null, { bar, days: week.slice(bar.col, bar.col + bar.cols) }))}
            </div>
          )
        })}
      </div>
      <section className={`view-cal__tray${over === NO_DATE ? ' view-cal__tray--drop' : ''}`} aria-label="No date" {...target(null)}>
        <h4 className="view-cal__tray-title">
          No date <span className="view-cal__tray-count">{undated.length}</span>
        </h4>
        {undated.length > 0 && <ul className="view-cal__cards view-cal__tray-cards">{(trayOpen ? undated : undated.slice(0, TRAY_CARDS)).map((row) => card(row, null))}</ul>}
        {undated.length > TRAY_CARDS && (
          <button
            type="button"
            className="view-cal__more"
            onClick={() => {
              setTrayAll(!trayOpen)
              if (trayOpen) setRevealed(null)
            }}
          >
            {trayOpen ? 'Show less' : `+${undated.length - TRAY_CARDS} more`}
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
          // A dated card's new note goes on its day (13BO CM2), as the day's "+"; an undated one has none.
          {...menuItems(menu)}
        />
      )}
      {headMenu !== null && onHeaderRow !== undefined && (
        <ContextMenuSurface x={headMenu.x} y={headMenu.y} onClose={() => setHeadMenu(null)}>
          <MenuFlyout.Provider value={headFlyout}>
            <div className="ctx-menu__group" role="group">
              <StyleFlyout
                label="Header row"
                shown={shownHead}
                plainLabel="Plain, like any row"
                plainOn={plainHeaderRow(shownHead)}
                onPlain={() => onHeaderRow(toggleHeaderRowPlain)}
                onPick={(part, value) => onHeaderRow((v) => setHeaderRowPart(v, part, value))}
              />
            </div>
          </MenuFlyout.Provider>
        </ContextMenuSurface>
      )}
      {endAsk !== null && (
        // No End date column (YAZ-4858 item 4): the message at the card, one way on, and nothing written until it is used.
        <Popover label="Stretch a card over days" anchor={endAsk.anchor} onClose={() => setEndAsk(null)} className="view-cal__end-ask">
          <p className="view-cal__end-ask-text">To stretch a card over days, choose an End date column.</p>
          {endChoices.length > 0 ? (
            endAsk.choosing ? (
              <select
                className="view-select"
                aria-label="End date"
                autoFocus
                value=""
                onChange={(e) => {
                  if (e.target.value === '') return
                  onChooseEnd?.(e.target.value)
                  setEndAsk(null)
                }}
              >
                <option value="">Choose a column…</option>
                {endChoices.map((key) => (
                  <option key={key} value={key}>
                    {propertyLabel(def, key)}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" className="view-menu__action" onClick={() => setEndAsk({ ...endAsk, choosing: true })}>
                Choose End date
              </button>
            )
          ) : (
            onAddEndColumn !== undefined && (
              <button
                type="button"
                className="view-menu__action"
                onClick={() => {
                  onAddEndColumn()
                  setEndAsk(null)
                }}
              >
                Add a date column
              </button>
            )
          )}
        </Popover>
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

/** "Start date", once "Show by" (D4, YAZ-4858): every date column of the folder, one per calendar tab; in the View tab's Calendar section (YAZ-3746 13AD). */
export function CalendarShowBy({ def, view, viewIndex, columns, onUpdate }: CalendarShowByProps) {
  const current = calendarStartColumn(view, columns)
  if (current === undefined) return null
  const options = columns.includes(current) ? columns : [current, ...columns]
  return (
    <select
      className="view-select"
      aria-label="Start date"
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

/** "End date" (YAZ-4858): None, or a date column other than the start; one per calendar tab. None deletes the key. */
export function CalendarEndBy({ def, view, viewIndex, columns, onUpdate }: CalendarShowByProps) {
  const start = calendarStartColumn(view, columns)
  const current = typeof view.endDateProperty === 'string' ? view.endDateProperty : ''
  const others = columns.filter((k) => k !== start)
  const options = current === '' || others.includes(current) ? others : [current, ...others]
  return (
    <select
      className="view-select"
      aria-label="End date"
      value={current}
      onChange={(e) =>
        onUpdate((d) => {
          if (e.target.value === '') delete d.views[viewIndex].endDateProperty
          else d.views[viewIndex].endDateProperty = e.target.value
        })
      }
    >
      <option value="">None</option>
      {options.map((key) => (
        <option key={key} value={key}>
          {propertyLabel(def, key)}
        </option>
      ))}
    </select>
  )
}
