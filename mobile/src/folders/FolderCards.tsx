import { useMemo, useState } from 'react'
import { propertyLabel, type Group, type Row } from '@client/views/engine'
import { cellText } from '@client/views/exportView'
import { isFolderRow } from '@client/links/folderRows'
import { bucketByDay, calendarDateKey, calendarEndKey, dateColumns, todayKey, type DayKey } from '@client/views/calendar'
import { canonicalKey } from '@client/views/view/keys'
import { useApp } from '../app/AppState'
// A folder page's row is tapped INSIDE a page (`from: 'inside'`): an Explore panel when the vault says explore.
import { openFile } from '../explore/openFile'
import { rowTarget, type ViewRun } from './folderModel'

/**
 * A FOLDER'S CARDS, BOARD AND CALENDAR ON THE PHONE, read only. The Mac's engine ran the view (its rows,
 * filter, sort, groups, the fields each card shows); the phone draws each one for a narrow screen:
 *  - CARDS: one card under another (the Mac's grid of cards is a column on a phone), the title, then each field
 *    with its label (the view's `cardStyle`: a hidden label, a bold value), an empty field left out.
 *  - BOARD: the Mac's columns side by side, each most of the screen's width so the next one peeks in; the row of
 *    columns scrolls sideways and stops at each column (scroll snap), each column's cards scroll with the page.
 *  - CALENDAR: an AGENDA, not the Mac's month grid: seven columns of 50 px cannot show a title. The days that have
 *    pages, in order under their month, today marked, a page over several days on its first day with its range;
 *    then "No date", as the Mac's tray. It starts at today: the days before it wait behind "Earlier".
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dateOf = (day: DayKey) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
const dayWords = (day: DayKey) => {
  const d = dateOf(day)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

/** The agenda's days: each day with pages, in order, with a page over several days on its first day. */
export function agendaOf(run: ViewRun, records: ViewRun["input"]): { key: string | null; days: { day: DayKey; rows: { row: Row; until?: DayKey }[] }[]; undated: Row[] } {
  const columns = dateColumns(run.def, run.view, records, null, run.settings)
  const key = calendarDateKey(run.view, columns, run.settings.columns)
  const endKey = calendarEndKey(run.view, key, run.settings.columns)
  const { days, multi, undated } = bucketByDay(run.result.rows, key, endKey)
  const all = new Map<DayKey, { row: Row; until?: DayKey }[]>()
  for (const [day, rows] of days) all.set(day, rows.map((row) => ({ row })))
  for (const span of multi) all.set(span.start, [...(all.get(span.start) ?? []), { row: span.row, until: span.end }])
  return { key, days: [...all.keys()].sort().map((day) => ({ day, rows: all.get(day)! })), undated }
}

export function FolderCalendar({ run }: { run: ViewRun }) {
  const keys = fieldsOf(run)
  const agenda = useMemo(() => agendaOf(run, run.input), [run])
  const today = todayKey()
  const [earlier, setEarlier] = useState(false)
  if (agenda.key === null) return <p className="muted folder-view__none">This calendar has no date column.</p>
  const past = agenda.days.filter((d) => d.day < today).length
  const days = earlier ? agenda.days : agenda.days.filter((d) => d.day >= today)
  let month = ''
  return (
    <div className="folder-agenda">
      {past > 0 && !earlier && (
        <button type="button" className="btn btn--wide folder-agenda__earlier" onClick={() => setEarlier(true)}>
          Earlier · {past} {past === 1 ? 'day' : 'days'}
        </button>
      )}
      {days.length === 0 && <p className="muted folder-view__none">Nothing from today on.</p>}
      {days.map(({ day, rows }) => {
        const m = day.slice(0, 7)
        const head = m !== month ? `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}` : null
        month = m
        return (
          <div key={day} className="folder-agenda__block">
            {head !== null && <h3 className="folder-agenda__month">{head}</h3>}
            <div className={`folder-agenda__day${day === today ? ' folder-agenda__day--today' : ''}`}>
              <p className="folder-agenda__date">
                {dayWords(day)}
                {day === today && <span className="folder-agenda__today"> · Today</span>}
              </p>
              <div className="folder-agenda__cards">
                {rows.map(({ row, until }, i) => (
                  <div key={`${row.record.path}\n${i}`} className="folder-agenda__item">
                    <Card row={row} run={run} keys={keys} />
                    {until !== undefined && <span className="folder-agenda__until">until {dayWords(until)}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
      {agenda.undated.length > 0 && (
        <div className="folder-agenda__block">
          <h3 className="folder-agenda__month">No date</h3>
          <div className="folder-agenda__cards">
            {agenda.undated.map((row, i) => (
              <Card key={`${row.record.path}\n${i}`} row={row} run={run} keys={keys} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
