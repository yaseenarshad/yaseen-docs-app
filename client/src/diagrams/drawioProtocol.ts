/**
 * The draw.io EMBED PROTOCOL as this app speaks it (Draw's 🔒 YAZ-1802 D4, ported by YAZ-3028 D5) — pure, so the rules test
 * without an iframe. `DrawioEditor` is the only caller.
 *
 * The editor is jgraph's own webapp on its own origin, `app://drawio` (main serves it, see
 * `desktop/src/main/drawio/assets.ts`). The renderer and the iframe talk ONLY by postMessage, in
 * draw.io's `proto=json` dialect: every message is a JSON STRING. A message counts only when it
 * comes from THAT iframe's window AND from `DRAWIO_ORIGIN` — anything else on `window` is ignored.
 *
 * The conversation, in order:
 *   iframe → `{ event: 'yaseenReady' }`  our PostConfig.js has patched draw.io (D12a / D12b)
 *   iframe → `{ event: 'configure' }`    → host `{ action: 'configure', config }` (after yaseenReady)
 *   iframe → `{ event: 'init' }`         → host `{ action: 'load', xml, autosave: 1 }`
 *   iframe → `{ event: 'load', xml }`    the document is on screen: the autosave baseline
 *   iframe → `{ event: 'autosave', xml }` on every change; `{ event: 'save', xml }` on ⌘S
 * and, from the host at any time: `{ action: 'load', …, yaseenKeepView: true }` again (an outside
 * change on a clean tab; our PostConfig.js keeps the page, the zoom and the scroll — YAZ-3420 D2),
 * `{ action: 'invokeAction', actionName: 'darkMode' | 'lightMode' }` (the app's theme, live) and
 * `{ action: 'yaseenAdaptiveColors', value }` (the dark-mode colour setting, live — ours, answered
 * by our PostConfig.js, because draw.io has no embed action for it).
 * From the iframe at any time: `{ event: 'shortcut', command: 'toggleSidebar' }` — an APP shortcut
 * pressed inside draw.io, where the host page never sees the key (see `DrawioMessage`).
 */
import { DRAWIO_ORIGIN } from '@shared/drawio'
import { HOTKEY_COMMANDS, appKeyId, drawioChordFor, keyFor, parseAccelerator, toAccelerator, type DrawioChord, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { keyRow, keysOf, stepsAside, type HotkeyAside } from '@shared/keys'
import { DIAGRAM_ACTIONS, DIAGRAM_EXTRA_CODES, DIAGRAM_KEYS } from '@shared/keys/diagram'
import type { DiagramDarkColors } from '@shared/types'

/**
 * 🔒 YAZ-1802 D16: the app's "draw.io diagrams in dark mode" setting as draw.io's own
 * `Graph.defaultAdaptiveColors` — `auto` re-colours a diagram for dark mode, `none` keeps its
 * colours. It is the default a file's own `adaptiveColors` attribute overrides.
 */
export function drawioAdaptiveColors(setting: DiagramDarkColors): 'auto' | 'none' {
  return setting === 'adapt' ? 'auto' : 'none'
}

/**
 * The iframe URL (🔒 YAZ-1802 D4): embed mode over JSON, configured by us, no save or exit button
 * (autosave is the save), and every door to the network shut — `offline`, `stealth`, `lockdown`,
 * no plugins, no PWA, no Google / Dropbox / OneDrive / GitHub / GitLab / Trello. `pv=0` keeps the
 * page view off (D12); `dark` is the app's theme at mount, later changes go by message. `lang=en`:
 * the bundled draw.io carries English only (🔒 YAZ-1802 D5) — without it draw.io would follow the
 * system language and ask for a translation the app does not ship.
 */
export function drawioFrameUrl(theme: 'light' | 'dark'): string {
  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    configure: '1',
    spin: '1',
    noSaveBtn: '1',
    noExitBtn: '1',
    saveAndExit: '0',
    offline: '1',
    stealth: '1',
    lockdown: '1',
    plugins: '0',
    pwa: '0',
    gapi: '0',
    db: '0',
    od: '0',
    gh: '0',
    gl: '0',
    tr: '0',
    pv: '0',
    dark: theme === 'dark' ? '1' : '0',
    ui: 'simple',
    lang: 'en',
  })
  return `${DRAWIO_ORIGIN}/index.html?${params.toString()}`
}

/**
 * Excalidraw's open-colour palette as the colour dialog's grid (🔒 YAZ-1802 D12a): draw.io lays
 * `defaultColors` out twelve to a row, so each row is one shade across the twelve families (gray,
 * red, pink, grape, violet, blue, cyan, teal, green, yellow, orange, bronze), lightest first, and
 * each column one family.
 */
const OPEN_COLOUR_GRID = [
  'F8F9FA', 'FFF5F5', 'FFF0F6', 'F8F0FC', 'F3F0FF', 'E7F5FF', 'E3FAFC', 'E6FCF5', 'EBFBEE', 'FFF9DB', 'FFF4E6', 'F8F1EE',
  'E9ECEF', 'FFC9C9', 'FCC2D7', 'EEBEFA', 'D0BFFF', 'A5D8FF', '99E9F2', '96F2D7', 'B2F2BB', 'FFEC99', 'FFD8A8', 'EADDD7',
  'CED4DA', 'FF8787', 'F783AC', 'DA77F2', '9775FA', '4DABF7', '3BC9DB', '38D9A9', '69DB7C', 'FFD43B', 'FFA94D', 'D2BAB0',
  '868E96', 'FA5252', 'E64980', 'BE4BDB', '7950F2', '228BE6', '15AABF', '12B886', '40C057', 'FAB005', 'FD7E14', 'A18072',
  '343A40', 'E03131', 'C2255C', '9C36B5', '6741D9', '1971C2', '0C8599', '099268', '2F9E44', 'F08C00', 'E8590C', '846358',
]

/**
 * One entry of draw.io's `keyboardShortcuts` config, as `EditorUi.installKeyboardShortcut` reads it: `control` is
 * ⌘ or ⌃, `action` a named draw.io action, null to clear the key. Our PostConfig.js reads two more kinds itself
 * (YAZ-3564): `yaseenUnlabel` (an action with no key now loses its shown key, K12) and `yaseenMacCtrl` (a ⌃ key on
 * a Mac, which draw.io's own table cannot hold apart from ⌘, K15; `cmd` is ⌘ held with it).
 */
export type DrawioShortcut =
  | { keyCode: number | string; control?: true; shift?: true; alt?: true; action: string | null }
  | { yaseenUnlabel: string }
  | { yaseenMacCtrl: true; keyCode: number; cmd?: true; shift?: true; alt?: true; action: string }

/**
 * 🔒 YAZ-1802 D12b, the NO-SELECTION half of the keymap (PostConfig.js has the selection half):
 * Excalidraw's tool letters on draw.io's own insert actions, and draw.io's clashing S (note) and
 * F (ellipse — Excalidraw's F is the frame tool, which draw.io has not got) cleared. X already is
 * draw.io's freehand pen. The last key bound is the one draw.io shows, so A and P come last.
 * These are the app's defaults on draw.io's table: the `diagram.*` rows (`shared/keys/diagram.ts`) say the
 * same, and `tools/drawioOverlay.test.mjs` checks the two against the pinned bundle.
 */
const TOOL_KEYS: readonly DrawioShortcut[] = [
  { keyCode: 'R', action: 'insertRectangle' },
  { keyCode: 'O', action: 'insertEllipse' },
  { keyCode: 'T', action: 'insertText' },
  { keyCode: 'D', action: 'insertEdge' },
  { keyCode: 'L', action: 'insertEdge' },
  { keyCode: 'A', action: 'insertEdge' },
  { keyCode: 'W', action: 'insertFreehand' },
  { keyCode: 'P', action: 'insertFreehand' },
  { keyCode: 'S', action: null },
  { keyCode: 'F', action: null },
  { keyCode: 220, control: true, action: 'removeFormat' }, // ⌘\ clears the formatting
  { keyCode: 88, control: true, shift: true, action: 'yaseenStrikethrough' }, // ⌘⇧X, PostConfig.js's action
]

/** A key as draw.io's table holds it: the keyCode and the modifiers, `control` for ⌘ or ⌃; null for a key it cannot name. */
export interface DrawioKey {
  keyCode: number
  control?: true
  shift?: true
  alt?: true
}

/**
 * `accelerator` as draw.io's table holds it. `drawioChordFor` knows the keyCodes of a ⌘ key, so a key without ⌘
 * asks it for the same key with ⌘ and drops the `control` again.
 */
export function drawioKeyOf(accelerator: string): DrawioKey | null {
  const chord = parseAccelerator(accelerator)
  if (chord === null) return null
  const found = drawioChordFor(toAccelerator({ ...chord, cmd: true, ctrl: false }), false)
  if (found === null) return null
  const { keyCode, shift, alt } = found
  return { keyCode, ...(chord.cmd || chord.ctrl ? { control: true as const } : {}), ...(shift ? { shift } : {}), ...(alt ? { alt } : {}) }
}

/**
 * The user's diagram keys (YAZ-3564 K4): each changed row clears its default keys (and their other codes,
 * `DIAGRAM_EXTRA_CODES`) and binds its new key to its action. Every clear comes before every bind, so a key one
 * row gave up can go to another. A row with no key now takes its shown key off its action (K12): draw.io sets
 * an action's `.shortcut` only when it binds one. On a Mac a ⌃ key goes to PostConfig.js's own table (K15).
 */
function diagramKeys(hotkeys: HotkeyOverrides, mac: boolean): DrawioShortcut[] {
  const clears: DrawioShortcut[] = []
  const binds: DrawioShortcut[] = []
  const unlabels: DrawioShortcut[] = []
  for (const row of DIAGRAM_KEYS) {
    const action = DIAGRAM_ACTIONS[row.id]
    if (!row.changeable || action === undefined) continue
    const now = keysOf(row, hotkeys)
    if (hotkeys[row.id] !== undefined) {
      for (const key of row.keys) {
        const k = drawioKeyOf(key)
        if (k === null) continue
        for (const keyCode of [k.keyCode, ...(DIAGRAM_EXTRA_CODES[row.id] ?? [])]) clears.push({ ...k, keyCode, action: null })
      }
      for (const key of now) {
        const k = drawioKeyOf(key)
        const chord = parseAccelerator(key)
        if (k === null || chord === null) continue
        if (mac && chord.ctrl) {
          binds.push({ yaseenMacCtrl: true, keyCode: k.keyCode, ...(chord.cmd ? { cmd: true as const } : {}), ...(k.shift ? { shift: k.shift } : {}), ...(k.alt ? { alt: k.alt } : {}), action })
        } else binds.push({ ...k, action })
      }
    }
    if (now.length === 0) unlabels.push({ yaseenUnlabel: action })
  }
  return [...clears, ...binds, ...unlabels]
}

/**
 * draw.io's own bindings on chords the app's MENU owns (`desktop/src/main/menu.ts`), cleared so the
 * menu gets them everywhere: off macOS the page sees a key before the menu does. The FIXED ones are here:
 * ⌘0 and every code draw.io reads as plus or minus; ⌘⇧E ⌘⇧L; ⌘⇧[ / ⌘⇧] (tabs, draw.io's font size); ⌘⇧S
 * (draw.io's Save As — the app has none, and Export Excalidraw Drawing… is greyed on a diagram).
 */
const FIXED_MENU_CHORDS: readonly DrawioChord[] = [
  ...[48, 61, 107, 187, 222, 109, 173, 189].map((keyCode): DrawioChord => ({ keyCode, control: true, action: null })),
  ...[69, 76, 219, 221, 83].map((keyCode): DrawioChord => ({ keyCode, control: true, shift: true, action: null })),
]

/**
 * The menu items whose key the user can change (YAZ-3397 D2): ⌘K ⌘, ⌘T ⌘W ⌘O, ⌘⇧O ⌘⇧N ⌘⇧W ⌘⇧M and the tab
 * keys as they ship. Not Toggle sidebar or Copy path (`rendererOwned`), whose keys the renderer owns (ours,
 * not draw.io's to clear).
 */
const MENU_COMMANDS = HOTKEY_COMMANDS.filter((c) => c.rendererOwned !== true).map((c) => c.id)

/**
 * Every menu chord draw.io must let through: the fixed ones, and the changeable ones as they are NOW
 * (YAZ-3397 D2). Read at `configure`, so a key changed while a diagram is open reaches it the next time it opens.
 * A key that lets diagrams keep it (YAZ-3564 K9) is off the menu on a diagram tab, so draw.io keeps its own.
 */
function menuChords(hotkeys: HotkeyOverrides, aside: HotkeyAside, mac: boolean): DrawioChord[] {
  const changeable = MENU_COMMANDS.flatMap((id) => {
    const row = keyRow(appKeyId(id))
    const chord = row !== undefined && stepsAside(row, 'diagram', aside) ? null : drawioChordFor(keyFor(id, hotkeys), mac)
    return chord === null ? [] : [chord]
  })
  return [...FIXED_MENU_CHORDS, ...changeable]
}

/**
 * The `configure` reply (🔒 YAZ-1802 D3 / D12a / D12b). Every key is one draw.io v31.5.2 reads in
 * `Editor.configure` (in the pinned `js/app.min.js`), and every action name one it defines or our
 * PostConfig.js adds (`yaseen…`; `tools/drawioOverlay.test.mjs` checks the pinned bundle). Fonts are NOT here: their
 * `@font-face` sheet lives on the drawio origin and our PostConfig.js hands it to
 * `Editor.configureFontCss` itself, so the host never needs to know the files. `hotkeys` and `aside` are the
 * user's key changes and step-aside switches (YAZ-3564 K2, K9); `mac` whether ⌃ and ⌘ are two keys (K15).
 */
export function drawioConfig(darkColors: DiagramDarkColors, hotkeys: HotkeyOverrides = {}, aside: HotkeyAside = {}, mac = true): Record<string, unknown> {
  return {
    // D3: plain, uncompressed XML on every save (sets Editor.compressXml and defaultCompressed).
    compressXml: false,
    // D16: the dark-mode colour setting at startup; a change afterwards goes by `yaseenAdaptiveColors`.
    defaultAdaptiveColors: drawioAdaptiveColors(darkColors),
    // D12a: page view and grid off for anything new. Alignment guides start off the same way — a new
    // diagram is born `guides="0"` (Excalidraw's "object snap" off) — but stay a per-diagram toggle
    // (View › Guides), like the grid; connection snapping and arrow binding stay draw.io's own.
    defaultPageVisible: false,
    defaultGridEnabled: false,
    zoomWheel: false,
    compact: true,
    enableInlineToolbar: true,
    // D12a: 2 px lines, 8 px corners (16 on the absolute arc scale), Assistant — Excalidraw's look.
    defaultVertexStyle: { strokeWidth: 2, rounded: 1, absoluteArcSize: 1, arcSize: 16, fontFamily: 'Assistant' },
    defaultEdgeStyle: { strokeWidth: 2, fontFamily: 'Assistant' },
    defaultFonts: ['Assistant', 'Inter', 'Roboto', 'IBM Plex Mono', 'Liberation Serif'],
    // Excalidraw's quick picks: transparent, black and its four stroke colours, its four backgrounds.
    presetColors: ['none', '1E1E1E', 'E03131', '2F9E44', '1971C2', 'F08C00', 'FFC9C9', 'B2F2BB', 'A5D8FF', 'FFEC99'],
    defaultColors: [...OPEN_COLOUR_GRID, 'none', 'FFFFFF', '1E1E1E'],
    // The app's defaults, the user's diagram keys (K4), then the menu's chords: the menu fires first (K3).
    keyboardShortcuts: [...TOOL_KEYS, ...diagramKeys(hotkeys, mac), ...menuChords(hotkeys, aside, mac)],
  }
}

/**
 * Every message the iframe sends that the host acts on. `shortcut` is draw.io's own event for a
 * chord the host claims; our PostConfig.js sends it. Only a RENDERER-owned chord needs it — a menu
 * accelerator fires whatever frame has focus — and of those only ⌘B means something in a diagram:
 * the sidebar toggle with nothing selected (with a selection it stays draw.io's bold).
 */
export type DrawioMessage =
  | { event: 'yaseenReady' }
  | { event: 'configure' }
  | { event: 'init' }
  | { event: 'load'; xml?: string }
  | { event: 'autosave'; xml: string }
  | { event: 'save'; xml: string }

/**
 * One `message` event, if it is the iframe speaking: the right window, the right origin, a JSON
 * string, an event we know. Everything else — another frame, a devtools poke, draw.io's own
 * `exit` or an unknown event — is null and ignored.
 */
export function readDrawioMessage(ev: { source: unknown; origin: string; data: unknown }, frame: unknown): DrawioMessage | null {
  if (frame == null || ev.source !== frame || ev.origin !== DRAWIO_ORIGIN || typeof ev.data !== 'string') return null
  let msg: unknown
  try {
    msg = JSON.parse(ev.data)
  } catch {
    return null
  }
  if (typeof msg !== 'object' || msg === null) return null
  const { event, xml, command } = msg as Record<string, unknown>
  switch (event) {
    case 'yaseenReady':
    case 'configure':
    case 'init':
      return { event }
    case 'load':
      return typeof xml === 'string' ? { event, xml } : { event }
    case 'autosave':
    case 'save':
      return typeof xml === 'string' ? { event, xml } : null
    default:
      return null
  }
}
