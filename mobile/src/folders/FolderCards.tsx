import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { propertyLabel, type Group, type Row } from '@client/views/engine'
import { cellText } from '@client/views/exportView'
import { isFolderRow } from '@client/links/folderRows'
import { bucketByDay, calendarDateKey, calendarEndKey, dateColumns, todayKey, type DayKey } from '@client/views/calendar'
import { canonicalKey } from '@client/views/view/keys'
import { useApp } from '../app/AppState'
// A folder page's row is tapped INSIDE a page (`from: 'inside'`): an Explore panel when the vault says explore.
import { openFile } from '../explore/openFile'
import { rowTarget, type ViewRun } from './folderModel'
import { MODES, MONTHS, agendaDays, emptyText, modeOf, periodOf, periodTitle, periodUnit, rollingMonth, rollingTarget, stepAnchor, type CalendarMode } from './calendarNav'

/**
 * A FOLDER'S CARDS, BOARD AND CALENDAR ON THE PHONE, read only. The Mac's engine ran the view (its rows,
 * filter, sort, groups, the fields each card shows); the phone draws each one for a narrow screen:
 *  - CARDS: one card under another (the Mac's grid of cards is a column on a phone), the title, then each field
 *    with its label (the view's `cardStyle`: a hidden label, a bold value), an empty field left out.
 *  - BOARD: the Mac's columns side by side, each most of the screen's width so the next one peeks in; the row of
 *    columns scrolls sideways and stops at each column (scroll snap), each column's cards scroll with the page.
 *  - CALENDAR: an AGENDA, not the Mac's month grid: seven columns of 50 px cannot show a title. The days that have
 *    pages, in order under their month, today marked, a page over several days on its first day with its range;
 *    then "No date", as the Mac's tray. YAZ-5597: the Mac's header over it (the period's title, ‹ ›, Today) and a
 *    Month / Week / Rolling switch that picks which days the list holds, so a far month is one tap away.
 * A tap on a card opens its page through the one file door, as on the Mac.
 */

/** One card: its title, then the view's fields. */
function Card({ row, run, keys }: { row: Row; run: ViewRun; keys: readonly string[] }) {
  const app = useApp()
  const style = run.view.cardStyle ?? {}
  const fields = keys.flatMap((key) => {
    const text = cellText(row, key, run.ctx)
    if (text === '') return []
    const own = Object.entries(style).find(([k]) => canonicalKey(k) === canonicalKey(key))?.[1]
    return [{ key, label: own?.hideLabel === true ? null : propertyLabel(run.def, key), text, bold: own?.bold === true }]
  })
  return (
    <button type="button" className={`folder-card${row.crossed === true ? ' folder-card--crossed' : ''}`} onClick={() => openFile(app, rowTarget(row), { from: 'inside' })}>
      <span className="folder-card__title">
        {isFolderRow(row.record) && <span className="file-icon" data-kind="folder" aria-hidden />}
        {row.record.title}
        {/* YAZ-5549: a subfolder's "N inside", as the Mac's row title in every view. */}
        {isFolderRow(row.record) && run.inside !== null && <span className="folder-inside">{run.inside(row)} inside</span>}
      </span>
      {fields.map((f) => (
        <span key={f.key} className="folder-card__field">
          {f.label !== null && <span className="folder-card__label">{f.label}</span>}
          <span className={f.bold ? 'folder-card__value folder-card__value--bold' : 'folder-card__value'}>{f.text}</span>
        </span>
      ))}
    </button>
  )
}

/** The fields a card shows: the view's columns but its name (the card's title). */
const fieldsOf = (run: ViewRun) => run.keys.filter((k) => canonicalKey(k) !== 'file.name')

export function FolderCards({ run }: { run: ViewRun }) {
  const keys = fieldsOf(run)
  return (
    <div className="folder-cards">
      {run.rows.map((row, i) => (
        <Card key={`${row.record.path}\n${i}`} row={row} run={run} keys={keys} />
      ))}
    </div>
  )
}

/** A board's columns: the view's first group level (each column holds all of a group's rows), or one column of all. */
export function boardColumns(run: ViewRun): { label: string; rows: Row[] }[] {
  const groups: readonly Group[] | null = run.groups
  if (groups === null) return [{ label: run.view.name, rows: run.result.rows }]
  return groups.filter((g) => g.rows.length > 0 || run.view.showEmptyColumns === true).map((g) => ({ label: g.label, rows: g.rows }))
}

export function FolderBoard({ run }: { run: ViewRun }) {
  const keys = fieldsOf(run)
  const columns = boardColumns(run)
  return (
    <div className="folder-board" role="list" aria-label={run.view.name}>
      {columns.map((col, c) => (
        <section key={`${col.label}\n${c}`} className="folder-board__column" role="listitem" aria-label={col.label}>
          <h3 className="folder-board__head">
            {col.label} <span className="folder-board__count">{col.rows.length}</span>
          </h3>
          {col.rows.length === 0 && <p className="folder-board__empty">No pages</p>}
          {col.rows.map((row, i) => (
            <Card key={`${row.record.path}\n${i}`} row={row} run={run} keys={keys} />
          ))}
        </section>
      ))}
    </div>
  )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dateOf = (day: DayKey) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
const dayWords = (day: DayKey) => {
  const d = dateOf(day)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

/** The calendar's rows by day (the Mac's `bucketByDay` on the view's date and End date columns), once per run. */
export function bucketsOf(run: ViewRun): { key: string | null } & ReturnType<typeof bucketByDay> {
  const columns = dateColumns(run.def, run.view, run.input, null, run.settings)
  const key = calendarDateKey(run.view, columns, run.settings.columns)
  const endKey = calendarEndKey(run.view, key, run.settings.columns)
  return { key, ...bucketByDay(run.result.rows, key, endKey) }
}

/** The nearest ancestor that scrolls up and down (the screen, or a sheet's body), else the document's. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

/**
 * Scrolls so `el`'s top sits just under the header (`nav`) where it sticks, else at the top of what scrolls. The
 * header's place is counted as stuck (the scroller's padding edge plus its `top`), not where it is before the scroll.
 */
function scrollUnder(el: HTMLElement, nav: HTMLElement | null) {
  const scroller = scrollerOf(el)
  const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
  const line = nav === null ? top : top + (parseFloat(getComputedStyle(scroller).paddingTop) || 0) + (parseFloat(getComputedStyle(nav).top) || 0) + nav.offsetHeight
  scroller.scrollTop += el.getBoundingClientRect().top - line - 4
}

/**
 * The calendar's header (YAZ-5597), the Mac's in its order and words: the period's title, ‹ and › (a period back or
 * on), Today, then the Month / Week / Rolling switch. It sticks at the top of the list, so the arrows are in reach
 * anywhere in a long month. Each control a 44 pt target; the title and the arrows share a row, the switch is the row
 * under it (the title takes its own row when a long week's title must wrap).
 */
function CalendarHeader(props: { mode: CalendarMode; title: string; canBack: boolean; canOn: boolean; onStep: (by: number) => void; onToday: () => void; onMode: (mode: CalendarMode) => void; navRef: RefObject<HTMLDivElement | null> }) {
  const { mode, title, canBack, canOn, onStep, onToday, onMode, navRef } = props
  const unit = periodUnit(mode)
  return (
    <div className="folder-cal__nav" ref={navRef}>
      <h3 className="folder-cal__title" aria-live="polite">{title}</h3>
      <div className="folder-cal__steps">
        <button type="button" className="btn folder-cal__step" aria-label={`Previous ${unit}`} disabled={!canBack} onClick={() => onStep(-1)}>
          ‹
        </button>
        <button type="button" className="btn folder-cal__step" aria-label={`Next ${unit}`} disabled={!canOn} onClick={() => onStep(1)}>
          ›
        </button>
        <button type="button" className="btn folder-cal__today" onClick={onToday}>
          Today
        </button>
      </div>
      <div className="folder-cal__modes" role="group" aria-label="Calendar scale">
        {MODES.map(([value, text]) => (
          <button key={value} type="button" data-mode={value} aria-pressed={mode === value} onClick={() => mode !== value && onMode(value)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * THE CALENDAR (YAZ-5460, YAZ-5597): always the agenda list, the mode picks its days (`calendarNav.ts`). It opens on the
 * view's own scale (the Mac's `calendarScale`: Month unless Week) at the period that holds today; the phone never
 * writes the scale back. Month and Week list their period and say "Nothing in November" when it is empty; Rolling lists
 * every day, opens scrolled to today and its ‹ › go from month heading to month heading. "No date" stays last in every
 * mode. The count over it is the pages the list shows of the view's.
 */
export function FolderCalendar({ run }: { run: ViewRun }) {
  const app = useApp()
  const keys = fieldsOf(run)
  const today = todayKey()
  const sundayFirst = run.sundayFirst
  const [mode, setMode] = useState<CalendarMode>(() => modeOf(run.view.calendarScale))
  // The day whose period shows: today at first, as the Mac's `anchor`; ‹ › move it, Today brings it back.
  const [anchor, setAnchor] = useState<DayKey>(today)
  // Rolling: the month heading in sight under the header (the title, and where ‹ › step from).
  const [seen, setSeen] = useState<string>(today.slice(0, 7))
  // Bumped by each move: the effect then scrolls to the move's place once the list has drawn it.
  const [moved, setMoved] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const buckets = useMemo(() => bucketsOf(run), [run])
  const period = periodOf(mode, anchor, sundayFirst)
  const days = useMemo(() => agendaDays(buckets.days, buckets.multi, period), [buckets, period?.start, period?.end])
  const months = useMemo(() => [...new Set(days.map((d) => d.day.slice(0, 7)))], [days])

  // Rolling opens at today, and each move lands its day under the header; Month and Week bring the list's top back.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    if (mode !== 'rolling') {
      // The header stuck below the list's top: the list was scrolled down, so the new period starts at its top.
      const nav = navRef.current
      if (moved > 0 && nav !== null && nav.getBoundingClientRect().top > root.getBoundingClientRect().top + 50) scrollUnder(root, null)
      return
    }
    const day = rollingTarget(days.map((d) => d.day), anchor)
    const el = day === null ? null : root.querySelector<HTMLElement>(`[data-day="${day}"]`)
    if (el === null) return
    // The day's month heading when it is the month's first listed day, so the month shows with it.
    const block = el.closest<HTMLElement>('.folder-agenda__block')
    scrollUnder(block?.querySelector('.folder-agenda__month') !== null && block !== null ? block : el, navRef.current)
    setSeen(day!.slice(0, 7))
  }, [mode, moved])

  // Rolling's title follows the scroll: the last month heading at or above the header's bottom.
  useEffect(() => {
    if (mode !== 'rolling') return
    let frame = 0
    const look = () => {
      frame = 0
      const root = rootRef.current
      if (root === null) return
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 8
      const heads = [...root.querySelectorAll<HTMLElement>('.folder-agenda__month[data-month]')]
      if (heads.length === 0) return
      const above = heads.filter((h) => h.getBoundingClientRect().top <= line).at(-1) ?? heads[0]
      const month = above.dataset.month!
      setSeen((m) => (m === month ? m : month))
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(look)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [mode])

  const count = (n: number) => (run.cards ? (n === 1 ? 'card' : 'cards') : app.unit(n === 1 ? 'page' : 'pages'))
  const total = run.result.total - run.result.folders
  if (buckets.key === null)
    return (
      <>
        <p className="folder-view__count">{`${total} ${count(total)}`}</p>
        <p className="muted folder-view__none">This calendar has no date column.</p>
      </>
    )

  const go = (day: DayKey) => {
    setAnchor(day)
    setMoved((n) => n + 1)
  }
  const back = mode === 'rolling' ? rollingMonth(months, seen, -1) : null
  const on = mode === 'rolling' ? rollingMonth(months, seen, 1) : null
  const step = (by: number) => {
    if (mode !== 'rolling') return go(stepAnchor(mode, anchor, by))
    const month = by < 0 ? back : on
    if (month !== null) go(`${month}-01`)
  }
  const pickMode = (next: CalendarMode) => {
    // The switch keeps the place, as the Mac's: Rolling from Month or Week lands on the period's first day.
    if (next === 'rolling' && mode !== 'rolling' && period !== null) setAnchor(period.start <= today && today <= period.end ? today : period.start)
    setMode(next)
    setMoved((n) => n + 1)
  }
  const title = mode === 'rolling' ? periodTitle(mode, `${seen}-01`, sundayFirst) : periodTitle(mode, anchor, sundayFirst)
  const shown = new Set([...days.flatMap((d) => d.rows.map((r) => r.row)), ...buckets.undated].filter((r) => !isFolderRow(r.record)).map((r) => r.record.path)).size
  const counted = mode === 'rolling' ? `${total} ${count(total)}` : `${shown} of ${total} ${count(total)}`

  let month = ''
  return (
    <div className="folder-agenda" ref={rootRef} data-mode={mode}>
      <p className="folder-view__count">{counted}</p>
      <CalendarHeader mode={mode} title={title} canBack={mode !== 'rolling' || back !== null} canOn={mode !== 'rolling' || on !== null} onStep={step} onToday={() => go(today)} onMode={pickMode} navRef={navRef} />
      {days.length === 0 && <p className="muted folder-view__none">{emptyText(mode, anchor, today, sundayFirst)}</p>}
      {days.map(({ day, rows }) => {
        const m = day.slice(0, 7)
        const head = m !== month ? `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}` : null
        month = m
        return (
          <div key={day} className="folder-agenda__block">
            {head !== null && (
              <h3 className="folder-agenda__month" data-month={m}>
                {head}
              </h3>
            )}
            <div className={`folder-agenda__day${day === today ? ' folder-agenda__day--today' : ''}`} data-day={day}>
              <p className="folder-agenda__date">
                <span className="folder-agenda__day-name">{dayWords(day)}</span>
                {day === today && <span className="folder-agenda__today"> · Today</span>}
              </p>
              <div className="folder-agenda__cards">
                {rows.map(({ row, from, until }, i) => (
                  <div key={`${row.record.path}\n${i}`} className="folder-agenda__item">
                    <Card row={row} run={run} keys={keys} />
                    {until !== undefined && (
                      <span className="folder-agenda__until">
                        {from !== undefined && `since ${dayWords(from)}, `}until {dayWords(until)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
      {buckets.undated.length > 0 && (
        <div className="folder-agenda__block">
          <h3 className="folder-agenda__month">No date</h3>
          <div className="folder-agenda__cards">
            {buckets.undated.map((row, i) => (
              <Card key={`${row.record.path}\n${i}`} row={row} run={run} keys={keys} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
