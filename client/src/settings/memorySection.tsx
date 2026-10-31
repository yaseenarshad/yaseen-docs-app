/**
 * SETTINGS › MEMORY (YAZ-3737 D9, D10): which window is big, and what it has open, in one look. A reference page
 * like Storage, just above it in the nav. Quiet: no badge, no button beyond the two settings.
 *
 *   Writing     2 notes, 1 drawing   ▓▓▓▓▓▓▓▓░░   812.4 MB ▲
 *   Research    1 note               ▓▓▓░░░░░░░   301.0 MB
 *   App core                         ▓▓▓▓░░░░░░   390.2 MB
 *   Code helpers                     ▓▓▓▓▓▓░░░░   610.7 MB      (only while a helper runs)
 *
 * Windows in the order they opened (main's order), so a row never moves under the pointer. The biggest row fills its bar. ▲ = it grew more than 150 MB or 20 % in the last hour (main decides). Hover: a
 * window's JS heap and the rest, App core's parts, the helper count. A click on a window row brings that window
 * to the front; App core and Code helpers do nothing. The report comes from main (`memory.report`) while the page
 * shows (`useMemoryReport`).
 *
 * The two settings below the rows belong to tab sleep (5A) and the window reload (6); this page owns their place.
 */
import type { MemoryReport } from '@shared/types'
import { api } from '../api'
import { formatBytes } from '../lib/format'
import { Segmented } from './controls'
import { ON_OFF_OPTIONS, TAB_SLEEP_AFTER_OPTIONS } from './options'
import type { SettingsSection } from './registry'
import { useMemoryReport } from './useMemoryReport'

interface Row {
  key: string
  name: string
  open: string
  bytes: number
  hint?: string
  grew?: boolean
  /** A window row: the click brings it to the front. */
  show?: () => void
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
      show: () => void api.window.showWindow(w.id).catch(() => undefined),
    })),
    { key: 'core', name: 'App core', open: '', bytes: core.bytes, hint: `Main ${formatBytes(core.main)} · GPU ${formatBytes(core.gpu)} · Utility ${formatBytes(core.utility)} · Other ${formatBytes(core.other)}` },
    ...(helpers === null ? [] : [{ key: 'helpers', name: 'Code helpers', open: '', bytes: helpers.bytes, hint: `${helpers.count} ${helpers.count === 1 ? 'helper' : 'helpers'}` }]),
  ]
}

/** One row's cells: name · what it has open · bar · size · ▲. */
function Cells({ row, max }: { row: Row; max: number }) {
  return (
    <>
      <span className="memory__name">{row.name}</span>
      <span className="memory__open">{row.open}</span>
      <span className="storage__bar memory__bar" aria-hidden="true">
        <span className="storage__fill" style={{ width: `${Math.max(1, (row.bytes / max) * 100)}%` }} />
      </span>
      <span className="memory__size">{formatBytes(row.bytes)}</span>
      <span className="memory__grew" title={row.grew === true ? 'Grew more than 150 MB or 20 % in the last hour' : undefined}>
        {row.grew === true ? '▲' : ''}
      </span>
    </>
  )
}

function MemoryRows() {
  const report = useMemoryReport()
  if (report === null) return <p className="storage__muted">Measuring…</p>
  const rows = rowsOf(report)
  const max = Math.max(1, ...rows.map((r) => r.bytes))
  return (
    <ul className="memory__rows">
      {rows.map((row) => (
        <li key={row.key} data-memory-row={row.key}>
          {row.show !== undefined ? (
            <button type="button" className="memory__row memory__row--window" title={row.hint} onClick={row.show}>
              <Cells row={row} max={max} />
            </button>
          ) : (
            <div className="memory__row" title={row.hint}>
              <Cells row={row} max={max} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export const MEMORY_SECTION: SettingsSection = {
  id: 'memory',
  title: 'Memory',
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
