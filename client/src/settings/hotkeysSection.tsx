/**
 * SETTINGS › HOTKEYS (YAZ-3397; a reference page since YAZ-1679): every key of the app, ONE row each, and
 * the app-wide ones the user can change.
 *
 * - Window (D1): the changeable commands (`HOTKEY_COMMANDS`), each key a button, then the built-in window keys.
 *   Then the built-in groups (`HOTKEY_GROUPS`), "App standard" among them, and "Used by macOS" (D3, D8): this
 *   Mac's own keys, which main reads off its plist (`state:system-hotkeys`) when the page or a search shows.
 *   A built-in or macOS key is muted text, never a button.
 * - Each row is its own setting (`bare`), so the dialog's search filters the page down to single rows (D5): a
 *   row's search text is its label, its key and its hint. The changeable rows' text is built from the keys
 *   as they are now; the dialog rebuilds the candidates when a key changes, not on a keystroke.
 * - A change has two steps (D6): the button records a key, then a pop-up — the app's confirm sheet — shows
 *   the key it has now and the key it will have (D6), with what else changes. Only its
 *   Save, "Move it here", Remove or Reset writes `settings.hotkeys`, through the dialog's `onChange` like
 *   every setting. A built-in or macOS key is refused in red and the row keeps recording.
 * - A changed key is in the accent colour with a Reset link, which asks in the same pop-up first (D7);
 *   "Reset all hotkeys" at the end of the page asks in a sheet that lists every change. With no change
 *   neither is there.
 * - The page's own search bar (D5, `KeySearch`): "Search hotkeys…" filters the page to the rows that match
 *   ("file window" → New Files window), and "Press keys to search" records one key, puts it in that box and
 *   says who owns it.
 *
 * WHILE A RECORDER LISTENS the keys are its own: a window CAPTURE listener takes every keydown before the
 * dialog's Esc, App's ⌘B or an editor hears it, and main builds the menu with no key (`hotkeys:recording`),
 * because on macOS a menu key fires before the page sees it — recording ⌘W must not close the tab.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { hotkeyCommand, isHotkeyId, isUsableKey, sameKey, toDisplay, withKey, fromKeyEvent, type HotkeyId, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { ALL_KEYS, ASIDE_PLACES, blockersOf, clashesOf, isUsableFor, keysOf, stepsAside, type KeyRow, type KeyScope } from '@shared/keys'
import { MACOS_HOTKEYS, type SystemHotkey } from '@shared/macosHotkeys'
import { api } from '../api'
import { SearchIcon } from '../views/view/icons'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { MOUSE_TIPS } from './hotkeys'
import type { SettingDef, SettingsCtx, SettingsGroup, SettingsSection } from './registry'

/** What "keyboard shortcuts" finds: every row, as the tables did before (YAZ-1679). */
const ROW_KEYWORDS = ['keyboard shortcuts']

/** The Mac's keys to check a recorded key against: this Mac's once main has answered, the Mac's own table until then. */
const systemKeysOf = (ctx: SettingsCtx): readonly SystemHotkey[] => ctx.systemHotkeys ?? MACOS_HOTKEYS

const shown = (key: string | null): string => (key === null ? 'No key' : toDisplay(key))

// ---------- recording ----------

/** What a recorder hears: a key, or the two keys that mean something to it. */
type Heard = { kind: 'key'; key: string } | { kind: 'escape' } | { kind: 'backspace' }

/**
 * Main builds the menu with no key while any recorder of this window listens (D6). Counted here: main
 * knows the window, not the recorder, and one recorder that stops as the next starts must not give the
 * menu its keys back. No bridge (a test) is no menu.
 */
let recorders = 0
function tellMain(on: boolean): void {
  recorders += on ? 1 : -1
  if (recorders !== (on ? 1 : 0)) return
  void Promise.resolve()
    .then(() => api.hotkeys.recording(on))
    .catch(() => undefined)
}

/** The one recorder that listens: a second one that starts stops it (one key, one place). */
let listening: { stop: () => void } | null = null

/**
 * While `active`, every keydown is the recorder's (D6): taken in the window's capture phase, before the
 * dialog's Esc and App's keys, and never passed on. A lone modifier is ignored; a held key's repeats too.
 * A click outside `inside`, or the window losing focus, is Esc.
 */
function useKeyRecorder(active: boolean, inside: RefObject<HTMLElement | null>, onHeard: (heard: Heard) => void, onStop: () => void): void {
  const heard = useRef(onHeard)
  heard.current = onHeard
  const stop = useRef(onStop)
  stop.current = onStop
  useEffect(() => {
    if (!active) return
    listening?.stop()
    const me = { stop: () => stop.current() }
    listening = me
    tellMain(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.repeat) return
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      if (bare && e.key === 'Escape') return heard.current({ kind: 'escape' })
      if (bare && (e.key === 'Backspace' || e.key === 'Delete')) return heard.current({ kind: 'backspace' })
      const key = fromKeyEvent(e)
      if (key !== null) heard.current({ kind: 'key', key })
    }
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || inside.current?.contains(e.target) !== true) heard.current({ kind: 'escape' })
    }
    const onBlur = (): void => heard.current({ kind: 'escape' })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      if (listening === me) listening = null
      tellMain(false)
    }
  }, [active, inside])
}

// ---------- one changeable row ----------

/** Where a row's key works, as the page names it (YAZ-3564 K7): the group titles and "Blocked: App › …". */
export const SCOPE_TITLES: Record<KeyScope, string> = { app: 'App', note: 'Note', drawing: 'Drawing', diagram: 'Diagram', code: 'Code', views: 'Folder views' }
const owned = (row: KeyRow): string => `${SCOPE_TITLES[row.scope]} › ${row.label}`

/** The App command of an App row, for its Mac-standard default and its hint (YAZ-3397). */
const commandOf = (row: KeyRow) => (row.scope === 'app' && isHotkeyId(row.id.slice(4)) ? hotkeyCommand(row.id.slice(4) as HotkeyId) : undefined)
/** A row's key now, one key (the first of its defaults), or null for "No key". */
const keyNow = (row: KeyRow, overrides: HotkeyOverrides): string | null => keysOf(row, overrides)[0] ?? null
const isChanged = (row: KeyRow, overrides: HotkeyOverrides): boolean => overrides[row.id] !== undefined || (row.scope === 'app' && overrides[row.id.slice(4)] !== undefined)

/**
 * `overrides` with `row` on `key` (K2): a key equal to the row's one default deletes the change, so `{}` stays the
 * default; an App row writes through `withKey`, which also drops an old unscoped entry.
 */
export function withRowKey(overrides: HotkeyOverrides, row: KeyRow, key: string | null): HotkeyOverrides {
  const command = commandOf(row)
  if (command !== undefined) return withKey(overrides, command.id, key)
  const next = { ...overrides }
  const def = row.keys
  if (key === null ? def.length === 0 : def.length === 1 && sameKey(key, def[0])) delete next[row.id]
  else next[row.id] = key
  return next
}

/** What a pressed key would do, shown in the pop-up before anything is written (D6). */
type Pending = { kind: 'save'; key: string } | { kind: 'move'; key: string; from: KeyRow[] } | { kind: 'remove' } | { kind: 'reset'; from: KeyRow[] }

type RowMode = { kind: 'idle' } | { kind: 'recording'; refused: string | null } | { kind: 'confirm'; pending: Pending }

/** "⌘W is the Mac standard for Close tab. Most Mac apps use it." — for a Mac-standard key leaving its command (D6). */
const macStandardLine = (row: KeyRow): string => `${toDisplay(row.keys[0] ?? null)} is the Mac standard for ${row.label}. Most Mac apps use it.`

/** Whether `row` would lose its Mac-standard default key (D6). */
const losesMacStandard = (row: KeyRow, overrides: HotkeyOverrides): boolean => commandOf(row)?.macStandard === true && sameKey(keyNow(row, overrides), row.keys[0] ?? null)

/**
 * Why a key cannot be this row's (D6, YAZ-3564 K8), or null when it can. Its own default is always allowed. A key
 * macOS keeps, a Mac standard key and a built-in key are refused; any other row that has it moves (`movers`).
 */
function refusal(row: KeyRow, key: string, owners: readonly KeyRow[], system: readonly SystemHotkey[]): string | null {
  const macos = system.find((m) => sameKey(m.accelerator, key.split(' ')[0]))
  if (macos !== undefined) return `macOS uses ${toDisplay(key)} for ${macos.label}. Pick a different key.`
  if (row.keys.some((k) => sameKey(k, key))) return null
  const standard = owners.find((o) => o.macStandard === true)
  if (standard !== undefined) return `${toDisplay(key)} is the Mac standard for ${standard.label}. Pick a different key.`
  const builtIn = owners.find((o) => !o.changeable)
  if (builtIn !== undefined) return `${toDisplay(key)} is built in: ${owned(builtIn)}. Pick a different key.`
  if (!isUsableFor(row, key)) return `${toDisplay(key)} needs ⌘, ⌃ or ⌥. Pick a different key.`
  return null
}

/** "Let drawings, diagrams and code keep this key" (K9): an App row's switch, written to `settings.hotkeysAside` as a change only. */
function AsideSwitch({ row, ctx }: { row: KeyRow; ctx: SettingsCtx }) {
  const aside = ctx.settings.hotkeysAside
  const on = ASIDE_PLACES.every((place) => stepsAside(row, place, aside))
  const flip = (): void => {
    const next = { ...aside }
    const def = (row.stepsAsideIn ?? []).length > 0
    if (!on === def) delete next[row.id]
    else next[row.id] = !on
    ctx.onChange({ ...ctx.settings, hotkeysAside: next })
  }
  return (
    <label className="hotkeys__aside">
      <input type="checkbox" checked={on} onChange={flip} />
      Let drawings, diagrams and code keep this key
    </label>
  )
}

function HotkeyRow({ row, ctx }: { row: KeyRow; ctx: SettingsCtx }) {
  const overrides = ctx.settings.hotkeys
  const aside = ctx.settings.hotkeysAside
  const current = keyNow(row, overrides)
  const changed = isChanged(row, overrides)
  const blockers = blockersOf(row, overrides, aside)
  const [mode, setMode] = useState<RowMode>({ kind: 'idle' })
  const rowRef = useRef<HTMLDivElement>(null)
  const keyButton = useRef<HTMLButtonElement>(null)

  const write = (next: HotkeyOverrides): void => {
    ctx.onChange({ ...ctx.settings, hotkeys: next })
    setMode({ kind: 'idle' })
    keyButton.current?.focus()
  }
  const cancel = (): void => {
    setMode({ kind: 'idle' })
    keyButton.current?.focus()
  }

  useKeyRecorder(
    mode.kind === 'recording',
    rowRef,
    (heard) => {
      if (heard.kind === 'escape') return cancel()
      if (heard.kind === 'backspace') return current === null ? undefined : setMode({ kind: 'confirm', pending: { kind: 'remove' } })
      if (sameKey(heard.key, current)) return cancel()
      const owners = clashesOf(row, heard.key, overrides, aside)
      const refused = refusal(row, heard.key, owners, systemKeysOf(ctx))
      if (refused !== null) return setMode({ kind: 'recording', refused })
      const movers = owners.filter((o) => o.changeable)
      setMode({ kind: 'confirm', pending: movers.length === 0 ? { kind: 'save', key: heard.key } : { kind: 'move', key: heard.key, from: movers } })
    },
    () => setMode({ kind: 'idle' }),
  )

  const askReset = (): void => {
    const def = row.keys[0]
    const holders = def === undefined ? [] : clashesOf(row, def, overrides, aside).filter((o) => o.changeable && isChanged(o, overrides))
    setMode({ kind: 'confirm', pending: { kind: 'reset', from: holders } })
  }

  /** The pop-up's words (D6): its question, the key the row will have, what else changes, and its button. */
  const confirmSheet = (pending: Pending): { title: string; to: string | null; lines: string[]; yes: string; apply: () => void; careful: boolean } => {
    switch (pending.kind) {
      case 'save': {
        // The recorder stops on the key the row has now, so a new key always leaves a Mac-standard default.
        const careful = losesMacStandard(row, overrides)
        return { title: `Change the key for ${row.label}?`, to: pending.key, lines: careful ? [macStandardLine(row)] : [], yes: careful ? 'Change anyway' : 'Save', careful, apply: () => write(withRowKey(overrides, row, pending.key)) }
      }
      case 'move': {
        // K8: every row that has the key now loses it. A Mac-standard key can leave: another row's, or this row's own.
        const standards = [...pending.from, row].filter((r) => losesMacStandard(r, overrides))
        const lines = [...pending.from.map((o) => `${toDisplay(pending.key)} is ${owned(o)} now. It will lose its key.`), ...standards.map(macStandardLine)]
        const careful = standards.length > 0
        const next = pending.from.reduce((acc, o) => withRowKey(acc, o, null), overrides)
        return { title: `Change the key for ${row.label}?`, to: pending.key, lines, yes: careful ? 'Move anyway' : 'Move it here', careful, apply: () => write(withRowKey(next, row, pending.key)) }
      }
      case 'remove': {
        const careful = losesMacStandard(row, overrides)
        return { title: `Remove the key from ${row.label}?`, to: null, lines: careful ? [macStandardLine(row)] : [], yes: 'Remove', careful, apply: () => write(withRowKey(overrides, row, null)) }
      }
      case 'reset': {
        const def = row.keys[0] ?? null
        const lines = pending.from.map((o) => `${toDisplay(def)} is ${owned(o)} now. It will lose its key.`)
        const cleared = pending.from.reduce((acc, o) => withRowKey(acc, o, null), overrides)
        const reset = { ...cleared }
        delete reset[row.id]
        if (row.scope === 'app') delete reset[row.id.slice(4)]
        return { title: `Reset ${row.label}?`, to: def, lines, yes: 'Reset', careful: false, apply: () => write(reset) }
      }
    }
  }

  let below: ReactNode = null
  if (mode.kind === 'recording') {
    below = (
      <>
        {mode.refused !== null && (
          <p className="hotkeys__line hotkeys__line--refused" role="alert">
            {mode.refused}
          </p>
        )}
        <p className="hotkeys__line">Esc cancels. ⌫ removes the key. Nothing happens? Another app may own that key.</p>
      </>
    )
  } else if (mode.kind === 'confirm') {
    const sheet = confirmSheet(mode.pending)
    below = (
      // `contained`: Esc and a click away answer the pop-up, never the Settings dialog under it.
      // A Mac-standard key asks harder (D6): the keyboard starts on Cancel, and the button is red.
      <ConfirmSheet labelId={`hotkey-confirm-${rowDomId(row)}`} text={sheet.title} confirmLabel={sheet.yes} danger={sheet.careful} focusConfirm={!sheet.careful} keys="contained" onConfirm={sheet.apply} onCancel={cancel}>
        <div className="hotkeys__swap">
          <span className="hotkeys__swap-side">
            <span className="hotkeys__swap-label">Now</span>
            <span className={`hotkeys__cap${current === null ? ' hotkeys__key--none' : ''}`}>{shown(current)}</span>
          </span>
          <span className="hotkeys__swap-arrow" aria-label="becomes">
            →
          </span>
          <span className="hotkeys__swap-side">
            <span className="hotkeys__swap-label">New</span>
            <span className={`hotkeys__cap hotkeys__cap--new${sheet.to === null ? ' hotkeys__key--none' : ''}`}>{shown(sheet.to)}</span>
          </span>
        </div>
        {sheet.lines.map((text) => (
          <p key={text} className="hotkeys__line hotkeys__line--ask">
            {text}
          </p>
        ))}
      </ConfirmSheet>
    )
  }

  const recording = mode.kind === 'recording'
  return (
    <div ref={rowRef} className="hotkeys__command">
      <div className="hotkeys__row">
        <span className="hotkeys__keys">
          <button
            ref={keyButton}
            type="button"
            className={`hotkeys__key${changed ? ' hotkeys__key--changed' : ''}${recording ? ' hotkeys__key--recording' : ''}${current === null ? ' hotkeys__key--none' : ''}`}
            aria-label={recording ? `Press new keys for ${row.label}` : `${row.label}: ${shown(current)}. Change`}
            onClick={() => setMode(recording ? { kind: 'idle' } : { kind: 'recording', refused: null })}
          >
            {recording ? 'Press new keys…' : shown(current)}
          </button>
          {changed && mode.kind === 'idle' && (
            <button type="button" className="hotkeys__link" aria-label={`Reset ${row.label}`} onClick={askReset}>
              Reset
            </button>
          )}
        </span>
        <span className="hotkeys__label hotkeys__label--command">
          {row.label}
          {row.hint !== undefined && <span className="hotkeys__hint"> — {row.hint}</span>}
          {blockers.length > 0 && <span className="hotkeys__blocked"> Blocked: {owned(blockers[0])} fires first</span>}
        </span>
      </div>
      {row.scope === 'app' && mode.kind === 'idle' && <AsideSwitch row={row} ctx={ctx} />}
      {below}
    </div>
  )
}

// ---------- reset all ----------

/** The rows a reset can act on: the changed ones the page shows now (YAZ-3564 K7: a group chip or "Changed from default" narrows them). */
const changedShown = (ctx: SettingsCtx): KeyRow[] => ALL_KEYS.filter((r) => r.changeable && isChanged(r, ctx.settings.hotkeys) && inFilter(r, ctx))

/** "Reset all hotkeys" (D7), "Reset all shown" while a filter stands (K7): there only with a change, and it asks in the app's confirm sheet first. */
function ResetAllHotkeys({ ctx }: { ctx: SettingsCtx }) {
  const [asking, setAsking] = useState(false)
  const changes = changedShown(ctx)
  const filtered = isFiltered(ctx)
  const n = changes.length
  const plural = n === 1 ? 'hotkey' : 'hotkeys'
  return (
    <div className="hotkeys__reset-all">
      <button type="button" className="settings__option" onClick={() => setAsking(true)}>
        {filtered ? 'Reset all shown' : 'Reset all hotkeys'}
      </button>
      {asking && (
        <ConfirmSheet
          labelId="confirm-reset-hotkeys-text"
          text={`Reset ${n} changed ${plural}?`}
          confirmLabel={`Reset ${n} ${plural}`}
          keys="contained"
          onConfirm={() => {
            setAsking(false)
            const next = { ...ctx.settings.hotkeys }
            for (const r of changes) {
              delete next[r.id]
              if (r.scope === 'app') delete next[r.id.slice(4)]
            }
            ctx.onChange({ ...ctx.settings, hotkeys: filtered ? next : {} })
          }}
          onCancel={() => setAsking(false)}
        >
          <ul className="hotkeys__changes">
            {changes.map((r) => (
              <li key={r.id}>
                {owned(r)}: {shown(keyNow(r, ctx.settings.hotkeys))} → {shown(r.keys[0] ?? null)}
              </li>
            ))}
          </ul>
        </ConfirmSheet>
      )}
    </div>
  )
}

// ---------- the page's filters (YAZ-3564 K7) ----------

/** The page's filters: one place or all, only blocked keys, only changed keys. The dialog holds it and hands it in `ctx`. */
export interface HotkeyFilter {
  scope: KeyScope | 'all'
  clashes: boolean
  changed: boolean
}
export const NO_FILTER: HotkeyFilter = { scope: 'all', clashes: false, changed: false }

const isFiltered = (ctx: SettingsCtx): boolean => {
  const f = ctx.hotkeyFilter ?? NO_FILTER
  return f.scope !== 'all' || f.clashes || f.changed
}

/** Whether a row shows under the filters: its place, "Show clashes only" (a blocked row, or an App row that blocks one), "Changed from default". */
function inFilter(row: KeyRow, ctx: SettingsCtx): boolean {
  const f = ctx.hotkeyFilter ?? NO_FILTER
  if (f.scope !== 'all' && row.scope !== f.scope) return false
  if (f.changed && !isChanged(row, ctx.settings.hotkeys)) return false
  if (f.clashes) {
    const { hotkeys, hotkeysAside } = ctx.settings
    const blocked = blockersOf(row, hotkeys, hotkeysAside).length > 0
    const blocks = row.scope === 'app' && keysOf(row, hotkeys).some((k) => clashesOf(row, k, hotkeys, hotkeysAside).some((o) => o.scope !== 'app'))
    if (!blocked && !blocks) return false
  }
  return true
}

const CHIPS: readonly (KeyScope | 'all')[] = ['all', 'app', 'note', 'drawing', 'diagram', 'code', 'views']

/** The group chips and the two switches at the top of the page (K7). */
function FilterBar({ filter, onFilter }: { filter: HotkeyFilter; onFilter: (next: HotkeyFilter) => void }) {
  return (
    <div className="hotkeys__filters" role="group" aria-label="Filter hotkeys">
      <span className="hotkeys__chips">
        {CHIPS.map((scope) => (
          <button key={scope} type="button" className={`hotkeys__chip${filter.scope === scope ? ' hotkeys__chip--on' : ''}`} aria-pressed={filter.scope === scope} onClick={() => onFilter({ ...filter, scope })}>
            {scope === 'all' ? 'All' : SCOPE_TITLES[scope]}
          </button>
        ))}
      </span>
      <span className="hotkeys__toggles">
        <label>
          <input type="checkbox" checked={filter.clashes} onChange={() => onFilter({ ...filter, clashes: !filter.clashes })} />
          Show clashes only
        </label>
        <label>
          <input type="checkbox" checked={filter.changed} onChange={() => onFilter({ ...filter, changed: !filter.changed })} />
          Changed from default
        </label>
      </span>
    </div>
  )
}

// ---------- "Press keys to search" ----------

/** The answer for a key (D5, YAZ-3564 K10): every action on it, in every place, and whether the user can do anything about it. */
function keyAnswer(key: string, overrides: HotkeyOverrides, systemKeys: readonly SystemHotkey[]): string {
  const d = toDisplay(key)
  const macos = systemKeys.find((m) => sameKey(m.accelerator, key))
  if (macos !== undefined) return `${d}: macOS uses it for ${macos.label}. You can't use it.`
  const rows = ALL_KEYS.filter((r) => keysOf(r, overrides).some((k) => sameKey(k, key) || sameKey(k.split(' ')[0], key)))
  if (rows.length > 0) return `${d}: ${rows.map(owned).join('; ')}.`
  if (!isUsableKey(key)) return `${d} needs ⌘, ⌃ or ⌥ to be a hotkey (a drawing or diagram tool can be a letter).`
  return `${d} is free. You can use it.`
}

/**
 * The search bar at the top of Settings › Hotkeys (D5): a text box that filters the page (`query`, `onQuery`),
 * a button that records ONE key, puts it in that box and shows the answer while that query stands
 * (`answering`), and the filters (YAZ-3564 K7). Esc in the box clears it (the dialog's layered Esc); Esc while
 * recording stops the recording, and nothing else hears the key.
 */
export function KeySearch({ ctx, query, answering, onQuery, filter = NO_FILTER, onFilter }: { ctx: SettingsCtx; query: string; answering: boolean; onQuery: (query: string, pressed: boolean) => void; filter?: HotkeyFilter; onFilter?: (next: HotkeyFilter) => void }) {
  const [recording, setRecording] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLInputElement>(null)
  useKeyRecorder(
    recording,
    ref,
    (heard) => {
      setRecording(false)
      if (heard.kind === 'escape') return
      const key = heard.kind === 'key' ? heard.key : 'Backspace'
      setAnswer(keyAnswer(key, ctx.settings.hotkeys, systemKeysOf(ctx)))
      onQuery(toDisplay(key), true)
    },
    () => setRecording(false),
  )
  return (
    <div ref={ref} className="hotkeys__search">
      <div className="settings-search hotkeys__find">
        <SearchIcon />
        <input ref={boxRef} type="text" value={query} onChange={(e) => onQuery(e.target.value, false)} placeholder="Search hotkeys…" aria-label="Search hotkeys" autoComplete="off" spellCheck={false} />
        {query !== '' && (
          <button
            type="button"
            aria-label="Clear search hotkeys"
            onClick={() => {
              onQuery('', false)
              boxRef.current?.focus()
            }}
          >
            ×
          </button>
        )}
      </div>
      <button type="button" className={`settings__option${recording ? ' settings__option--active' : ''}`} onClick={() => setRecording(!recording)}>
        {recording ? 'Press keys…' : 'Press keys to search'}
      </button>
      {recording ? (
        <p className="hotkeys__line">Esc stops. Nothing happens? Another app may own that key.</p>
      ) : (
        answering &&
        answer !== null && (
          <p className="hotkeys__line hotkeys__line--answer" role="status">
            {answer}
          </p>
        )
      )}
      {onFilter !== undefined && <FilterBar filter={filter} onFilter={onFilter} />}
    </div>
  )
}

// ---------- the rows ----------

/** A row's DOM-safe id part: 'note.bold' → 'note-bold'; an App command keeps its bare id ('search'), as before YAZ-3564. */
const rowDomId = (row: KeyRow): string => (row.scope === 'app' && commandOf(row) !== undefined ? row.id.slice(4) : row.id.replace(/\./g, '-'))

/** A built-in row: the key as muted text, never a button (D8). */
const fixedRow = (keys: string, label: ReactNode) => (
  <div className="hotkeys__row hotkeys__row--fixed">
    <span className="hotkeys__keys">{keys}</span>
    <span className="hotkeys__label">{label}</span>
  </div>
)

/** The keys of a built-in row as one line: '⌘X / ⌘C', or a range '⌘1 … ⌘9'. */
const keysText = (keys: readonly string[]): string => {
  const shownKeys = keys.map((k) => k.split(' ').map(toDisplay).join(' '))
  return shownKeys.length > 3 && shownKeys.every((k, i) => i === 0 || k.slice(0, -1) === shownKeys[0].slice(0, -1)) ? `${shownKeys[0]} … ${shownKeys.at(-1)}` : shownKeys.join(' / ')
}

/** One row of the page: a button for a changeable key, muted text for a built-in one. Its search text is its label, its keys now and its hint (D5). */
const rowItem = (row: KeyRow): SettingDef => ({
  id: `hotkey-${rowDomId(row)}`,
  label: row.label,
  hint: ({ settings }) => [keysText(keysOf(row, settings.hotkeys)) || 'No key', row.hint].filter(Boolean).join(' '),
  keywords: [SCOPE_TITLES[row.scope].toLowerCase(), ...ROW_KEYWORDS],
  bare: true,
  available: (ctx) => inFilter(row, ctx),
  render: (ctx) => (row.changeable ? <HotkeyRow row={row} ctx={ctx} /> : fixedRow(keysText(keysOf(row, ctx.settings.hotkeys)), <>{row.label}{row.hint !== undefined && <span className="hotkeys__hint"> — {row.hint}</span>}</>)),
})

/** A "Used by macOS" row (D3): there while this Mac has the key, with its key as this Mac has it. */
const macosItem = (label: string): SettingDef => {
  const row = (ctx: SettingsCtx) => ctx.systemHotkeys?.find((r) => r.label === label)
  return {
    id: `hotkey-macos-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`,
    label,
    hint: (ctx) => {
      const r = row(ctx)
      return r === undefined ? '' : `${toDisplay(r.accelerator)}${r.changedOnThisMac === true ? ' you set it on this Mac' : ''}`
    },
    keywords: ['macos', ...ROW_KEYWORDS],
    bare: true,
    available: (ctx) => row(ctx) !== undefined && !isFiltered(ctx),
    render: (ctx) => {
      const r = row(ctx)
      return (
        r !== undefined &&
        fixedRow(
          toDisplay(r.accelerator),
          <>
            {label}
            {r.changedOnThisMac === true && <span className="hotkeys__hint"> (you set it on this Mac)</span>}
          </>,
        )
      )
    },
  }
}

/** The groups' hints (K4): where a change waits for the next open. */
const SCOPE_HINTS: Partial<Record<KeyScope, string>> = {
  app: 'App keys fire everywhere: on a Mac the menu takes a key before any page.',
  note: 'A change works in the notes you open after it.',
  diagram: 'A change works in the diagrams you open after it.',
}

/** The groups (YAZ-3564 K7): one per place, the changeable rows first, then the built-in ones. */
const groups: SettingsGroup[] = (['app', 'note', 'drawing', 'diagram', 'code', 'views'] as const).map((scope) => {
  const rows = ALL_KEYS.filter((r) => r.scope === scope)
  return { title: SCOPE_TITLES[scope], ...(SCOPE_HINTS[scope] === undefined ? {} : { hint: SCOPE_HINTS[scope] }), items: [...rows.filter((r) => r.changeable), ...rows.filter((r) => !r.changeable)].map(rowItem) }
})

/** The mouse tips (YAZ-1679): no key, so no row of the key list; shown while no filter stands. */
const mouseItems: SettingDef[] = MOUSE_TIPS.map(({ keys, label }, i) => ({ id: `hotkey-mouse-${i + 1}`, label, keywords: [keys, ...ROW_KEYWORDS], bare: true, available: (ctx) => !isFiltered(ctx), render: () => fixedRow(keys, label) }))

export const HOTKEYS_SECTION: SettingsSection = {
  id: 'hotkeys',
  title: 'Hotkeys',
  standalone: true,
  groups: [
    ...groups,
    { title: 'Mouse', items: mouseItems },
    {
      title: 'Used by macOS',
      hint: "macOS keeps these keys, so the app never hears them. Change them in the Mac's keyboard settings.",
      items: MACOS_HOTKEYS.map((m) => macosItem(m.label)),
    },
    {
      items: [
        {
          id: 'hotkeys-reset-all',
          label: 'Reset all hotkeys',
          keywords: ['reset', 'default'],
          bare: true,
          available: (ctx) => changedShown(ctx).length > 0,
          render: (ctx) => <ResetAllHotkeys ctx={ctx} />,
        },
      ],
    },
  ],
}
