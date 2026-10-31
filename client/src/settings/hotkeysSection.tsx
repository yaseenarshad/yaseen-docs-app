/**
 * SETTINGS › HOTKEYS (YAZ-3397; every place since YAZ-3564): every key of the app, ONE row each, from the one
 * key list (`shared/keys`).
 *
 * - ONE CARD PER KEY (YAZ-3564, after K1–K10): the rows whose key it is, each with its place's tag. Purple is an App
 *   key (every tab), green a tab's own; a shared key (both) has a pick per tab where an App command and a tab's
 *   action meet (drawings, diagrams, code; K9, `hotkeysAside` per tab), and a pick asks "Take it" first. A row an
 *   App key takes in its tab says what the key does there now, with a link to that key's card. Then the actions
 *   with no key, the clicks and drags, and "Used by macOS" (D3, D8): this Mac's own keys, which main reads off its plist
 *   (`state:system-hotkeys`) when the page or a search shows. A changeable key is a button; a built-in or macOS
 *   key is muted text. Chips and two switches filter the page (K7, K10).
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
 * - ONE CARD PER CLICK OR DRAG (YAZ-3936, demo round 1 C4 of YAZ-3879), hotkey first like the keys: "Click", "⌘-click",
 *   "⇧-click", "Drag"… Two places are the user's to change (`shared/keys/gestures.ts`): "Links in a note" and "Bullet
 *   dots", each with Open in this tab / a new tab / a background tab. Their box is a click recorder: click it, then hold
 *   the keys and click it again (⌫ or "No gesture" removes it); the same pop-up, Reset and "Move it here" as a key, and
 *   the change is a `settings.hotkeys` entry by row id. The other clicks are built in (`hotkeys.ts`), in the same boxes.
 *   A row's search text is its action, its gesture and its place ("links in a note").
 * - The page's own search bar (D5, `KeySearch`): "Search hotkeys…" filters the page to the rows that match
 *   ("file window" → New Files window), and "Press keys to search" records one key, puts it in that box and
 *   says who owns it.
 *
 * WHILE A RECORDER LISTENS the keys are its own: a window CAPTURE listener takes every keydown before the
 * dialog's Esc, the window's keys or an editor hears it, and main builds the menu with no key (`hotkeys:recording`),
 * because on macOS a menu key fires before the page sees it — recording ⌘W must not close the tab.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { appKeyId, hotkeyCommand, isHotkeyId, isUsableKey, normalizeKey, sameKey, toDisplay, withKey, fromKeyEvent, type HotkeyId, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { ALL_KEYS, ASIDE_PLACES, GESTURE_PLACE_TITLES, GESTURE_ROWS, asideChanged, asideId, blockersOf, clashesOf, gestureClashes, gestureDisplay, gestureOf, gestureOfEvent, isUsableFor, keysOf, parseGesture, sameGesture, stepsAside, withAside, withGesture, withoutAside, type AsidePlace, type GestureRow, type HotkeyAside, type KeyRow, type KeyScope } from '@shared/keys'
import { MACOS_HOTKEYS, type SystemHotkey } from '@shared/macosHotkeys'
import { api } from '../api'
import { SearchIcon } from '../views/view/icons'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Select } from './controls'
import { MOUSE_TIPS, shortLabel, type MouseTip } from './hotkeys'
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
/** A row's key differs from its default; with `aside`, a changed pick of a tab counts too (K9). */
const isChanged = (row: KeyRow, overrides: HotkeyOverrides, aside?: HotkeyAside): boolean =>
  overrides[row.id] !== undefined || (row.scope === 'app' && overrides[row.id.slice(4)] !== undefined) || asideChanged(row, aside)

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

/**
 * The row whose key just changed: it moves to its new key's card (YAZ-3564), so it mounts again there, and takes
 * the keyboard back, scrolls into view and flashes — the eye follows it, and Esc still reaches the dialog.
 */
let movedRow: { id: string; at: number } | null = null

function HotkeyRow({ row, ctx }: { row: KeyRow; ctx: SettingsCtx }) {
  const overrides = ctx.settings.hotkeys
  const aside = ctx.settings.hotkeysAside
  const current = keyNow(row, overrides)
  const changed = isChanged(row, overrides)
  /** The Reset link also undoes a changed step-aside switch (K9). */
  const resettable = isChanged(row, overrides, aside)
  const blockers = blockersOf(row, overrides, aside)
  const [mode, setMode] = useState<RowMode>({ kind: 'idle' })
  const rowRef = useRef<HTMLDivElement>(null)
  const keyButton = useRef<HTMLButtonElement>(null)

  const write = (next: HotkeyOverrides, hotkeysAside = ctx.settings.hotkeysAside): void => {
    movedRow = { id: row.id, at: Date.now() }
    ctx.onChange({ ...ctx.settings, hotkeys: next, hotkeysAside })
    setMode({ kind: 'idle' })
    keyButton.current?.focus()
  }
  useEffect(() => {
    // Only the mount right after the write: a row that stayed on its card never asks.
    if (movedRow?.id !== row.id || Date.now() - movedRow.at > 1000) return
    movedRow = null
    keyButton.current?.focus()
    keyButton.current?.scrollIntoView?.({ block: 'center' })
    const here = rowRef.current
    here?.classList.add('hotkeys__card--flash')
    const done = setTimeout(() => here?.classList.remove('hotkeys__card--flash'), 1200)
    return () => clearTimeout(done)
  }, [row.id])
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
        return { title: `Reset ${row.label}?`, to: def, lines, yes: 'Reset', careful: false, apply: () => write(reset, withoutAside(aside, [row])) }
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
  // A tab's box on a shared key holds its pick (K9): what the key does in this tab.
  const app = pickOf(row, overrides)
  const keeps = app !== null && stepsAside(app, row.scope as AsidePlace, aside)
  return (
    <div ref={rowRef} className="hotkeys__box">
      <div className="hotkeys__box-tab">{row.scope === 'app' ? appWhere(row, overrides, aside) : SCOPE_TITLES[row.scope]}</div>
      {app !== null ? (
        <TabPick app={app} place={row.scope as AsidePlace} own={[row]} ctx={ctx} />
      ) : (
        <div className="hotkeys__box-action" title={row.hint}>
          {row.label}
        </div>
      )}
      {mode.kind === 'idle' && (app !== null ? !keeps && <p className="hotkeys__line hotkeys__lost">{row.label} has no key here now.</p> : blockers.length > 0 && <LostLine row={row} blocker={blockers[0]} overrides={overrides} />)}
      <div className="hotkeys__box-foot">
        <button
          ref={keyButton}
          type="button"
          className={`hotkeys__key${changed ? ' hotkeys__key--changed' : ''}${recording ? ' hotkeys__key--recording' : ''}${current === null ? ' hotkeys__key--none' : ''}`}
          aria-label={recording ? `Press new keys for ${row.label}` : `${row.label}: ${shown(current)}. Change`}
          onClick={() => setMode(recording ? { kind: 'idle' } : { kind: 'recording', refused: null })}
        >
          {recording ? 'Press new keys…' : shown(current)}
        </button>
        {resettable && mode.kind === 'idle' && (
          <button type="button" className="hotkeys__link" aria-label={`Reset ${row.label}`} onClick={askReset}>
            Reset
          </button>
        )}
      </div>
      {below}
    </div>
  )
}

// ---------- reset all ----------

/** The rows a reset can act on: the changed ones the page shows now (YAZ-3564 K7: a group chip or "Changed from default" narrows them). */
const changedShown = (ctx: SettingsCtx): KeyRow[] => ALL_KEYS.filter((r) => r.changeable && isChanged(r, ctx.settings.hotkeys, ctx.settings.hotkeysAside) && inFilter(r, ctx))

/** "Reset all hotkeys" (D7), "Reset all shown" while a filter stands (K7): there only with a change, and it asks in the app's confirm sheet first. */
function ResetAllHotkeys({ ctx }: { ctx: SettingsCtx }) {
  const [asking, setAsking] = useState(false)
  const changes = changedShown(ctx)
  const clicks = changedClicks(ctx)
  const filtered = isFiltered(ctx)
  const n = changes.length + clicks.length
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
            for (const r of clicks) delete next[r.id]
            ctx.onChange({ ...ctx.settings, hotkeys: filtered ? next : {}, hotkeysAside: filtered ? withoutAside(ctx.settings.hotkeysAside, changes) : {} })
          }}
          onCancel={() => setAsking(false)}
        >
          <ul className="hotkeys__changes">
            {changes.map((r) => (
              <li key={r.id}>
                {owned(r)}: {isChanged(r, ctx.settings.hotkeys) ? `${shown(keyNow(r, ctx.settings.hotkeys))} → ${shown(r.keys[0] ?? null)}` : 'each tab picks its default action again'}
              </li>
            ))}
            {clicks.map((r) => (
              <li key={r.id}>
                {clickOwned(r)}: {shownClick(gestureOf(r, ctx.settings.hotkeys))} → {shownClick(r.gesture)}
              </li>
            ))}
          </ul>
        </ConfirmSheet>
      )}
    </div>
  )
}

// ---------- the page's filters (YAZ-3564 K7) ----------

/** The page's filters: one place, the clicks (YAZ-3747 demo), or all; only shared keys; only changed keys. The dialog holds it and hands it in `ctx`. */
export interface HotkeyFilter {
  scope: KeyScope | 'all' | 'clicks'
  shared: boolean
  changed: boolean
}
export const NO_FILTER: HotkeyFilter = { scope: 'all', shared: false, changed: false }

const isFiltered = (ctx: SettingsCtx): boolean => {
  const f = ctx.hotkeyFilter ?? NO_FILTER
  return f.scope !== 'all' || f.shared || f.changed
}

/** The "Clicks" chip alone: the built-in clicks and the clicks' legend show with the changeable ones. */
const clicksOnly = (ctx: SettingsCtx): boolean => {
  const f = ctx.hotkeyFilter ?? NO_FILTER
  return f.scope === 'clicks' && !f.shared && !f.changed
}

/** Whether a row shows under the filters: its place, "Shared keys only" (its key card is shared, or its key went to an App key), "Changed from default". */
function inFilter(row: KeyRow, ctx: SettingsCtx): boolean {
  const f = ctx.hotkeyFilter ?? NO_FILTER
  if (f.scope !== 'all' && row.scope !== f.scope) return false
  if (f.changed && !isChanged(row, ctx.settings.hotkeys, ctx.settings.hotkeysAside)) return false
  if (f.shared && cardsOf(ctx.settings.hotkeys).cardOf.get(row.id)?.kind !== 'shared' && blockersOf(row, ctx.settings.hotkeys, ctx.settings.hotkeysAside).length === 0) return false
  return true
}

// "Clicks" (YAZ-3747 demo): only the click and drag cards. "Press keys to search" hears keys only.
const CHIPS: readonly HotkeyFilter['scope'][] = ['all', 'app', 'note', 'drawing', 'diagram', 'code', 'views', 'clicks']

/** The group chips and the two switches at the top of the page (K7). */
function FilterBar({ filter, onFilter }: { filter: HotkeyFilter; onFilter: (next: HotkeyFilter) => void }) {
  return (
    <div className="hotkeys__filters" role="group" aria-label="Filter hotkeys">
      <span className="hotkeys__chips">
        {CHIPS.map((scope) => (
          <button key={scope} type="button" className={`hotkeys__chip${filter.scope === scope ? ' hotkeys__chip--on' : ''}`} aria-pressed={filter.scope === scope} onClick={() => onFilter({ ...filter, scope })}>
            {scope === 'all' ? 'All' : scope === 'clicks' ? 'Clicks' : SCOPE_TITLES[scope]}
          </button>
        ))}
      </span>
      <span className="hotkeys__toggles">
        <label>
          <input type="checkbox" checked={filter.shared} onChange={() => onFilter({ ...filter, shared: !filter.shared })} />
          Shared keys only
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

/** The other words a place goes by in the search (D5): its engine's name. */
const SCOPE_WORDS: Partial<Record<KeyScope, readonly string[]>> = { drawing: ['excalidraw', 'canvas'], diagram: ['draw.io'], code: ['monaco'] }

/** A row's DOM-safe id part: 'note.bold' → 'note-bold'; an App command keeps its bare id ('search'), as before YAZ-3564. */
const rowDomId = (row: KeyRow): string => (row.scope === 'app' && commandOf(row) !== undefined ? row.id.slice(4) : row.id.replace(/\./g, '-'))

/** A stable id part from a label (never the key, which can change): 'Zoom into that bullet' → 'zoom-into-that-bullet'. */
const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

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
/** The key row that Daily notes gates (YAZ-3607 D11). */
const DAILY_NOTE_ROW = appKeyId('dailyNote')

const rowItem = (row: KeyRow): SettingDef => ({
  id: `hotkey-${rowDomId(row)}`,
  label: row.label,
  hint: ({ settings }) => [keysText(keysOf(row, settings.hotkeys)) || 'No key', row.hint].filter(Boolean).join(' '),
  keywords: [SCOPE_TITLES[row.scope].toLowerCase(), ...(SCOPE_WORDS[row.scope] ?? []), ...ROW_KEYWORDS],
  bare: true,
  // "Open today's daily note" is a row only while Daily notes is on (YAZ-3607 D11), as its File menu item is.
  available: (ctx) => inFilter(row, ctx) && (row.id !== DAILY_NOTE_ROW || ctx.settings.dailyNotes),
  render: (ctx) => {
    if (row.changeable) return <HotkeyRow row={row} ctx={ctx} />
    const blocker = blockersOf(row, ctx.settings.hotkeys, ctx.settings.hotkeysAside)[0]
    return (
      <div className="hotkeys__box hotkeys__box--fixed">
        <div className="hotkeys__box-tab">{SCOPE_TITLES[row.scope]}</div>
        <div className="hotkeys__box-action" title={row.hint}>
          {row.label}
        </div>
        {blocker !== undefined && <LostLine row={row} blocker={blocker} overrides={ctx.settings.hotkeys} />}
        <div className="hotkeys__box-foot">
          <span className="hotkeys__keys">{keysText(keysOf(row, ctx.settings.hotkeys))}</span>
          <span className="hotkeys__hint">Built in</span>
        </div>
      </div>
    )
  },
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

// ---------- one card per key (YAZ-3564: the page by key) ----------

/** A key as one string to group by: each step in its normal form, so 'CmdOrCtrl+D' and 'Command+D' are one card. */
const normal = (key: string): string => key.split(' ').map((step) => normalizeKey(step) ?? step).join(' ')

/**
 * One card per key as the keys are now: the rows whose first key it is, App rows first. Shared: an App row and a
 * row of a tab on one key (⌘D), or an App key that starts a tab's two-step keys (⌘K); App: an App key alone; Tab:
 * one or more tabs' own key (⌘B is Bold in notes and in diagrams), no App key.
 */
interface KeyCard {
  key: string
  rows: KeyRow[]
  kind: 'shared' | 'app' | 'tab'
  /** The tabs a pick decides (K9): a shared key the user can settle comes first on the page. */
  picks: number
}

const ORDER: readonly KeyScope[] = ['app', 'note', 'drawing', 'diagram', 'code', 'views']
const KIND_ORDER = { shared: 0, app: 1, tab: 2 } as const

/** The tabs where an App command's key can go either way (K9): the rows of each that have it, or begin with it. */
function contested(app: KeyRow, overrides: HotkeyOverrides): Map<AsidePlace, KeyRow[]> {
  const out = new Map<AsidePlace, KeyRow[]>()
  const key = keyNow(app, overrides)
  if (key === null || commandOf(app) === undefined || commandOf(app)?.rendererOwned === true || app.macStandard === true) return out
  // With every tab handing the key to the App action, the rows that lose it are the ones a pick decides.
  const takeAll = Object.fromEntries(ASIDE_PLACES.map((p) => [asideId(app.id, p), false]))
  for (const other of clashesOf(app, key, overrides, takeAll)) {
    if (!(ASIDE_PLACES as readonly string[]).includes(other.scope)) continue
    const place = other.scope as AsidePlace
    out.set(place, [...(out.get(place) ?? []), other])
  }
  return out
}

let cardCache: { overrides: HotkeyOverrides; cards: KeyCard[]; noKey: KeyRow[]; cardOf: Map<string, KeyCard> } | null = null
/** The cards for `overrides`, built once per set of changes. */
function cardsOf(overrides: HotkeyOverrides): { cards: KeyCard[]; noKey: KeyRow[]; cardOf: Map<string, KeyCard> } {
  if (cardCache?.overrides === overrides) return cardCache
  const byKey = new Map<string, KeyCard>()
  const noKey: KeyRow[] = []
  for (const row of ALL_KEYS) {
    const key = keyNow(row, overrides)
    if (key === null) {
      noKey.push(row)
      continue
    }
    const id = normal(key)
    const card: KeyCard = byKey.get(id) ?? { key, rows: [], kind: 'tab', picks: 0 }
    card.rows.push(row)
    byKey.set(id, card)
  }
  const cards = [...byKey.values()]
  for (const card of cards) {
    card.rows.sort((a, b) => ORDER.indexOf(a.scope) - ORDER.indexOf(b.scope))
    const apps = card.rows.filter((r) => r.scope === 'app')
    card.picks = apps.reduce((n, r) => n + contested(r, overrides).size, 0)
    const shared = apps.length > 0 && (card.rows.some((r) => r.scope !== 'app') || card.picks > 0)
    card.kind = shared ? 'shared' : apps.length > 0 ? 'app' : 'tab'
  }
  const first = (c: KeyCard) => ORDER.indexOf(c.rows[0].scope)
  cards.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.picks - a.picks || first(a) - first(b) || toDisplay(a.key).localeCompare(toDisplay(b.key)))
  const cardOf = new Map(cards.flatMap((card) => card.rows.map((r) => [r.id, card] as const)))
  cardCache = { overrides, cards, noKey, cardOf }
  return cardCache
}

/** A key as the page shows it: '⌘D', or a two-step '⌘K ⌘C'. */
const keyText = (key: string): string => key.split(' ').map(toDisplay).join(' ')
/** A card's DOM id, for a link to it. */
const cardAnchor = (key: string): string => `hotkeys-key-${normal(key).replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`

const PLACE_WORDS: Record<KeyScope, string> = { app: 'every tab', note: 'notes', drawing: 'drawings', diagram: 'diagrams', code: 'code', views: 'folder views' }

/** Under a row whose key an App key always takes in its tab: what the key does there, and a link to the card that decides it. */
function LostLine({ row, blocker, overrides }: { row: KeyRow; blocker: KeyRow; overrides: HotkeyOverrides }) {
  const theirs = keyNow(blocker, overrides)
  const mine = keyNow(row, overrides)
  const elsewhere = theirs !== null && mine !== null && normal(theirs) !== normal(mine)
  const go = (): void => {
    const card = theirs === null ? null : document.getElementById(cardAnchor(theirs))
    card?.scrollIntoView({ block: 'center' })
    card?.classList.add('hotkeys__card--flash')
    setTimeout(() => card?.classList.remove('hotkeys__card--flash'), 1200)
  }
  return (
    <p className="hotkeys__line hotkeys__lost">
      No key here now: {theirs === null ? '' : keyText(theirs)} is {owned(blocker)}.
      {elsewhere && (
        <>
          {' '}
          <button type="button" className="hotkeys__link" onClick={go}>
            Change it on {keyText(theirs)}
          </button>
        </>
      )}
    </p>
  )
}

/** The App command a pick in `row`'s tab settles on its card (K9), or null: the row then just says what it is. */
function pickOf(row: KeyRow, overrides: HotkeyOverrides): KeyRow | null {
  if (!(ASIDE_PLACES as readonly string[]).includes(row.scope)) return null
  const card = cardsOf(overrides).cardOf.get(row.id)
  return card?.rows.find((a) => a.scope === 'app' && (contested(a, overrides).get(row.scope as AsidePlace) ?? []).some((r) => r.id === row.id)) ?? null
}

/** A tab's own actions on a key, as a pick names them: 'Duplicate', or '28 two-step keys'. */
const ownText = (rows: readonly KeyRow[]): string => (rows.length > 3 ? `${rows.length} two-step keys` : rows.map((r) => r.label).join(', '))
const losersText = (rows: readonly KeyRow[]): string => (rows.length > 3 ? `${rows.length} ${SCOPE_TITLES[rows[0].scope].toLowerCase()} keys that start with it` : rows.map(owned).join(', '))

/**
 * What a shared key does in one tab (K9, YAZ-3564): the tab's own action, or the App command's. A dropdown, like the
 * mockup; a change asks "Take it" first (the Premiere rule), and writes `hotkeysAside` for this tab alone.
 */
function TabPick({ app, place, own, ctx }: { app: KeyRow; place: AsidePlace; own: readonly KeyRow[]; ctx: SettingsCtx }) {
  const [asking, setAsking] = useState<boolean | null>(null)
  const aside = ctx.settings.hotkeysAside
  const keeps = stepsAside(app, place, aside)
  const key = keyNow(app, ctx.settings.hotkeys)
  const cap = key === null ? '' : keyText(key)
  const losers = contested(app, ctx.settings.hotkeys).get(place) ?? own
  return (
    <>
      <Select<boolean> options={[{ value: true, label: ownText(losers) }, { value: false, label: app.label }]} value={keeps} onChange={(next) => next !== keeps && setAsking(next)} ariaLabel={`${cap} in ${PLACE_WORDS[place]}`} />
      {asking !== null && (
        <ConfirmSheet
          labelId={`hotkeys-pick-${app.id.replace(/\W/g, '-')}-${place}`}
          text={`${cap} in ${PLACE_WORDS[place]}: ${asking ? ownText(losers) : app.label}?`}
          confirmLabel="Take it"
          keys="contained"
          focusConfirm
          onConfirm={() => {
            ctx.onChange({ ...ctx.settings, hotkeysAside: withAside(aside, app, place, asking) })
            setAsking(null)
          }}
          onCancel={() => setAsking(null)}
        >
          <p className="hotkeys__line hotkeys__line--ask">{asking ? `${owned(app)} will not work in ${PLACE_WORDS[place]}.` : `${losersText(losers)} will have no key in ${PLACE_WORDS[place]}.`}</p>
        </ConfirmSheet>
      )}
    </>
  )
}

const TAB_TITLES: Record<AsidePlace, string> = { drawing: 'Drawings', diagram: 'Diagrams', code: 'Code' }
/** Where an App action works now, as its box's title: 'Every tab', or 'Notes · Folder views · Code' while some tabs keep their own. */
function appWhere(row: KeyRow, overrides: HotkeyOverrides, aside: HotkeyAside): string {
  const fought = contested(row, overrides)
  const kept = ASIDE_PLACES.filter((p) => fought.has(p) && stepsAside(row, p, aside))
  return kept.length === 0 ? 'Every tab' : ['Notes', 'Folder views', ...ASIDE_PLACES.filter((p) => !kept.includes(p)).map((p) => TAB_TITLES[p])].join(' · ')
}

/** A tab's box on a shared key whose own actions are on other cards (code's two-step keys on ⌘K): just the pick. */
const pickItem = (app: KeyRow, place: AsidePlace, rows: readonly KeyRow[]): SettingDef => ({
  id: `hotkeys-pick-${rowDomId(app)}-${place}`,
  label: `${app.label} in ${PLACE_WORDS[place]}`,
  keywords: [SCOPE_TITLES[place].toLowerCase(), ...ROW_KEYWORDS],
  bare: true,
  available: (ctx) => {
    const f = ctx.hotkeyFilter ?? NO_FILTER
    return (f.scope === 'all' || f.scope === place) && (!f.changed || asideChanged(app, ctx.settings.hotkeysAside))
  },
  render: (ctx) => (
    <div className="hotkeys__box">
      <div className="hotkeys__box-tab">{SCOPE_TITLES[place]}</div>
      <TabPick app={app} place={place} own={rows} ctx={ctx} />
      <p className="hotkeys__line">Each starts with {keyText(keyNow(app, ctx.settings.hotkeys) ?? '')}. They are on their own cards.</p>
    </div>
  ),
})

/** A card's head: the key, and what kind of key it is. */
function KeyCardHead({ card }: { card: KeyCard }) {
  const what =
    card.kind === 'shared' ? (card.picks > 0 ? 'Shared: each tab picks what it does.' : 'Used by the app and by tabs: built in.') : card.kind === 'app' ? 'Works in every tab.' : card.rows.length > 1 ? 'Each tab has its own action.' : `Works in ${PLACE_WORDS[card.rows[0].scope]}.`
  return (
    <div className="hotkeys__card-head">
      <h3 className="settings-group__title hotkeys__cap-key">{keyText(card.key)}</h3>
      <span className="hotkeys__hint">{what}</span>
    </div>
  )
}

/** How the page reads, said once at the top (shown while no filter stands). */
const legendItem: SettingDef = {
  id: 'hotkeys-legend',
  label: 'How keys work',
  keywords: ['shared', ...ROW_KEYWORDS],
  bare: true,
  available: (ctx) => !isFiltered(ctx),
  render: () => (
    <p className="hotkeys__line">
      One card per key, one box per tab. Where tabs share a key, each tab's box picks what the key does there. A note or a diagram reads a change when it opens.
    </p>
  ),
}

/** The picks of a card's App commands whose tab rows are on other cards (⌘K's two-step code keys). */
function elsewherePicks(card: KeyCard, overrides: HotkeyOverrides): SettingDef[] {
  return card.rows
    .filter((r) => r.scope === 'app')
    .flatMap((app) => [...contested(app, overrides)].filter(([, rows]) => !rows.some((r) => card.rows.includes(r))).map(([place, rows]) => pickItem(app, place, rows)))
}

/** The page's groups as the keys are now: the colours, one card per key, then the actions with no key. */
function cardGroups(ctx: SettingsCtx): SettingsGroup[] {
  const { cards, noKey } = cardsOf(ctx.settings.hotkeys)
  return [
    { items: [legendItem] },
    ...cards.map((card) => ({
      title: keyText(card.key),
      anchor: cardAnchor(card.key),
      cardClass: 'hotkeys__boxes',
      header: () => <KeyCardHead card={card} />,
      items: [...card.rows.map(rowItem), ...elsewherePicks(card, ctx.settings.hotkeys)],
    })),
    { title: 'Actions with no key', hint: 'They still work from the menu or the toolbar.', anchor: 'hotkeys-no-key', cardClass: 'hotkeys__boxes', items: noKey.map(rowItem) },
  ]
}

// ---------- the clicks and drags (YAZ-3936: one card per gesture) ----------

/** "Links in a note › Open in this tab": a gesture row as the pop-up and the Reset list name it. */
const clickOwned = (row: GestureRow): string => `${GESTURE_PLACE_TITLES[row.place]} › ${row.label}`
const shownClick = (gesture: string | null): string => (gesture === null ? 'No gesture' : gestureDisplay(gesture))
const clickChanged = (row: GestureRow, overrides: HotkeyOverrides): boolean => overrides[row.id] !== undefined

/** Why a gesture cannot be a row's, or null when it can: ⌃-click is the Mac's right-click (the link menu, the bullet menu). */
function clickRefusal(gesture: string): string | null {
  return parseGesture(gesture)?.ctrl === true ? `${gestureDisplay(gesture)} is the Mac's right-click. Pick a different gesture.` : null
}

/**
 * While `active`, the click recorder listens (YAZ-3936): Esc and a click outside `inside` stop it, ⌫ asks to remove the
 * gesture. The keys are taken in the window's capture phase, as the key recorder takes them, so the dialog's Esc never
 * hears them. No menu key changes: a held modifier alone fires nothing.
 */
function useClickRecorder(active: boolean, inside: RefObject<HTMLElement | null>, onStop: () => void, onRemove: () => void): void {
  const stop = useRef(onStop)
  stop.current = onStop
  const remove = useRef(onRemove)
  remove.current = onRemove
  useEffect(() => {
    if (!active) return
    listening?.stop()
    const me = { stop: () => stop.current() }
    listening = me
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' && e.key !== 'Backspace' && e.key !== 'Delete') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') stop.current()
      else remove.current()
    }
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || inside.current?.contains(e.target) !== true) stop.current()
    }
    const onBlur = (): void => stop.current()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      if (listening === me) listening = null
    }
  }, [active, inside])
}

type ClickPending = { kind: 'save'; gesture: string; from: GestureRow[] } | { kind: 'remove' } | { kind: 'reset'; from: GestureRow[] }
type ClickMode = { kind: 'idle' } | { kind: 'recording'; refused: string | null } | { kind: 'confirm'; pending: ClickPending }

/**
 * One changeable click (YAZ-3936), as a key's box: its place's tag, its action, and the record box. Click the box, then
 * hold the keys and click it again: the gesture goes to the same pop-up as a key (Now → New, what else loses it), and
 * only its Save, "Move it here", Remove or Reset writes `settings.hotkeys`. Two rows of one place never share a gesture.
 */
function GestureBox({ row, ctx }: { row: GestureRow; ctx: SettingsCtx }) {
  const overrides = ctx.settings.hotkeys
  const current = gestureOf(row, overrides)
  const changed = clickChanged(row, overrides)
  const [mode, setMode] = useState<ClickMode>({ kind: 'idle' })
  const boxRef = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const idle = (): void => {
    setMode({ kind: 'idle' })
    button.current?.focus()
  }
  const write = (next: HotkeyOverrides): void => {
    ctx.onChange({ ...ctx.settings, hotkeys: next })
    idle()
  }
  const askRemove = (): void => (current === null ? idle() : setMode({ kind: 'confirm', pending: { kind: 'remove' } }))
  useClickRecorder(mode.kind === 'recording', boxRef, idle, askRemove)

  const heard = (gesture: string): void => {
    if (sameGesture(gesture, current)) return idle()
    const refused = clickRefusal(gesture)
    if (refused !== null) return setMode({ kind: 'recording', refused })
    setMode({ kind: 'confirm', pending: { kind: 'save', gesture, from: gestureClashes(row, gesture, overrides) } })
  }
  const askReset = (): void => {
    const holders = row.gesture === null ? [] : gestureClashes(row, row.gesture, overrides).filter((o) => clickChanged(o, overrides))
    setMode({ kind: 'confirm', pending: { kind: 'reset', from: holders } })
  }

  const sheetOf = (pending: ClickPending): { title: string; to: string | null; lines: string[]; yes: string; apply: () => void } => {
    switch (pending.kind) {
      case 'save': {
        const next = pending.from.reduce((acc, o) => withGesture(acc, o, null), overrides)
        const lines = pending.from.map((o) => `${gestureDisplay(pending.gesture)} is ${clickOwned(o)} now. It will lose its gesture.`)
        return { title: `Change the gesture for ${clickOwned(row)}?`, to: pending.gesture, lines, yes: pending.from.length === 0 ? 'Save' : 'Move it here', apply: () => write(withGesture(next, row, pending.gesture)) }
      }
      case 'remove':
        return { title: `Remove the gesture from ${clickOwned(row)}?`, to: null, lines: [], yes: 'Remove', apply: () => write(withGesture(overrides, row, null)) }
      case 'reset': {
        const next = pending.from.reduce((acc, o) => withGesture(acc, o, null), overrides)
        const lines = pending.from.map((o) => `${shownClick(row.gesture)} is ${clickOwned(o)} now. It will lose its gesture.`)
        return { title: `Reset ${clickOwned(row)}?`, to: row.gesture, lines, yes: 'Reset', apply: () => write(withGesture(next, row, row.gesture)) }
      }
    }
  }

  const recording = mode.kind === 'recording'
  let below: ReactNode = null
  if (recording) {
    below = (
      <>
        {mode.refused !== null && (
          <p className="hotkeys__line hotkeys__line--refused" role="alert">
            {mode.refused}
          </p>
        )}
        <p className="hotkeys__line">
          Hold the keys and click the box. Esc cancels.{' '}
          {current !== null && (
            <button type="button" className="hotkeys__link" onClick={askRemove}>
              No gesture
            </button>
          )}
        </p>
      </>
    )
  } else if (mode.kind === 'confirm') {
    const sheet = sheetOf(mode.pending)
    below = (
      <ConfirmSheet labelId={`hotkey-confirm-${row.id.replace('.', '-')}`} text={sheet.title} confirmLabel={sheet.yes} focusConfirm keys="contained" onConfirm={sheet.apply} onCancel={idle}>
        <div className="hotkeys__swap">
          <span className="hotkeys__swap-side">
            <span className="hotkeys__swap-label">Now</span>
            <span className={`hotkeys__cap${current === null ? ' hotkeys__key--none' : ''}`}>{shownClick(current)}</span>
          </span>
          <span className="hotkeys__swap-arrow" aria-label="becomes">
            →
          </span>
          <span className="hotkeys__swap-side">
            <span className="hotkeys__swap-label">New</span>
            <span className={`hotkeys__cap hotkeys__cap--new${sheet.to === null ? ' hotkeys__key--none' : ''}`}>{shownClick(sheet.to)}</span>
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
  return (
    <div ref={boxRef} className="hotkeys__box">
      <div className="hotkeys__box-tab">{GESTURE_PLACE_TITLES[row.place]}</div>
      <div className="hotkeys__box-action" title={row.hint}>
        {row.label}
      </div>
      <div className="hotkeys__box-foot">
        <button
          ref={button}
          type="button"
          className={`hotkeys__key${changed ? ' hotkeys__key--changed' : ''}${recording ? ' hotkeys__key--recording' : ''}${current === null ? ' hotkeys__key--none' : ''}`}
          aria-label={recording ? `Hold the keys and click here for ${row.label}` : `${clickOwned(row)}: ${shownClick(current)}. Change`}
          // The gesture is the mousedown's modifiers; its click must not start a new recording.
          onMouseDown={(e) => {
            if (!recording || e.button !== 0) return
            e.preventDefault()
            heard(gestureOfEvent(e))
          }}
          onContextMenu={(e) => {
            if (recording) e.preventDefault()
          }}
          onClick={() => {
            if (mode.kind === 'idle') setMode({ kind: 'recording', refused: null })
          }}
        >
          {recording ? 'Hold keys, click here' : shownClick(current)}
        </button>
        {changed && mode.kind === 'idle' && (
          <button type="button" className="hotkeys__link" aria-label={`Reset ${clickOwned(row)}`} onClick={askReset}>
            Reset
          </button>
        )}
      </div>
      {below}
    </div>
  )
}

/** Whether the click rows show under the filters (YAZ-3564 K7): All or Clicks, no "Shared keys only"; "Changed from default" keeps the changed ones. */
function clickInFilter(ctx: SettingsCtx, changed: boolean): boolean {
  const f = ctx.hotkeyFilter ?? NO_FILTER
  return (f.scope === 'all' || f.scope === 'clicks') && !f.shared && (!f.changed || changed)
}

/** The changed click rows the page shows now: "Reset all" lists them with the keys. */
const changedClicks = (ctx: SettingsCtx): GestureRow[] => GESTURE_ROWS.filter((r) => clickChanged(r, ctx.settings.hotkeys) && clickInFilter(ctx, true))

/** A changeable click's row (YAZ-3936). Its search text is its action, its gesture now, its hint and its place ("links in a note"). */
const gestureItem = (row: GestureRow): SettingDef => ({
  id: `hotkey-${row.id.replace('.', '-')}`,
  label: row.label,
  hint: ({ settings }) => [shownClick(gestureOf(row, settings.hotkeys)), row.hint].filter(Boolean).join(' '),
  keywords: [GESTURE_PLACE_TITLES[row.place].toLowerCase(), 'mouse', 'click', 'gesture', ...ROW_KEYWORDS],
  bare: true,
  available: (ctx) => clickInFilter(ctx, clickChanged(row, ctx.settings.hotkeys)),
  render: (ctx) => <GestureBox row={row} ctx={ctx} />,
})

/** A built-in click or drag (YAZ-1679): a box like a built-in key's, its gesture as muted text. Shown while no filter stands, or "Clicks" alone. */
const tipItem = (tip: MouseTip): SettingDef => ({
  id: `hotkey-mouse-${slug(shortLabel(tip.label))}`,
  label: tip.label,
  keywords: [tip.gesture, tip.place.toLowerCase(), 'mouse', ...ROW_KEYWORDS],
  bare: true,
  available: (ctx) => !isFiltered(ctx) || clicksOnly(ctx),
  render: () => (
    <div className="hotkeys__box hotkeys__box--fixed">
      <div className="hotkeys__box-tab">{tip.place}</div>
      <div className="hotkeys__box-action">{tip.label}</div>
      <div className="hotkeys__box-foot">
        <span className="hotkeys__keys">{tip.gesture}</span>
        <span className="hotkeys__hint">Built in</span>
      </div>
    </div>
  ),
})

/** One card per gesture as the clicks are now: the changeable rows first, then the built-in ones. */
interface ClickCard {
  gesture: string
  rows: GestureRow[]
  tips: MouseTip[]
}

/** The cards' order: Click, then the modified clicks (fewer keys first), then the other gestures as the tips list them. */
const clickRank = (gesture: string): number => (gesture === 'Click' ? 0 : gesture.endsWith('-click') && !gesture.includes('Right') && !gesture.includes('Double') ? gesture.length : 100)

let clickCache: { overrides: HotkeyOverrides; cards: ClickCard[]; none: GestureRow[] } | null = null
function clickCardsOf(overrides: HotkeyOverrides): { cards: ClickCard[]; none: GestureRow[] } {
  if (clickCache?.overrides === overrides) return clickCache
  const byGesture = new Map<string, ClickCard>()
  const card = (gesture: string): ClickCard => {
    const found = byGesture.get(gesture) ?? { gesture, rows: [], tips: [] }
    byGesture.set(gesture, found)
    return found
  }
  const none: GestureRow[] = []
  for (const row of GESTURE_ROWS) {
    const gesture = gestureOf(row, overrides)
    if (gesture === null) none.push(row)
    else card(gestureDisplay(gesture)).rows.push(row)
  }
  for (const tip of MOUSE_TIPS) card(tip.gesture).tips.push(tip)
  const seen = [...byGesture.keys()]
  const cards = [...byGesture.values()].sort((a, b) => clickRank(a.gesture) - clickRank(b.gesture) || seen.indexOf(a.gesture) - seen.indexOf(b.gesture))
  clickCache = { overrides, cards, none }
  return clickCache
}

/** How the clicks read, said once (shown while no filter stands, or "Clicks" alone). */
const clickLegendItem: SettingDef = {
  id: 'hotkeys-click-legend',
  label: 'How clicks work',
  keywords: ['mouse', 'click', 'drag', 'gesture', ...ROW_KEYWORDS],
  bare: true,
  available: (ctx) => !isFiltered(ctx) || clicksOnly(ctx),
  render: () => <p className="hotkeys__line">One card per click or drag, one box per place. Links in a note and Bullet dots are yours to change: click the box, then hold the keys and click it again.</p>,
}

/** The clicks' groups (YAZ-3936): the legend, one card per gesture, then the clicks with no gesture. */
function clickGroups(ctx: SettingsCtx): SettingsGroup[] {
  const { cards, none } = clickCardsOf(ctx.settings.hotkeys)
  return [
    { title: 'Clicks and drags', items: [clickLegendItem] },
    ...cards.map((c) => ({
      title: c.gesture,
      anchor: `hotkeys-click-${c.gesture.replace(/[^A-Za-z0-9]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}`)}`,
      cardClass: 'hotkeys__boxes',
      header: () => (
        <div className="hotkeys__card-head">
          <h3 className="settings-group__title hotkeys__cap-key">{c.gesture}</h3>
          <span className="hotkeys__hint">{c.rows.length === 0 ? 'Built in.' : c.rows.length + c.tips.length > 1 ? 'Each place has its own action.' : `Works on ${GESTURE_PLACE_TITLES[c.rows[0].place].toLowerCase()}.`}</span>
        </div>
      ),
      items: [...c.rows.map(gestureItem), ...c.tips.map(tipItem)],
    })),
    ...(none.length === 0 ? [] : [{ title: 'Clicks with no gesture', hint: 'Click the box, then hold the keys and click it again, to give one.', anchor: 'hotkeys-no-click', cardClass: 'hotkeys__boxes', items: none.map(gestureItem) }]),
  ]
}

/** The groups after the clicks: macOS and Reset all. */
const tailGroups: SettingsGroup[] = [
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
          available: (ctx) => changedShown(ctx).length + changedClicks(ctx).length > 0,
          render: (ctx) => <ResetAllHotkeys ctx={ctx} />,
        },
      ],
    },
]

export const HOTKEYS_SECTION: SettingsSection = {
  id: 'hotkeys',
  title: 'Hotkeys',
  standalone: true,
  // The part that does not move with the keys; `groupsFor` puts the key cards first, then the clicks (YAZ-3936).
  groups: tailGroups,
  groupsFor: (ctx) => [...cardGroups(ctx), ...clickGroups(ctx), ...tailGroups],
}
