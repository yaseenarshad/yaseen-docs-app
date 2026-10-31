/**
 * SETTINGS › MEMORY (YAZ-3737 D9, D10): which window is big, and what it has open, in one look. A reference page
 * like Storage, just above it in the nav. Quiet: no badge; the only buttons are the rows, the ⓘ and the two settings.
 *
 *   Memory ⓘ
 *   ▾ Writing     2 notes, 1 drawing   ▓▓▓▓▓▓▓▓░░   812.4 MB  Growing
 *       Plan
 *       Ideas  zzz                                           (dimmed: asleep)
 *   ▸ Research    1 note               ▓▓▓░░░░░░░   301.0 MB
 *     App core                         ▓▓▓▓░░░░░░   390.2 MB
 *     Code helpers                     ▓▓▓▓▓▓░░░░   610.7 MB           (only while a helper runs)
 *
 * Windows in the order they opened (main's order), so a row never moves under the pointer. The biggest row fills its
 * bar. "Growing" (YAZ-3933, the app's orange) = it grew more than 150 MB or 20 % in the last hour (main decides). The ⓘ
 * (YAZ-3932) says what the rows mean, on hover and on keyboard focus. Hover on a row: a window's JS heap and the rest,
 * App core's parts, the helper count.
 *
 * A click on a window row opens (▾) or closes (▸) the list of its tabs (YAZ-3934): awake tabs first, then the sleeping
 * ones, dimmed with the tab bar's zzz, strip order kept in each group. No size for each tab: all the tabs of a window
 * share one heap, so a number would be a guess. A window with no tab, App core and Code helpers do not open. The report
 * comes from main (`memory.report`) while the page shows (`useMemoryReport`), and an open list follows it.
 *
 * The two settings below the rows belong to tab sleep (5A) and the window reload (6); this page owns their place.
 */
import { useId, useState } from 'react'
import type { MemoryReport, MemoryWindowRow } from '@shared/types'
import { formatBytes } from '../lib/format'
import { pageLabel } from '../lib/pageLabel'
import { AsleepIcon } from '../views/view/icons'
import { Segmented } from './controls'
import { ON_OFF_OPTIONS, TAB_SLEEP_AFTER_OPTIONS } from './options'
import type { SettingsSection } from './registry'
import { useMemoryReport } from './useMemoryReport'

/** The ⓘ's lines (YAZ-3932), as Yasin approved them. */
const INFO = [
  'Each row is one open window. The bar shows the memory it uses now.',
  'App core: the parts of the app that all windows share.',
  'Code helpers: they run only while code files are open.',
  'Growing: the window grew more than 150 MB or 20 % in the last hour.',
  'A sleeping tab (zzz) uses almost no memory. The app cannot measure one note: all the tabs of a window share its memory.',
]

/** The ⓘ next to the title (YAZ-3932): its lines show while the pointer is on it or it has the focus. */
function MemoryInfo() {
  const [shown, setShown] = useState(false)
  const tip = useId()
  return (
    <span className="memory__info" onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
      <button type="button" className="memory__info-btn" aria-label="What the rows mean" aria-describedby={tip} onFocus={() => setShown(true)} onBlur={() => setShown(false)}>
        ⓘ
      </button>
      <span id={tip} role="tooltip" className="memory__tip" hidden={!shown}>
        {INFO.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </span>
  )
}

interface Row {
  key: string
  name: string
  open: string
  bytes: number
  hint?: string
  grew?: boolean
  /** A window row's tabs: the click opens their list (YAZ-3934). */
  tabs?: MemoryWindowRow['tabs']
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
      tabs: w.tabs,
    })),
    { key: 'core', name: 'App core', open: '', bytes: core.bytes, hint: `Main ${formatBytes(core.main)} · GPU ${formatBytes(core.gpu)} · Utility ${formatBytes(core.utility)} · Other ${formatBytes(core.other)}` },
    ...(helpers === null ? [] : [{ key: 'helpers', name: 'Code helpers', open: '', bytes: helpers.bytes, hint: `${helpers.count} ${helpers.count === 1 ? 'helper' : 'helpers'}` }]),
  ]
}

/** One row's cells: ▸/▾ · name · what it has open · bar · size · "Growing". */
function Cells({ row, max, expanded }: { row: Row; max: number; expanded?: boolean }) {
  return (
    <>
      <span className="memory__arrow" aria-hidden="true">
        {expanded === undefined ? '' : expanded ? '▾' : '▸'}
      </span>
      <span className="memory__name">{row.name}</span>
      <span className="memory__open">{row.open}</span>
      <span className="storage__bar memory__bar" aria-hidden="true">
        <span className="storage__fill" style={{ width: `${Math.max(1, (row.bytes / max) * 100)}%` }} />
      </span>
      <span className="memory__size">{formatBytes(row.bytes)}</span>
      <span className="memory__grew" title={row.grew === true ? 'Grew more than 150 MB or 20 % in the last hour.' : undefined}>
        {row.grew === true ? 'Growing' : ''}
      </span>
    </>
  )
}

/** No titles here: Settings has no index, so a tab shows its display name, else its file name. */
const NO_TITLES = new Map<string, string>()

/** A window's tabs (YAZ-3934): awake first, then asleep, each group in strip order. */
function TabList({ tabs }: { tabs: MemoryWindowRow['tabs'] }) {
  const ordered = [...tabs.filter((t) => !t.asleep), ...tabs.filter((t) => t.asleep)]
  return (
    <ul className="memory__tabs">
      {ordered.map((t, i) => (
        <li key={i} className={t.asleep ? 'memory__tab memory__tab--asleep' : 'memory__tab'}>
          <span className="memory__tab-name">{t.name ?? pageLabel(t.path, false, NO_TITLES)}</span>
          {t.asleep && <AsleepIcon className="memory__asleep" title="Asleep: it uses almost no memory." />}
        </li>
      ))}
    </ul>
  )
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
    <ul className="memory__rows">
      {rows.map((row) => {
        const expanded = opened.has(row.key)
        return (
          <li key={row.key} data-memory-row={row.key}>
            {row.tabs !== undefined && row.tabs.length > 0 ? (
              <>
                <button type="button" className="memory__row memory__row--window" title={row.hint} aria-expanded={expanded} onClick={() => toggle(row.key)}>
                  <Cells row={row} max={max} expanded={expanded} />
                </button>
                {expanded && <TabList tabs={row.tabs} />}
              </>
            ) : (
              <div className="memory__row" title={row.hint}>
                <Cells row={row} max={max} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export const MEMORY_SECTION: SettingsSection = {
  id: 'memory',
  title: 'Memory',
  info: <MemoryInfo />,
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
