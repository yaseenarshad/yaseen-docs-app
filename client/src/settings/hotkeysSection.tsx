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
 *   the key it has now and the key it will have (Yasin's call in the demo), with what else changes. Only its
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
import { HOTKEY_COMMANDS, hotkeyCommand, isUsableKey, keyFor, ownersOf, sameKey, toDisplay, withKey, fromKeyEvent, type HotkeyId, type HotkeyOverrides, type HotkeyOwner } from '@shared/hotkeyBindings'
import { MACOS_HOTKEYS, type SystemHotkey } from '@shared/macosHotkeys'
import { api } from '../api'
import { SearchIcon } from '../views/view/icons'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { BUILT_IN_KEYS, HOTKEY_GROUPS, shortLabel, type HotkeyEntry } from './hotkeys'
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
 * Main builds the menu with no key while any recorder of this window listens (D5). Counted here: main
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
 * While `active`, every keydown is the recorder's (D5): taken in the window's capture phase, before the
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

/** What a pressed key would do, shown in the pop-up before anything is written (D6). */
type Pending = { kind: 'save'; key: string } | { kind: 'move'; key: string; from: HotkeyId } | { kind: 'remove' } | { kind: 'reset'; from: HotkeyId | null }

type RowMode = { kind: 'idle' } | { kind: 'recording'; refused: string | null } | { kind: 'confirm'; pending: Pending }

/** "⌘W is the Mac standard for Close tab. Most Mac apps use it." — for a Mac-standard key leaving its command (D6). */
const macStandardLine = (id: HotkeyId): string => `${toDisplay(hotkeyCommand(id).key)} is the Mac standard for ${hotkeyCommand(id).label}. Most Mac apps use it.`

/** Whether `id` would lose its Mac-standard default key (D6). */
const losesMacStandard = (id: HotkeyId, overrides: HotkeyOverrides): boolean => {
  const command = hotkeyCommand(id)
  return command.macStandard === true && sameKey(keyFor(id, overrides), command.key)
}

/** Why a key cannot be this command's (D6), or null when it can. Defaults are always allowed: a key the command ships with is its own. */
function refusal(id: HotkeyId, key: string, owners: readonly HotkeyOwner[]): string | null {
  const macos = owners.find((o) => o.kind === 'macos')
  if (macos !== undefined) return `macOS uses ${toDisplay(key)} for ${macos.label}. Pick a different key.`
  if (owners.some((o) => o.kind === 'command') || sameKey(key, hotkeyCommand(id).key)) return null
  const builtIn = owners.find((o) => o.kind === 'builtIn')
  if (builtIn !== undefined) return `${toDisplay(key)} is built in: ${builtIn.label}. Pick a different key.`
  if (!isUsableKey(key)) return `${toDisplay(key)} needs ⌘ or ⌃. Pick a different key.`
  return null
}

function HotkeyCommandRow({ id, ctx }: { id: HotkeyId; ctx: SettingsCtx }) {
  const command = hotkeyCommand(id)
  const overrides = ctx.settings.hotkeys
  const current = keyFor(id, overrides)
  const changed = overrides[id] !== undefined
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
      const owners = ownersOf(heard.key, overrides, systemKeysOf(ctx), BUILT_IN_KEYS)
      const refused = refusal(id, heard.key, owners)
      if (refused !== null) return setMode({ kind: 'recording', refused })
      const other = owners.find((o): o is Extract<HotkeyOwner, { kind: 'command' }> => o.kind === 'command' && o.id !== id)
      setMode({ kind: 'confirm', pending: other === undefined ? { kind: 'save', key: heard.key } : { kind: 'move', key: heard.key, from: other.id } })
    },
    () => setMode({ kind: 'idle' }),
  )

  const askReset = (): void => {
    const def = command.key
    const holder = def === null ? undefined : HOTKEY_COMMANDS.find((c) => c.id !== id && sameKey(keyFor(c.id, overrides), def))
    setMode({ kind: 'confirm', pending: { kind: 'reset', from: holder?.id ?? null } })
  }

  /** The pop-up's words (D6): its question, the key the command will have, what else changes, and its button. */
  const confirmSheet = (pending: Pending): { title: string; to: string | null; lines: string[]; yes: string; apply: () => void; careful: boolean } => {
    switch (pending.kind) {
      case 'save': {
        const careful = losesMacStandard(id, overrides) && !sameKey(pending.key, command.key)
        return { title: `Change the key for ${command.label}?`, to: pending.key, lines: careful ? [macStandardLine(id)] : [], yes: careful ? 'Change anyway' : 'Save', careful, apply: () => write(withKey(overrides, id, pending.key)) }
      }
      case 'move': {
        const from = hotkeyCommand(pending.from)
        const careful = losesMacStandard(pending.from, overrides) || (losesMacStandard(id, overrides) && !sameKey(pending.key, command.key))
        const lines = [`${toDisplay(pending.key)} is ${from.label} now. It will lose its key.`, ...(losesMacStandard(pending.from, overrides) ? [macStandardLine(pending.from)] : []), ...(losesMacStandard(id, overrides) && !sameKey(pending.key, command.key) ? [macStandardLine(id)] : [])]
        return { title: `Change the key for ${command.label}?`, to: pending.key, lines, yes: careful ? 'Move anyway' : 'Move it here', careful, apply: () => write(withKey(withKey(overrides, pending.from, null), id, pending.key)) }
      }
      case 'remove': {
        const careful = losesMacStandard(id, overrides)
        return { title: `Remove the key from ${command.label}?`, to: null, lines: careful ? [macStandardLine(id)] : [], yes: 'Remove', careful, apply: () => write(withKey(overrides, id, null)) }
      }
      case 'reset': {
        const lines = pending.from === null ? [] : [`${toDisplay(command.key)} is ${hotkeyCommand(pending.from).label} now. It will lose its key.`]
        const apply = () => write(withKey(pending.from === null ? overrides : withKey(overrides, pending.from, null), id, command.key))
        return { title: `Reset ${command.label}?`, to: command.key, lines, yes: 'Reset', careful: false, apply }
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
      <ConfirmSheet labelId={`hotkey-confirm-${id}`} text={sheet.title} confirmLabel={sheet.yes} danger={sheet.careful} focusConfirm={!sheet.careful} keys="contained" onConfirm={sheet.apply} onCancel={cancel}>
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
            aria-label={recording ? `Press new keys for ${command.label}` : `${command.label}: ${shown(current)}. Change`}
            onClick={() => setMode(recording ? { kind: 'idle' } : { kind: 'recording', refused: null })}
          >
            {recording ? 'Press new keys…' : shown(current)}
          </button>
          {changed && mode.kind === 'idle' && (
            <button type="button" className="hotkeys__link" aria-label={`Reset ${command.label}`} onClick={askReset}>
              Reset
            </button>
          )}
        </span>
        <span className="hotkeys__label hotkeys__label--command">
          {command.label}
          {command.hint !== undefined && <span className="hotkeys__hint"> — {command.hint}</span>}
        </span>
      </div>
      {below}
    </div>
  )
}

// ---------- reset all ----------

/** "Reset all hotkeys" (D7): there only with a change, and it asks in the app's confirm sheet first. */
function ResetAllHotkeys({ ctx }: { ctx: SettingsCtx }) {
  const [asking, setAsking] = useState(false)
  const changes = HOTKEY_COMMANDS.filter((c) => ctx.settings.hotkeys[c.id] !== undefined)
  const n = changes.length
  const plural = n === 1 ? 'hotkey' : 'hotkeys'
  return (
    <div className="hotkeys__reset-all">
      <button type="button" className="settings__option" onClick={() => setAsking(true)}>
        Reset all hotkeys
      </button>
      {asking && (
        <ConfirmSheet
          labelId="confirm-reset-hotkeys-text"
          text={`Reset ${n} changed ${plural}?`}
          confirmLabel={`Reset ${n} ${plural}`}
          keys="contained"
          onConfirm={() => {
            setAsking(false)
            ctx.onChange({ ...ctx.settings, hotkeys: {} })
          }}
          onCancel={() => setAsking(false)}
        >
          <ul className="hotkeys__changes">
            {changes.map((c) => (
              <li key={c.id}>
                {c.label}: {shown(keyFor(c.id, ctx.settings.hotkeys))} → {shown(c.key)}
              </li>
            ))}
          </ul>
        </ConfirmSheet>
      )}
    </div>
  )
}

// ---------- "Press keys to search" ----------

/** The one-line answer for a key (D5): who owns it, and whether the user can do anything about it. */
export function keyAnswer(key: string, overrides: HotkeyOverrides, systemKeys: readonly SystemHotkey[]): string {
  const d = toDisplay(key)
  const owners = ownersOf(key, overrides, systemKeys, BUILT_IN_KEYS)
  const macos = owners.find((o) => o.kind === 'macos')
  if (macos !== undefined) return `${d}: macOS uses it for ${macos.label}. You can't use it.`
  const command = owners.find((o) => o.kind === 'command')
  if (command !== undefined) return `${d}: ${command.label}. You can change it.`
  const builtIn = owners.find((o) => o.kind === 'builtIn')
  if (builtIn !== undefined) return `${d}: ${builtIn.label}. It is built in.`
  if (!isUsableKey(key)) return `${d} needs ⌘ or ⌃ to be a hotkey.`
  return `${d} is free. You can use it.`
}

/**
 * The search bar at the top of Settings › Hotkeys (D5): a text box that filters the page (`query`, `onQuery`),
 * and a button that records ONE key, puts it in that box and shows the answer while that query stands
 * (`answering`). Esc in the box clears it (the dialog's layered Esc); Esc while recording stops the recording,
 * and nothing else hears the key.
 */
export function KeySearch({ ctx, query, answering, onQuery }: { ctx: SettingsCtx; query: string; answering: boolean; onQuery: (query: string, pressed: boolean) => void }) {
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
    </div>
  )
}

// ---------- the rows ----------

/** A stable row id from a label (never the key, which can change): 'Close the review…' → 'close-the-review'. */
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

function builtInItems(group: string, entries: readonly HotkeyEntry[]): SettingDef[] {
  const seen = new Map<string, number>()
  return entries.map(({ keys, label }) => {
    const base = slug(shortLabel(label))
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { id: `hotkey-${group}-${base}${n === 0 ? '' : `-${n + 1}`}`, label, keywords: [keys, ...ROW_KEYWORDS], bare: true, render: () => fixedRow(keys, label) }
  })
}

const commandItem = (id: HotkeyId): SettingDef => ({
  id: `hotkey-${id}`,
  label: hotkeyCommand(id).label,
  // A bare row shows no hint: this is its search text — the key as it is NOW (the dialog rebuilds the
  // candidates when a key changes) and the command's own hint.
  hint: ({ settings }) => [shown(keyFor(id, settings.hotkeys)), hotkeyCommand(id).hint].filter(Boolean).join(' '),
  keywords: ROW_KEYWORDS,
  bare: true,
  render: (ctx) => <HotkeyCommandRow id={id} ctx={ctx} />,
})

/** A "Used by macOS" row (D3): there while this Mac has the key, with its key as this Mac has it. */
const macosItem = (label: string): SettingDef => {
  const row = (ctx: SettingsCtx) => ctx.systemHotkeys?.find((r) => r.label === label)
  return {
    id: `hotkey-macos-${slug(label)}`,
    label,
    hint: (ctx) => {
      const r = row(ctx)
      return r === undefined ? '' : `${toDisplay(r.accelerator)}${r.changedOnThisMac === true ? ' you set it on this Mac' : ''}`
    },
    keywords: ['macos', ...ROW_KEYWORDS],
    bare: true,
    available: (ctx) => row(ctx) !== undefined,
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

const groupId = (g: (typeof HOTKEY_GROUPS)[number]): string => g.id ?? g.title.toLowerCase()

const groups: SettingsGroup[] = HOTKEY_GROUPS.map((g) => ({
  title: g.title,
  // The Window group starts with the keys the user can change (D8).
  items: [...(g.title === 'Window' ? HOTKEY_COMMANDS.map((c) => commandItem(c.id)) : []), ...builtInItems(groupId(g), g.entries)],
}))

export const HOTKEYS_SECTION: SettingsSection = {
  id: 'hotkeys',
  title: 'Hotkeys',
  standalone: true,
  groups: [
    ...groups,
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
          available: (ctx) => Object.keys(ctx.settings.hotkeys).length > 0,
          render: (ctx) => <ResetAllHotkeys ctx={ctx} />,
        },
      ],
    },
  ],
}
