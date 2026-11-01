/**
 * SETTINGS › MEMORY (YAZ-3737 D9, D10): which window is big, and what it has open, in one look. A reference page
 * like Storage, just above it in the nav. Quiet: no badge; the only buttons are the window rows, the ⓘ marks and the
 * two settings.
 *
 * A table, read like a spreadsheet (YAZ-3945): headers Tab · State · Last seen · Changed · RAM (YAZ-3977: each size is
 * RAM). The line under the title says the app frees memory by itself (YAZ-3977).
 *
 *   Tab                          State                    Last seen   Changed     Memory
 *   ▾ Writing ⓘ  Growing                                                         ▓▓▓▓▓▓░  812.4 MB
 *       00 START HERE            In view                              5 min ago
 *       Plan                     Awake · sleeps in 12 min 18 min ago  Yesterday
 *       Draft                    Awake · not saved yet    2 min ago   now
 *       Ideas                    Asleep zzz               2 h ago     Oct 20         (dimmed: asleep)
 *   ▸ Research ⓘ                                                                  ▓▓░░░░░  301.0 MB
 *     App core ⓘ                                                                  ▓▓▓░░░░  390.2 MB
 *     Code helpers ⓘ                                                              ▓▓▓▓░░░  610.7 MB  (only while a helper runs)
 *
 * Windows in the order they opened (main's order), so a row never moves under the pointer. A window's name runs across
 * Tab to Last seen and ends with "…" before Changed (YAZ-3958; the full name on hover); the page never scrolls sideways. The
 * biggest row fills its bar. "Growing" (YAZ-3933, the app's orange) = it grew more than 150 MB or 20 % in the last
 * hour (main decides); the window ⓘ says so too (YAZ-3987). Each kind of row has its own ⓘ (YAZ-3932, round 2), on hover and on keyboard focus. Hover on a
 * name: what a window has open; on a size: a window's JS heap and the rest, App core's parts, the helper count.
 *
 * A click on a window row opens (▾) or closes (▸) its tab rows (YAZ-3934): the tabs that hold memory first, then the
 * asleep ones (with the tab bar's zzz) and the not-loaded ones, dimmed, strip order kept in each group. Each tab row (YAZ-3946) shows its title as the tab bar
 * shows it, its state ("In view", "Awake · sleeps in N min", "Awake · not saved yet", "Not loaded", "Awake", "Asleep";
 * the State header's ⓘ says each, YAZ-3958), when it was
 * last seen and when its file last changed. Its Memory cell is empty: all the tabs of a window share one heap, so a
 * number would be a guess. A window that did not answer main's tabs ask shows its stored tabs with empty facts. A
 * window with no tab, App core and Code helpers do not open. The report comes from main (`memory.report`) while the
 * page shows (`useMemoryReport`), and the open rows and the countdown follow it.
 *
 * The two settings below the table belong to tab sleep (5A) and the window reload (6); this page owns their place.
 */
import { useId, useState } from 'react'
import type { MemoryReport, MemoryTabRow } from '@shared/types'
import { formatBytes } from '../lib/format'
import { pageLabel } from '../lib/pageLabel'
import { AsleepIcon } from '../views/view/icons'
import { Segmented } from './controls'
import { ON_OFF_OPTIONS, TAB_SLEEP_AFTER_OPTIONS } from './options'
import type { SettingsSection } from './registry'
import { useMemoryReport } from './useMemoryReport'

/** The ⓘ of each kind of row (YAZ-3932, round 2), as Yasin approved them. */
const INFO = {
  window: 'This is one window. The bar shows the memory it uses now. Open it to see its tabs. An asleep tab uses almost no memory. "Growing": it grew more than 150 MB or 20 % in the last hour. You do not need to do anything.',
  core: 'The parts of the app that all windows share: Main (it controls the app), GPU (it draws the screen) and Utility (small helpers). Closing tabs does not make this smaller.',
  helpers: 'These run only while code files are open. They stop 2 minutes after you close the last one.',
} as const

/** The State header's ⓘ (YAZ-3958): one line for each state a tab row can show. */
const STATES_INFO = [
  'In view: the tab you look at now. It never sleeps.',
  'Awake · sleeps in N min: it uses memory. It sleeps in N minutes.',
  'Awake · not saved yet: it has typing that is not saved yet. It sleeps after the save.',
  'Asleep: it uses almost no memory. A click wakes it.',
  'Not loaded: you have not opened it since the app started. It uses almost no memory.',
  'Awake: Sleep is set to Never, so it does not sleep.',
].join('\n')

/** A row's ⓘ (YAZ-3932): its line shows while the pointer is on it or it has the focus. */
function Info({ text, label = 'What this row means' }: { text: string; label?: string }) {
  const [shown, setShown] = useState(false)
  const tip = useId()
  return (
    <span className="memory__info" onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
      {/* A click on the ⓘ does not open or close its row. */}
      <button type="button" className="memory__info-btn" aria-label={label} aria-describedby={tip} onClick={(e) => e.stopPropagation()} onFocus={() => setShown(true)} onBlur={() => setShown(false)}>
        ⓘ
      </button>
      <span id={tip} role="tooltip" className="memory__tip" hidden={!shown}>
        {text}
      </span>
    </span>
  )
}

interface Row {
  key: string
  name: string
  /** A window's "2 notes, 1 drawing": the name's hover. */
  open?: string
  bytes: number
  hint?: string
  grew?: boolean
  info: string
  /** A window row's tabs: the click opens their rows (YAZ-3934). */
  tabs?: MemoryTabRow[]
}

function rowsOf(report: MemoryReport): Row[] {
  const { core, helpers } = report
  return [
    ...report.windows.map((w) => ({
      key: w.id,
      name: w.title,
      open: w.open,
      bytes: w.bytes,
      ...(w.jsHeapBytes === null ? {} : { hint: `JS heap ${formatBytes(w.jsHeapBytes)} · Other ${formatBytes(Math.max(0, w.bytes - w.jsHeapBytes))}` }),
      grew: w.grew,
      info: INFO.window,
      tabs: w.tabs,
    })),
    { key: 'core', name: 'App core', bytes: core.bytes, hint: `Main ${formatBytes(core.main)} · GPU ${formatBytes(core.gpu)} · Utility ${formatBytes(core.utility)} · Other ${formatBytes(core.other)}`, info: INFO.core },
    ...(helpers === null ? [] : [{ key: 'helpers', name: 'Code helpers', bytes: helpers.bytes, hint: `${helpers.count} ${helpers.count === 1 ? 'helper' : 'helpers'}`, info: INFO.helpers }]),
  ]
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** A time as Settings › Memory says it (YAZ-3946): "now", "6 min ago", "2 h ago" (under 24 h), "Yesterday", then the date ("Oct 20"; the year only when it is not this year). */
export function agoText(then: number, now: number): string {
  const diff = now - then
  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} h ago`
  const day = new Date(then)
  const today = new Date(now)
  if (day.toDateString() === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toDateString()) return 'Yesterday'
  return day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** A tab's State cell (YAZ-3946); '' when its window did not answer. */
function stateText(tab: MemoryTabRow, now: number): string {
  switch (tab.state) {
    case 'shown':
      return 'In view'
    case 'unloaded':
      return 'Not loaded'
    case 'unsaved':
      return 'Awake · not saved yet'
    case 'asleep':
      return 'Asleep'
    case 'awake':
      // The rounds run once a minute, so a tab due now sleeps within the minute.
      return tab.sleepsAt === null ? 'Awake' : `Awake · sleeps in ${Math.max(1, Math.ceil((tab.sleepsAt - now) / MINUTE))} min`
    default:
      return ''
  }
}

/** No titles here: Settings has no index, so a tab whose window did not answer shows its file name. */
const NO_TITLES = new Map<string, string>()

/** A tab that holds almost no memory (YAZ-3958): asleep, or not loaded. Its row goes below and is dimmed. */
const idle = (t: MemoryTabRow) => t.state === 'asleep' || t.state === 'unloaded'

/** A window's tab rows (YAZ-3934, YAZ-3946): the tabs that hold memory first, then the idle ones, each group in strip order. */
function TabRows({ tabs }: { tabs: MemoryTabRow[] }) {
  const now = Date.now()
  const ordered = [...tabs.filter((t) => !idle(t)), ...tabs.filter(idle)]
  return ordered.map((t, i) => {
    const state = stateText(t, now)
    return (
      <tr key={i} className={idle(t) ? 'memory__tab memory__tab--asleep' : 'memory__tab'}>
        <td className="memory__tab-name">{t.title ?? pageLabel(t.path, false, NO_TITLES)}</td>
        <td title={state}>
          {state}
          {t.state === 'asleep' && <AsleepIcon className="memory__asleep" title="Asleep: it uses almost no memory." />}
        </td>
        <td>{t.lastSeen === null ? '' : agoText(t.lastSeen, now)}</td>
        <td>{t.changed === null ? '' : agoText(t.changed, now)}</td>
        <td />
      </tr>
    )
  })
}

function MemoryRows() {
  const report = useMemoryReport()
  /** The window rows open now, by window id; the page's life long. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  if (report === null) return <p className="storage__muted">Measuring…</p>
  const rows = rowsOf(report)
  const max = Math.max(1, ...rows.map((r) => r.bytes))
  const toggle = (key: string) =>
    setOpened((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })
  return (
    <table className="memory__table">
      <colgroup>
        <col />
        <col className="memory__col-state" />
        <col className="memory__col-time" />
        <col className="memory__col-time" />
        <col className="memory__col-memory" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Tab</th>
          <th scope="col" className="memory__state-head">
            State <Info text={STATES_INFO} label="What each state means" />
          </th>
          <th scope="col">Last seen</th>
          <th scope="col">Changed</th>
          <th scope="col">RAM</th>
        </tr>
      </thead>
      {rows.map((row) => {
        const opens = row.tabs !== undefined && row.tabs.length > 0
        const expanded = opens && opened.has(row.key)
        const name = (
          <>
            <span className="memory__arrow" aria-hidden="true">
              {opens ? (expanded ? '▾' : '▸') : ''}
            </span>
            <span className="memory__name" title={row.open === undefined || row.open === '' ? row.name : `${row.name}\n${row.open}`}>
              {row.name}
            </span>
          </>
        )
        return (
          <tbody key={row.key} data-memory-row={row.key}>
            <tr className={opens ? 'memory__row memory__row--window' : 'memory__row'} onClick={opens ? () => toggle(row.key) : undefined}>
              <td colSpan={3} className="memory__head">
                <span className="memory__head-line">
                  {opens ? (
                    // The row's click opens it; this button is its keyboard door (Enter and Space click it).
                    <button type="button" className="memory__toggle" aria-expanded={expanded}>
                      {name}
                    </button>
                  ) : (
                    <span className="memory__toggle">{name}</span>
                  )}
                  <Info text={row.info} />
                  {row.grew === true && (
                    <span className="memory__grew" title="Grew more than 150 MB or 20 % in the last hour.">
                      Growing
                    </span>
                  )}
                </span>
              </td>
              <td />
              <td title={row.hint}>
                <span className="memory__memory">
                  <span className="storage__bar memory__bar" aria-hidden="true">
                    <span className="storage__fill" style={{ width: `${Math.max(1, (row.bytes / max) * 100)}%` }} />
                  </span>
                  <span className="memory__size">{formatBytes(row.bytes)}</span>
                </span>
              </td>
            </tr>
            {expanded && <TabRows tabs={row.tabs!} />}
          </tbody>
        )
      })}
    </table>
  )
}

export const MEMORY_SECTION: SettingsSection = {
  id: 'memory',
  title: 'Memory',
  // The work is the core's, not this page's (YAZ-3977): it says so, and that each size is RAM (the RAM column).
  note: 'The app frees memory by itself. A tab that you do not use goes to sleep. A window that gets too big reloads. You do not need to do anything here.',
  standalone: true,
  groups: [
    {
      items: [{ id: 'memoryWindows', label: 'Memory of each window', keywords: ['memory', 'ram', 'mb', 'gb', 'window', 'heap', 'app core', 'code helpers', 'big', 'slow'], bare: true, render: () => <MemoryRows /> }],
    },
    {
      title: 'Save memory',
      items: [
        {
          id: 'tabSleepAfter',
          label: 'Sleep unseen tabs after',
          hint: 'A sleeping tab frees its memory. A click wakes it.',
          keywords: ['memory', 'sleep', 'tab', 'idle', 'unload', 'minutes'],
          render: ({ settings, onChange }) => <Segmented options={TAB_SLEEP_AFTER_OPTIONS} value={settings.tabSleepAfter} onChange={(tabSleepAfter) => onChange({ ...settings, tabSleepAfter })} ariaLabel="Sleep unseen tabs after" />,
        },
        {
          id: 'memoryReload',
          label: 'Reload a window that holds too much memory',
          hint: 'Only a window in the background that stays over 1.5 GB. Its tabs and typing are kept.',
          keywords: ['memory', 'reload', 'window', 'free', 'gb'],
          render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.memoryReload} onChange={(memoryReload) => onChange({ ...settings, memoryReload })} ariaLabel="Reload a window that holds too much memory" />,
        },
      ],
    },
  ],
}
