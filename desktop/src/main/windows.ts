/**
 * The window manager (GRO-2160): creates windows from `AppState.windows`, keeps their bounds
 * current, brings back at launch the ones that were asked for or that the setting names
 * (YAZ-2589), and never lets one die with unsaved edits (the `app:flush` → `app:flushed`
 * handshake). Electron-free — `main/index.ts` injects the `BrowserWindow` factory and display
 * geometry as a `WindowHost` — so everything here runs under vitest with fakes.
 */
import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { fileKind } from '@shared/fileKind'
import { DEFAULT_SIDEBAR_LENS, FILES_WINDOW_DEFAULT_H, FILES_WINDOW_DEFAULT_W, FILES_WINDOW_WIDE_W, defaultRightPanelIdentity, normalizeFilesZoom, normalizeRoots, rootOfPath, sameVaults, stripSlash, type FilesAction, type FilesPreviewRequest, type OpenSetResult, type OpenWindowOptions, type PageView, type PopOutCarry, type RecentRoots, type ScreenPoint, type Session, type StartView, type StartupWindows, type TabAction, type TabRef, type TearOffResult, type WindowBounds, type WindowEntry } from '@shared/types'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import type { Store } from './store'
import { appZoomFactor } from './appZoom'

export interface WindowLike {
  webContents: { id: number }
}

/**
 * Which `AppState.windows` entry a renderer belongs to, keyed by `webContents.id`, so IPC
 * handlers can resolve their caller (`window.identity()` etc.). The lookup deliberately
 * knows nothing about Electron beyond the id.
 */
export interface WindowLookup {
  idFor(webContents: { id: number }): string | undefined
}

const byWebContents = new Map<number, string>()

/** Maps `win` to the state entry `id`; returns the unregister function (call it on `closed`). */
export function register(win: WindowLike, id: string): () => void {
  const wcId = win.webContents.id
  byWebContents.set(wcId, id)
  return () => {
    if (byWebContents.get(wcId) === id) byWebContents.delete(wcId)
  }
}

export function idFor(webContents: { id: number }): string | undefined {
  return byWebContents.get(webContents.id)
}

/** A hung save can never block close or quit: the flush handshake gives up after this long. */
export const FLUSH_TIMEOUT_MS = 5000
/** `move`/`resize` fire for every pixel of a drag; one store commit (= one `state:changed` broadcast) per burst. */
export const BOUNDS_DEBOUNCE_MS = 250
/** `duplicateWindow` offsets the copy so it does not sit exactly on its source. */
export const WINDOW_CASCADE_PX = 24
/**
 * Where the first tab's middle sits in a window whose sidebar is hidden (YAZ-3637 D3), from the window's top left: the
 * title bar (28 px) and half the 44 px tab row down; the nav buttons (show sidebar, ◀ ▶, the grid: 8 + 4 × 28 + gaps),
 * the strip's 8 px and half a tab across. A torn-off window stands so its tab lands under the pointer: the demo showed
 * it there (S1, S16). A window that MOVES with its only tab (D5) keeps its sidebar, so there the tab lands about one
 * sidebar width right of the pointer.
 */
export const TEAR_OFF_GRAB: ScreenPoint = { x: 190, y: 50 }

const DEFAULT_BOUNDS: WindowBounds = { x: 100, y: 100, width: 1200, height: 800 }

/** The slice of `BrowserWindow` the manager drives; a test fake implements it in a few lines. */
export interface ManagedWindow {
  webContents: { id: number; send(channel: string, ...args: unknown[]): void }
  getBounds(): WindowBounds
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  focus(): void
  /** Like Electron's: shows a window built hidden (YAZ-3343, the tab board's windows). */
  show(): void
  /** Like Electron's: emits `close` first — the manager intercepts it to run the flush handshake. */
  close(): void
  /** Like Electron's: destroys without emitting `close` (`closed` still fires). */
  destroy(): void
  /** Like Electron's: orders the window to the front WITHOUT focusing it (YAZ-3357 D7, a Files window's preview click). */
  moveTop(): void
  /** Like Electron's: `animate` animates the change on macOS. A Files window grows for the board at once, never animated (YAZ-3357 D10). */
  setBounds(bounds: WindowBounds, animate?: boolean): void
  /** Like Electron's: the page area's bounds on screen, the title bar left out (YAZ-3357 D9, the preview's row height). */
  getContentBounds(): WindowBounds
  on(event: 'move' | 'resize' | 'closed' | 'focus' | 'minimize' | 'restore', listener: () => void): unknown
  on(event: 'close', listener: (e: { preventDefault(): void }) => void): unknown
}

/** The Electron-only half, injected by `main/index.ts`: window construction and display geometry. */
export interface WindowHost {
  /**
   * Builds the `BrowserWindow` at `entry.bounds` and loads `<renderer>?win=<entry.id>`. With `hidden` (YAZ-3343, a window
   * the tab board made) it is built and loaded but NOT shown: it shows when the board shows it (`showWindow`).
   */
  create(entry: WindowEntry, opts?: { hidden: true }): ManagedWindow
  /** Every display's workArea, primary first (`clampBounds` keeps the earliest area on ties). */
  workAreas(): WindowBounds[]
  /** Where the pointer is on the screen (YAZ-3637 D1): a drag that ended with no point is let go there. */
  cursorPoint(): ScreenPoint
  /** Whether `path` exists as a regular file — `routeToFile` (E1) probes before opening anything, and `rootFor` before it counts the path as asked for (YAZ-2589 A6). */
  exists(path: string): boolean
  /** Whether `path` exists as a directory — `openRecentBeside` probes before touching the MRU (GRO-2211, moved here by YAZ-1767), and `routeToFile` asks it first: a folder goes to that door (YAZ-2556 D1). */
  dirExists(path: string): boolean
  /**
   * The floating preview popup of the Files window `win` (YAZ-3357 D9): shown INACTIVE at `bounds` (no focus, so the
   * arrow keys keep browsing), or hidden with null — never closed: the renderer reuses it. No popup yet: nothing.
   */
  showPreview(win: ManagedWindow, bounds: WindowBounds | null): void
}

export interface WindowManager extends WindowLookup {
  /**
   * The stored windows that come back at launch (YAZ-2589), bounds clamped: those on the vaults in
   * `which` (a launch that asked for them, D1), or what the setting says (D2): every one, those of
   * the vault used last, or none. A window that does not come back is forgotten (D3). When the
   * setting brings back nothing, a single Welcome window opens.
   */
  restore(which: readonly string[] | StartupWindows): void
  /** The vault that a path from outside belongs to (YAZ-2589 D1): the folder itself, or the root `resolveLinkTarget` picks for a file. `null` for a path that cannot open (A6): `routeToFile` answers it with a notice, so it is not a request for a vault. */
  rootFor(path: string, rootOverride?: string | null): string | null
  /** D6 plumbing: an independent window on `root`/`file` (the gestures land in D-). A window on a vault bumps it in the MRU (YAZ-2555 D5). */
  openWindow(opts: OpenWindowOptions): void
  /**
   * ⌘⇧N (GRO-2167; YAZ-3343 D35 replaced YAZ-2951 D5's copy of the tabs): a window on every vault of `from`,
   * cascaded, fresh id, with NO tab — it boots on the blank tab with the caret in the search (`startEmpty`), as ⌘T.
   * The sidebar's state (shown or hidden, the lens) comes along by value; the right panel starts empty.
   */
  duplicateWindow(from: WindowEntry): void
  /**
   * A tab's "Move to new window" (YAZ-2933 D1, D3, D5): `from`'s vaults (by value) and lens, ONE tab `path`, the
   * sidebar hidden, the right panel closed and empty, cascaded bounds, fresh id. No MRU bump, as `duplicateWindow`.
   * `carry.view` is the page's view (YAZ-2951 D2), handed to the new window once (`takeStartView`). `carry.name` is the tab's
   * display name: stored with the new window's one tab (YAZ-3057 D3), so a reload and a restart keep it.
   * `bounds` = where a torn-off tab's window goes (YAZ-3637 D3); absent = cascaded.
   */
  popOut(from: WindowEntry, path: string, carry?: PopOutCarry, bounds?: WindowBounds): void
  /**
   * A tab of `from`'s strip let go where no surface took it (YAZ-3637 D1, D3, D5), at `point` on the screen (0,0 = no
   * point: the pointer's place now). On a window that shows — live, not hidden, not in the Dock — it is `none`: that
   * window took the drop or refused it, and nothing opens. Off every window, a window opens there as `popOut` does, as
   * big as the source, the tab under the pointer (`TEAR_OFF_GRAB`), clamped to the display: `opened`. With `alone` —
   * the caller's only tab, nothing else open — the caller itself moves there instead, no reload: `moved`.
   */
  tearOff(from: WindowEntry, path: string, carry: PopOutCarry, point: ScreenPoint, alone: boolean): TearOffResult
  /**
   * A tab's "Move to ▸ <window>" (YAZ-3091 D1, D2): raise the live window `to` and push `link:take-tab` with
   * `path` and `carry`, held like any link push until its page listens. `false` = `to` is not live, or none of
   * its vaults holds `path` (D2): no vault is added. Nothing is stored here: the target stores its own new tab.
   */
  moveTo(to: string, path: string, carry?: PopOutCarry): boolean
  /**
   * A card of another window on the tab board (YAZ-3343 D3): raise the live window `to` and push `link:focus-tab`
   * with `ref`, held like any link push until its page listens. `false` = `to` is not live. The target finds the tab itself.
   */
  focusTab(to: string, ref: TabRef): boolean
  /** The ✕ of another window's cards (YAZ-3343 D3, D10): push `link:close-tabs` with `refs` to the live window `to`, which closes them itself. No raise. `false` = `to` is not live. */
  closeTabs(to: string, refs: readonly TabRef[]): boolean
  /**
   * A card dropped in another window's frame (YAZ-3343 D13): push `link:send-tab` `{ to, ref }` to the live window
   * `from`, which saves the tab and sends it with `window:move-to`, as "Move to ▸" does. `false` = either window
   * is not live, they are the same window, or `to` shows no vault of `ref.path` (the `moveTo` rule). No raise, here or
   * after: `from` sends it as a QUIET move (`background`), which `moveTo` does not raise. With `at` (YAZ-3637 D4, a tab
   * dropped on `to`'s strip) `from` sends it loud, to that slot; with `background` too (YAZ-3808 6H, a tab board card
   * let go on `to`'s strip), quietly, to that slot.
   */
  moveTab(from: string, to: string, ref: TabRef, at?: number, background?: boolean): boolean
  /** Name the live window `id` (YAZ-3343 D14), or `null` for its automatic label: `store.setWindowName`. `false` = `id` is not live. */
  setName(id: string, name: string | null): boolean
  /** The board's highlight on window `to`'s card (YAZ-3343): it lights that tab in its strip; `null` puts it out. Dropped when `to` is not live. */
  highlightTab(to: string, ref: TabRef | null): void
  /** A card menu's tab action on window `to`'s tab (YAZ-3343): push `link:tab-action`; "Show in sidebar" raises `to` too. `false` = not live. */
  tabAction(to: string, ref: TabRef, action: TabAction): boolean
  /** A hidden window the tab board made (YAZ-3343): show it and focus it. `false` = not live. */
  showWindow(id: string): boolean
  /** The live windows built hidden and not shown yet (YAZ-3343). In memory only: a restart shows every window. */
  hiddenWindows(): string[]
  /** The live windows minimized in the Dock now (YAZ-3343). In memory only. */
  minimizedWindows(): string[]
  /** "Move to new window" on another window's card (YAZ-3343): push `link:pop-out-tab` to the live window `from`, which moves its own tab quietly. `false` = not live. */
  popOutTab(from: string, ref: TabRef): boolean
  /** The vault chip of an empty frame (YAZ-3343): push `link:set-roots` to the live window `id` with NO tab. `false` = not live, or it has a tab. */
  setRoots(id: string, roots: readonly string[]): boolean
  /**
   * A tab board's Add on a card dropped in window `to`, which lacks the card's vault (YAZ-3808 6B): push
   * `link:add-vault-and-take` to `to`, which adds `vault` and takes the tab `ref` of `from`. `false` = either window is
   * not live, they are one window, or `to` is a Files window.
   */
  addVaultAndTake(to: string, vault: string, from: string, ref: TabRef): boolean
  /** "Close window" on another window's frame (YAZ-3343): its REAL close (the flush handshake runs). `false` = `id` is not live. */
  closeOther(id: string): boolean
  /**
   * "New window" from the tab board (YAZ-3343 D22, D23): `duplicateWindow`'s window, built HIDDEN — it shows when the
   * user shows it from the board. No MRU bump. Answers its id.
   */
  openBehind(from: WindowEntry): string
  /**
   * A "Move to ▸" row of window `from` points at window `to` (YAZ-3091 D8): `to` glows, the one lit before goes dark,
   * and `null` puts it out. Never `from` itself, and never a raise. A glow is a moment: it is not held for a page that
   * does not listen yet, and it goes out when `from` or `to` closes.
   */
  highlight(from: string, to: string | null): void
  /**
   * The page view a popped-out window starts with (YAZ-2951 D2), handed out ONE time: its first `window:identity`
   * takes it, so a reload starts fresh (S17). A window that closes before it asks drops it (S20). Never stored.
   */
  takeStartView(id: string): StartView | undefined
  /** A window `duplicateWindow` or `openBehind` opened (YAZ-3343 D22, D35): `true` ONCE, for its first `window:identity`, so it boots with no tab. */
  takeStartEmpty(id: string): boolean
  /** A NEW window (YAZ-3487, demo round 3): its tree starts with every folder closed. Once, as `takeStartEmpty`. */
  takeStartCollapsed(id: string): boolean
  /**
   * The ONE back-end door for "open a recent vault" (YAZ-1767 🔒 D1): the sidebar's vault
   * switcher and App's `openVault` (a vault window's Open Folder… / Open Recent, YAZ-1914) land here via `window:open-recent`, the Window menu's vault rows (⌘1–⌘9, YAZ-2555 D3) call it in main, and so does
   * `routeToFile` for a FOLDER that comes from outside the app (YAZ-2556 D1). Probes
   * the directory FIRST (GRO-2211): a dead folder is pruned from the MRU and opens nothing →
   * `false`. A live one is bumped to the top of the MRU, then (🔒 D9) every live window already
   * on that vault is RAISED — most recently focused on top — and nothing new opens; with none
   * open, a new window opens on the vault, blank (YAZ-3487 D7; it was the remembered `lastFile`, D2). → `true`.
   * `from` (YAZ-3487 D1): the window that asked. When it is EMPTY, it takes the vault itself and no window opens.
   */
  openRecentBeside(path: string, from?: string): boolean
  /**
   * "Open by itself" (YAZ-2858 D1, `window:open-alone`): the `openRecentBeside` door with an EXACT
   * match. It raises only a live window whose vaults are this one vault alone (`sameVaults`); a
   * window that shows it beside another vault does not count and does not change (S1). With none, the
   * empty caller takes it, else a new window opens on it, blank (YAZ-3487 D1, D7). The probe and the MRU bump are the same:
   * a dead folder is pruned and opens nothing → `false`. No saved set changes (S7). `from`: as `openRecentBeside`'s.
   */
  openAlone(path: string, from?: string): boolean
  /**
   * The door for a saved set of vaults (YAZ-2602 D8, `window:open-set`). Probes each folder: the
   * vaults that are left, in the saved order, are what opens, and the ones that are gone come back
   * in `missing` — the saved set itself keeps them, a folder can come back (S66). Every live window
   * whose vaults are EXACTLY the ones left (`sameVaults`: the order does not count) is raised, as
   * `openRecentBeside` raises; with none, the empty caller takes them, else ONE new window opens on them,
   * blank (S65; YAZ-3487 D1, D7). Either way the set becomes the last used. No folder left, or an
   * unknown `id`, opens nothing and changes nothing → `opened: false`.
   */
  openVaultSet(id: string, from?: string): OpenSetResult
  /**
   * `window:close-self` (GRO-2232, e.g. ⌘W on the last tab): the REAL `close()` on the live
   * window — the `close` interception above runs the flush handshake — NEVER a bare destroy.
   * No live window for `id` (mid-close race) is a no-op.
   */
  closeWindow(id: string): void
  /**
   * A path from outside the app — a `yaseendocs://` link, Finder's Open With (files), `open -a`.
   * A FOLDER is "Open Folder…" on it (YAZ-2556 D1): it goes to `openRecentBeside`, trailing slash
   * off, whatever vault contains it and whatever `rootOverride` says. A file (E1, GRO-2171):
   * validate, then `resolveLinkTarget` routes it.
   */
  routeToFile(path: string, rootOverride?: string | null): void
  /** The unobtrusive can't-open surface (E1): un-minimize + focus a live window, send `link:notice`. Never a dialog. With no live window, the Welcome window opens and says it (YAZ-2589 A2). */
  linkNotice(message: string): void
  /** A notice about ONE vault (YAZ-2677 S45): `link:notice` to each live window that shows `root`, held like any link push until its page listens. No window is raised, and none opens for it. */
  vaultNotice(root: string, message: string): void
  /** `link:ready` arrived from this renderer (wired in `ipc/window.ts`): it listens now, so the link pushes held for it go out (YAZ-2589 A2). */
  handleLinkReady(sender: { id: number }): void
  /** `app:flushed` arrived from this renderer (wired in `ipc/window.ts`). */
  handleFlushed(sender: { id: number }): void
  /** `before-quit`: record the vault of the window in front (YAZ-2589 A1), then handshake every window at once (YAZ-2198); `windows[]` is kept, and the next launch brings back what it is asked for. */
  flushAllForQuit(): Promise<void>
  /**
   * A Files window (YAZ-3357 D5, D6) on `root`, or with null on every vault of the window `from`. From a full window it
   * opens flush left of it, as tall, as wide as its sidebar, with its lens; from a Files window, cascaded; with no
   * window, `FILES_WINDOW_DEFAULT_W` × `FILES_WINDOW_DEFAULT_H` at the default spot. All clamped to the screen. The
   * source does not change. `false` = no vault to show (a Welcome window, no window at all). Each width is page px,
   * so the window is that × the App size on the screen (YAZ-3441): its page is as wide as the source's sidebar.
   */
  openFilesWindow(from: string | undefined, root: string | null): boolean
  /**
   * A click in the Files window `from` (YAZ-3357 D2, D7): the target is the full window that shows the action's vault
   * — the one focused last, else the first — never a Files window or a hidden one. It hears `link:open-from-files`
   * (held until its page listens). A preview brings it to the front unfocused (`moveTop`), a background tab raises
   * nothing, anything else focuses it. With none, a new full window opens beside the Files window on that vault:
   * on the page itself for `open`, else with the push held for it. `false` = `from` is no live Files window.
   */
  openFromFiles(from: string, action: FilesAction): boolean
  /**
   * Tabs Mission Control in the Files window `id` (YAZ-3357 D3): `open` keeps its narrow bounds stored, marks it wide
   * (`commitBounds` skips it, so the store keeps the narrow ones) and grows it to `FILES_WINDOW_WIDE_W` page px (× the
   * App size on the screen, YAZ-3441), clamped, at once (D10, not animated); closing puts the stored narrow bounds back.
   * In memory only: a restart always opens narrow. `false` = no live Files window.
   */
  filesWide(id: string, open: boolean): boolean
  /**
   * A new App size, from the factor `from` to `to` (YAZ-3441): each Files window keeps its PAGE width, so its window
   * width scales by `to / from` and its right edge stays (it stands flush left of its source). A wide one's stored
   * narrow bounds scale and the wide window takes the board's width at the new App size; the board's close brings the
   * narrow ones back. A Files window whose zoom menu is open waits for the close (`filesZoomMenu`, YAZ-3444). Full
   * windows do not change: their sidebar is in page px.
   */
  appZoomChanged(from: number, to: number): void
  /**
   * The zoom menu of the Files window `id` opened or closed (YAZ-3444). While it is open, a new App size leaves that
   * window's size, so the menu and its + stay under the pointer; the close gives it the width that keeps its page
   * width from before the first change. A reload of its page counts as a close. `false` = no live Files window.
   */
  filesZoomMenu(id: string, open: boolean): boolean
  /** The Files window `id`'s floating preview (YAZ-3357 D9): beside the window on the row's height (`filesPreviewBounds`), or hidden with null. `false` = no live Files window. */
  filesPreview(id: string, req: FilesPreviewRequest | null): boolean
  /**
   * The zoom menu's − % + or an unclaimed ⌘+ / ⌘− / ⌘0 in the Files window `id` (YAZ-3389 D13): store its own sidebar zoom,
   * `percent` normalized (`normalizeFilesZoom`). Any other window: nothing (`false`); a full window's zoom is `settings.sidebarZoom`.
   */
  setFilesZoom(id: string, percent: number): boolean
  /**
   * "Make full window" (YAZ-3357 D13): a full window on the Files window `id`'s vaults and lens opens where it
   * stands — as tall, at a normal width, clamped — with no tab (`startEmpty`), then `id` closes by its real close. `false` = not
   * a live Files window.
   */
  filesToNormal(id: string): boolean
}

/** What the IPC layer (`ipc/window.ts`) needs from the manager; tests fake just this slice. */
export type WindowManagerIpc = Pick<WindowManager, 'idFor' | 'openWindow' | 'duplicateWindow' | 'popOut' | 'tearOff' | 'moveTo' | 'focusTab' | 'closeTabs' | 'moveTab' | 'setName' | 'closeOther' | 'openBehind' | 'setRoots' | 'addVaultAndTake' | 'popOutTab' | 'showWindow' | 'hiddenWindows' | 'minimizedWindows' | 'highlightTab' | 'tabAction' | 'highlight' | 'takeStartView' | 'takeStartEmpty' | 'takeStartCollapsed' | 'openRecentBeside' | 'openAlone' | 'openVaultSet' | 'closeWindow' | 'handleFlushed' | 'handleLinkReady' | 'vaultNotice' | 'openFilesWindow' | 'openFromFiles' | 'filesWide' | 'filesPreview' | 'setFilesZoom' | 'filesZoomMenu' | 'filesToNormal'>

// ---------- bounds clamping (pure) ----------

const overlapArea = (a: WindowBounds, b: WindowBounds): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const centreDistanceSq = (a: WindowBounds, b: WindowBounds): number => {
  const dx = a.x + a.width / 2 - (b.x + b.width / 2)
  const dy = a.y + a.height / 2 - (b.y + b.height / 2)
  return dx * dx + dy * dy
}

/** The work area `bounds` overlaps most (fully off-screen → the nearest one; ties keep the earliest); undefined with none. */
function areaOf(bounds: WindowBounds, workAreas: readonly WindowBounds[]): WindowBounds | undefined {
  if (workAreas.length === 0) return undefined
  let area = workAreas[0]
  let best = overlapArea(bounds, area)
  for (const wa of workAreas) {
    const o = overlapArea(bounds, wa)
    if (o > best) {
      area = wa
      best = o
    }
  }
  return best === 0 ? workAreas.reduce((a, b) => (centreDistanceSq(bounds, b) < centreDistanceSq(bounds, a) ? b : a)) : area
}

/**
 * Restored bounds must land on a display that still exists: the window goes fully inside the
 * work area it overlaps most (fully off-screen → the nearest one; ties keep the earliest, so
 * callers pass the primary first), shrunk to fit if oversized. No work areas at all leaves
 * the bounds alone (nothing to clamp against).
 */
export function clampBounds(bounds: WindowBounds, workAreas: readonly WindowBounds[]): WindowBounds {
  const area = areaOf(bounds, workAreas)
  if (area === undefined) return bounds
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height,
  }
}

const sameBounds = (a: WindowBounds, b: WindowBounds): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

// ---------- Files windows (pure, YAZ-3357) ----------

/** A Files window (YAZ-3357 D1): never the target of a link, a moved tab, a raise or a Files window's click. */
export const isFilesWindow = (w: Pick<WindowEntry, 'kind'>): boolean => w.kind === 'files'

/**
 * Where a Files window opens (YAZ-3357 D6): flush LEFT of the source window `source`, on its top and as tall, `width`
 * wide (the source's sidebar, in screen px); with no source, `width` × `FILES_WINDOW_DEFAULT_H` at the default spot.
 * Clamped to the screen, so at the left edge of a screen it stands over the source's left side.
 */
export function filesWindowBounds(source: WindowBounds | null, width: number, workAreas: readonly WindowBounds[]): WindowBounds {
  if (source === null) return clampBounds({ x: DEFAULT_BOUNDS.x, y: DEFAULT_BOUNDS.y, width, height: FILES_WINDOW_DEFAULT_H }, workAreas)
  return clampBounds({ x: source.x - width, y: source.y, width, height: source.height }, workAreas)
}

/** The narrowest a full window beside a Files window gets before it moves over it instead. */
const BESIDE_FILES_MIN_W = 640

/**
 * A full window a Files window makes (YAZ-3357: ⌘T, ⌘⇧N, the board's "New window", a click with no target): RIGHT of
 * it, as tall, the default width — narrower to stay beside it on its screen, down to BESIDE_FILES_MIN_W; then clamped.
 */
export function besideFilesBounds(files: WindowBounds, workAreas: readonly WindowBounds[]): WindowBounds {
  const x = files.x + files.width
  const area = areaOf(files, workAreas)
  const room = area === undefined ? DEFAULT_BOUNDS.width : area.x + area.width - x
  return clampBounds({ x, y: files.y, width: Math.max(BESIDE_FILES_MIN_W, Math.min(DEFAULT_BOUNDS.width, room)), height: files.height }, workAreas)
}

/**
 * The floating preview of a Files window (YAZ-3357 D9): `req`'s size, RIGHT of the window's page area `content` on the
 * screen that holds it, or LEFT of it when that screen has no room there; centred on the hovered row (`req.top` and
 * `req.bottom` are page coordinates) and kept on that screen. Rounded: the popup is placed in whole pixels.
 */
export function filesPreviewBounds(content: WindowBounds, workAreas: readonly WindowBounds[], req: FilesPreviewRequest): WindowBounds {
  const area = areaOf(content, workAreas) ?? { x: -Infinity, y: -Infinity, width: Infinity, height: Infinity }
  const width = Math.round(Math.min(req.width, area.width))
  const height = Math.round(Math.min(req.height, area.height))
  const right = content.x + content.width
  const x = right + width <= area.x + area.width ? right : Math.max(area.x, content.x - width)
  const mid = content.y + (req.top + req.bottom) / 2
  const y = Math.min(Math.max(area.y, mid - height / 2), area.y + area.height - height)
  return { x: Math.round(x), y: Math.round(y), width, height }
}

/** The path or folder a Files window's action is about (YAZ-3357 D2): its target must show the vault that holds it. A session: its first vault, else the Files window's. */
function filesActionPoint(action: FilesAction, files: Pick<WindowEntry, 'root'>, sessions: readonly Session[]): string | null {
  switch (action.kind) {
    case 'open':
    case 'history':
    case 'share':
      return action.path
    case 'review':
      return action.dir
    case 'inbox':
      return action.root
    case 'session':
      return sessions.find((s) => s.id === action.id)?.roots[0] ?? files.root
  }
}

/**
 * The window a Files window's action goes to (YAZ-3357 D2): of the FULL windows `usable` says are live (and not
 * hidden) and that show a vault holding `point`, the one focused most recently (`focusOrder`), else the first in
 * `windows[]`. Null = none: the caller opens one.
 */
export function pickFilesTarget(point: string, windows: readonly WindowEntry[], focusOrder: readonly string[], usable: (id: string) => boolean): string | null {
  const shows = windows.filter((w) => !isFilesWindow(w) && usable(w.id) && rootOfPath(w.roots, point) !== null)
  return focusOrder.find((id) => shows.some((w) => w.id === id)) ?? shows[0]?.id ?? null
}

// ---------- deep-link routing (pure, E1 GRO-2171) ----------

export type LinkTarget = { kind: 'existing'; id: string; root: string } | { kind: 'new'; root: string; file: string }

/** `root` is an ancestor directory of `path` (or its dirname) — by segment, so `/a/b` never contains `/a/bc/x.md`. */
const rootContains = (root: string, path: string): boolean => {
  const r = stripSlash(root)
  return path.startsWith(r === '/' ? '/' : r + '/') && path.length > r.length + 1
}

/**
 * Where a `yaseendocs://` link to `path` should land: (1) the open window one of whose vaults contains
 * it (YAZ-2602 D6) — most specific vault wins, ties keep the first in `windows[]`, Welcome windows never match;
 * (2) a new window on the most recent `recents` folder containing it (the list is already
 * most-recent-first); (3) a new window on the file's parent folder. A containing `rootOverride`
 * pins the effective root instead: the open window that shows that vault, else a new window there.
 * Both kinds say the `root`: the vault the path belongs to (`rootFor`, YAZ-2589 D1).
 */
export function resolveLinkTarget(
  path: string,
  windows: readonly WindowEntry[],
  recents: RecentRoots,
  rootOverride?: string | null,
): LinkTarget {
  if (rootOverride != null && rootContains(rootOverride, path)) {
    for (const w of windows) {
      const vault = w.roots.find((root) => stripSlash(root) === stripSlash(rootOverride))
      if (vault !== undefined) return { kind: 'existing', id: w.id, root: vault }
    }
    return { kind: 'new', root: rootOverride, file: path }
  }
  let best: { id: string; root: string } | undefined
  for (const w of windows) {
    for (const root of w.roots) {
      if (!rootContains(root, path)) continue
      if (best === undefined || root.length > best.root.length) best = { id: w.id, root }
    }
  }
  if (best !== undefined) return { kind: 'existing', ...best }
  const recent = recents.find((r) => rootContains(r.path, path))
  if (recent !== undefined) return { kind: 'new', root: recent.path, file: path }
  return { kind: 'new', root: posix.dirname(path), file: path }
}

// ---------- the manager ----------

export function createWindowManager(store: Store, host: WindowHost): WindowManager {
  /** Live windows by state entry id (dropped again in `closed`). */
  const live = new Map<string, ManagedWindow>()
  /** Page views for popped-out windows that have not read their identity yet (YAZ-2951 D2), by window id. Memory only. */
  const startViews = new Map<string, StartView>()
  /** The windows `duplicateWindow` and `openBehind` opened, until their first identity read (YAZ-3343): they boot empty. */
  const emptyStarts = new Set<string>()
  /** The NEW windows (⌘⇧N, the board's "New window", a new Files window) until their first identity read: their tree starts closed (YAZ-3487). */
  const collapsedStarts = new Set<string>()
  /** The live windows the tab board made, built hidden and not shown yet (YAZ-3343). Never stored. */
  const hiddenWins = new Set<string>()
  /** The live windows minimized in the Dock (YAZ-3343). Never stored. */
  const minimizedWins = new Set<string>()
  /** The Files windows grown wide for Tabs Mission Control (YAZ-3357 D3): their stored bounds stay the narrow ones. Never stored. */
  const wideFiles = new Set<string>()
  /**
   * The Files windows whose zoom menu is open (YAZ-3444): a new App size leaves their size, so the menu stays under the
   * pointer. The value is the App size factor before the first change while it was open (null: no change yet). Never stored.
   */
  const zoomMenus = new Map<string, number | null>()
  /** The board's width on the screen: `FILES_WINDOW_WIDE_W` page px × the App size (YAZ-3441). */
  const wideWidth = (): number => Math.round(FILES_WINDOW_WIDE_W * appZoomFactor(store.get().settings))
  /**
   * A Files window takes the width that keeps its page width from the App size factor `from` to `to` (YAZ-3441), its
   * right edge kept (it stands flush left of its source). While the board makes it wide, its stored narrow bounds
   * scale and the wide window takes the board's width at the new App size.
   */
  const scaleFilesWindow = (entry: WindowEntry, from: number, to: number): void => {
    if (from === to || from <= 0) return
    const win = liveWindow(entry.id)
    const wide = wideFiles.has(entry.id)
    // The narrow bounds: as it stands now, or the stored ones while the board makes it wide.
    const narrow = wide || win === undefined ? entry.bounds : win.getBounds()
    const width = Math.round((narrow.width * to) / from)
    const areas = host.workAreas()
    const bounds = clampBounds({ ...narrow, x: narrow.x + narrow.width - width, width }, areas)
    if (win === undefined) return store.upsertWindow({ ...entry, bounds })
    if (wide) {
      store.upsertWindow({ ...entry, bounds })
      win.setBounds(clampBounds({ ...bounds, width: Math.max(bounds.width, wideWidth()) }, areas), false)
      return
    }
    win.setBounds(bounds, false)
    commitBounds(entry.id, win)
  }
  /** The zoom menu of the Files window `id` is gone (closed, or its page reloaded): the size it waited for (YAZ-3444). */
  const zoomMenuClosed = (id: string): void => {
    const from = zoomMenus.get(id)
    zoomMenus.delete(id)
    const entry = entryOf(id)
    if (from === undefined || from === null || entry === undefined) return
    scaleFilesWindow(entry, from, appZoomFactor(store.get().settings))
  }
  /** In-flight flush handshakes by `webContents.id`; `settle` answers ack and timeout alike. */
  const pendingFlush = new Map<number, { done: Promise<void>; settle: () => void }>()
  /** Windows closing as part of the quit keep their state entry: the next launch can bring them back. */
  let quitting = false
  /**
   * Link pushes that wait, by `webContents.id` (YAZ-2589 A2). A page that is still loading hears
   * nothing, and at launch every window is loading when the waiting links are handled. So a push is
   * held until the renderer says `link:ready`; from then on the window has no entry here.
   */
  const heldLinks = new Map<number, Array<() => void>>()
  /** The window each window's "Move to ▸" row lights up (YAZ-3091 D8), by source id. One at most per source. */
  const lit = new Map<string, string>()
  const glow = (id: string, on: boolean): void => {
    const win = live.get(id)
    if (win !== undefined && !win.isDestroyed()) win.webContents.send(CONTRACT.window.onGlow.channel, on)
  }
  /**
   * Live window ids, most recently FOCUSED first (YAZ-1767 D9): `focus` moves an id to the front,
   * `closed` drops it. A window that has never been focused is not in the list at all — it ranks
   * last when the door raises a vault's windows.
   */
  const focusOrder: string[] = []
  const noteFocused = (id: string): void => {
    const at = focusOrder.indexOf(id)
    if (at !== -1) {
      // A vault is "last used" when a window on it takes focus (YAZ-2555 D5), not only when ⌘O opens it.
      // Not on a window's FIRST focus: a relaunch focuses every restored window in turn, and that
      // must not reorder the list. Not during a quit either (S36): each window destroyed hands focus to the next.
      if (!quitting) noteUsed(activeVault(entryOf(id)))
      focusOrder.splice(at, 1)
    }
    focusOrder.unshift(id)
  }

  const entryOf = (id: string): WindowEntry | undefined => store.get().windows.find((w) => w.id === id)

  /** The vault a window is working in (YAZ-2602 S60): the one that holds its active file, else its first. */
  const activeVault = (entry: WindowEntry | undefined): string | null =>
    entry === undefined ? null : ((entry.file === null ? null : rootOfPath(entry.roots, entry.file)) ?? entry.root)

  /**
   * Bump a window's vault to the top of the MRU (YAZ-2555 D5). Already on top → no write; a Welcome
   * window (root null) is not a vault. Trailing slash off, like `resolveLinkTarget`: one row per vault.
   */
  const noteUsed = (root: string | null): void => {
    if (root === null) return
    const path = stripSlash(root)
    if (store.get().recents[0]?.path !== path) store.pushRecent(path)
  }

  /**
   * One handshake: send `app:flush`, resolve on `handleFlushed` from the same renderer or after
   * FLUSH_TIMEOUT_MS. A second request while one is pending joins it (a close racing the quit).
   */
  const flushRenderer = (win: ManagedWindow): Promise<void> => {
    const wcId = win.webContents.id
    const pending = pendingFlush.get(wcId)
    if (pending !== undefined) return pending.done
    let resolve!: () => void
    const done = new Promise<void>((r) => {
      resolve = r
    })
    const timer = setTimeout(settle, FLUSH_TIMEOUT_MS)
    function settle(): void {
      clearTimeout(timer)
      pendingFlush.delete(wcId)
      resolve()
    }
    pendingFlush.set(wcId, { done, settle })
    win.webContents.send(SPECIAL.appFlush)
    return done
  }

  /** Patch only `bounds` onto the entry as it is NOW (the renderer may have changed root/file since). A wide Files window keeps its narrow bounds (YAZ-3357 D3). */
  const commitBounds = (id: string, win: ManagedWindow): void => {
    const entry = entryOf(id)
    if (entry === undefined || win.isDestroyed() || wideFiles.has(id)) return
    const bounds = win.getBounds()
    if (!sameBounds(bounds, entry.bounds)) store.upsertWindow({ ...entry, bounds })
  }

  const attach = (entry: WindowEntry, hidden = false): void => {
    const win = hidden ? host.create(entry, { hidden: true }) : host.create(entry)
    if (hidden) hiddenWins.add(entry.id)
    const { id } = entry
    const wcId = win.webContents.id
    const unregister = register(win, id)
    live.set(id, win)
    heldLinks.set(wcId, [])

    let boundsTimer: ReturnType<typeof setTimeout> | null = null
    const cancelBoundsTimer = (): void => {
      if (boundsTimer !== null) {
        clearTimeout(boundsTimer)
        boundsTimer = null
      }
    }
    const scheduleBounds = (): void => {
      cancelBoundsTimer()
      boundsTimer = setTimeout(() => {
        boundsTimer = null
        commitBounds(id, win)
      }, BOUNDS_DEBOUNCE_MS)
    }
    win.on('move', scheduleBounds)
    win.on('resize', scheduleBounds)
    win.on('focus', () => noteFocused(id))
    // Minimized in the Dock (YAZ-3343 D23): the board tags the frame until it is restored.
    win.on('minimize', () => {
      minimizedWins.add(id)
      tellMinimized()
    })
    win.on('restore', () => {
      if (minimizedWins.delete(id)) tellMinimized()
    })

    /** `close` is always intercepted: the window only goes away via `destroy()` after its flush. */
    let closing = false
    win.on('close', (e) => {
      e.preventDefault()
      if (closing || quitting) return // its handshake is already running (or the quit sequence owns it)
      closing = true
      cancelBoundsTimer()
      commitBounds(id, win)
      void flushRenderer(win).then(() => {
        if (!win.isDestroyed()) win.destroy()
      })
    })

    win.on('closed', () => {
      cancelBoundsTimer()
      unregister()
      live.delete(id)
      // Closed before it asked (YAZ-2951 S20): what it would have read goes with it.
      startViews.delete(id)
      emptyStarts.delete(id)
      collapsedStarts.delete(id)
      heldLinks.delete(wcId)
      // A lit window goes dark with the window whose row lit it; a closed lit window is forgotten (YAZ-3091 D8).
      const target = lit.get(id)
      lit.delete(id)
      if (target !== undefined) glow(target, false)
      for (const [from, to] of lit) if (to === id) lit.delete(from)
      const at = focusOrder.indexOf(id)
      if (at !== -1) focusOrder.splice(at, 1)
      const wasHidden = hiddenWins.delete(id)
      wideFiles.delete(id)
      zoomMenus.delete(id)
      if (minimizedWins.delete(id) && !quitting) tellMinimized()
      if (quitting) return
      if (wasHidden) tellHidden()
      // A window the board made, still hidden, never runs on alone: with no window left on screen it shows (YAZ-3343).
      else if (hiddenWins.size > 0 && [...live.keys()].every((other) => hiddenWins.has(other))) for (const other of [...hiddenWins]) showWindow(other)
      // A user close forgets the window; the LAST one closing quits the app (`window-all-closed`), so that is
      // a quit too: its entry stays, and the vault it was working in is the "last vault" (YAZ-2589 A1, YAZ-2602 A8).
      if (live.size > 0) {
        // A window you close puts its notes in "Recently closed" (YAZ-3487 D10). A quit does not: its tabs come back.
        const entry = entryOf(id)
        if (entry !== undefined && !isFilesWindow(entry)) store.addClosed(entry.roots, entry.tabs)
        store.removeWindow(id)
      } else noteUsed(activeVault(entryOf(id)))
    })
  }

  const open = (entry: WindowEntry, hidden = false): void => {
    store.upsertWindow(entry)
    attach(entry, hidden)
  }
  /** Every live window hears which windows are in `wins` (YAZ-3343 D23): the tab board tags their frames. */
  const tell = (channel: string, wins: ReadonlySet<string>): void => {
    const ids = [...wins]
    for (const win of live.values()) if (!win.isDestroyed()) win.webContents.send(channel, ids)
  }
  const tellMinimized = (): void => tell(CONTRACT.window.onMinimizedWindows.channel, minimizedWins)
  const tellHidden = (): void => tell(CONTRACT.window.onHiddenWindows.channel, hiddenWins)
  /** A window cascaded from `from` (GRO-2167). */
  const cascadeFrom = (from: WindowEntry): WindowEntry['bounds'] => clampBounds({ ...from.bounds, x: from.bounds.x + WINDOW_CASCADE_PX, y: from.bounds.y + WINDOW_CASCADE_PX }, host.workAreas())
  /**
   * A window on `from`'s vaults with NO tab (YAZ-3343 D22, D35): it boots on the blank tab, the caret in the search. The
   * vaults, sidebar visibility and lens (YAZ-1628) by value, then each window keeps its own. The focus list is not the
   * window's to copy (YAZ-2702 Decision 1), nor is its name (D14). `hidden`: built hidden (D23). Answers its id.
   */
  const openBlank = (from: WindowEntry, hidden: boolean): string => {
    const id = randomUUID()
    emptyStarts.add(id)
    collapsedStarts.add(id)
    // From a Files window (YAZ-3357 D8, D14: its ⌘T, ⌘⇧N and the board's "New window") the sidebar shows, and the window stands right of it.
    open({ id, root: from.root, roots: [...from.roots], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: isFilesWindow(from) ? false : from.sidebarCollapsed, sidebarLens: from.sidebarLens, bounds: madeFrom(from) }, hidden)
    return id
  }
  /** A hidden window (YAZ-3343) shows and takes the focus; `false` = not live. A shown one is only focused. */
  const showWindow = (id: string): boolean => {
    const win = live.get(id)
    if (win === undefined || win.isDestroyed()) return false
    if (hiddenWins.delete(id)) {
      win.show()
      tellHidden()
    }
    focusWindow(win)
    return true
  }

  /** "Move to new window" (YAZ-2933): `from`'s vaults, ONE tab, sidebar hidden; `bounds` = where a torn-off tab's window goes (YAZ-3637 D3), else cascaded. */
  const popOut = (from: WindowEntry, path: string, carry?: PopOutCarry, bounds?: WindowBounds): void => {
    // The id first, and the page view under it before the window exists: its first identity read cannot miss it (YAZ-2951 D2).
    const id = randomUUID()
    if (carry?.view !== undefined) startViews.set(id, { path, view: carry.view })
    // The tab's display name is stored with the new window's one tab (YAZ-3057 D3). `from`'s own strip must not come along,
    // and neither does its name (YAZ-3343 D14): the new window is another window, with its automatic label.
    // Nor its kind (YAZ-3357 D1): a tab moves to a full window.
    const { tabStrip: _from, name: _name, kind: _kind, ...source } = from
    // From the tab board it is QUIET (YAZ-3343 D37): the new window is HIDDEN until the board shows it (D23).
    open({ ...source, id, roots: [...from.roots], file: path, tabs: [path], ...(carry?.name === undefined ? {} : { tabStrip: [{ path, name: carry.name }] }), rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, bounds: bounds ?? cascadeFrom(from) }, carry?.background === true)
    if (carry?.background === true) tellHidden()
  }
  /** A new full window; `bounds` = where a Files window puts it (YAZ-3357), else the default spot. Answers its id. */
  const openWindow = (opts: OpenWindowOptions, bounds?: WindowBounds): string => {
    // A window opened on a vault is a use of that vault (YAZ-2555 D5); its first focus does not count.
    noteUsed(opts.root)
    const id = randomUUID()
    open({ id, root: opts.root, roots: normalizeRoots(opts.roots ?? [], opts.root), file: opts.file, tabs: opts.file === null ? [] : [opts.file], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: DEFAULT_SIDEBAR_LENS, bounds: bounds ?? clampBounds({ ...DEFAULT_BOUNDS }, host.workAreas()) })
    return id
  }
  /** Where a window made FROM `from` goes (YAZ-3357): cascaded off a full window, beside a Files window, which is too narrow to copy. */
  const madeFrom = (from: WindowEntry): WindowBounds =>
    isFilesWindow(from) ? besideFilesBounds(from.bounds, host.workAreas()) : cascadeFrom(from)

  /** The window `id` when it is live and not destroyed (YAZ-3343 D3): the doors of the tab board act on no other. */
  const liveWindow = (id: string): ManagedWindow | undefined => {
    const win = live.get(id)
    return win === undefined || win.isDestroyed() ? undefined : win
  }

  const focusWindow = (win: ManagedWindow): void => {
    if (win.isMinimized()) win.restore()
    win.focus()
  }

  /** A link push to `win`: at once when its renderer listens, else held for `handleLinkReady` (YAZ-2589 A2). */
  const sendLink = (win: ManagedWindow, channel: string, payload: unknown): void => {
    const send = (): void => win.webContents.send(channel, payload)
    const held = heldLinks.get(win.webContents.id)
    if (held === undefined) send()
    else held.push(send)
  }

  /**
   * E1: un-minimize + focus a live window and hand it the can't-open message.
   * The window that had focus last comes first (YAZ-2555 S27): ⌘<n> on a folder that is gone says so
   * in the window you are in, and raises no other vault's window (D5 would make that vault "last used").
   * No window at all (YAZ-2589 A2): the app never runs with no window, so the Welcome window opens and
   * says it. A request that cannot open is not asked for at launch (A6), so this is the safety net for a
   * folder that goes away between the launch's check and the open. Not during a quit, which has no
   * window on purpose.
   */
  const linkNotice = (message: string): void => {
    if (live.size === 0 && !quitting) openWindow({ root: null, file: null })
    const win = [live.get(focusOrder[0]), ...live.values()].find((w) => w !== undefined && !w.isDestroyed())
    if (win === undefined) return
    focusWindow(win)
    sendLink(win, CONTRACT.link.onNotice.channel, message)
  }

  /**
   * Why a path that is not a folder cannot open (E1): it needs a supported file kind and a live regular
   * file. `null` when it can. The ONE place that says so (YAZ-2589 A6): `routeToFile` shows the reason
   * as a notice, and `rootFor` leaves such a path out of what a launch was asked for.
   */
  const cannotOpen = (path: string): string | null => (fileKind(path) === null ? 'unsupported file type' : host.exists(path) ? null : 'file not found')

  /**
   * Raise every live window whose entry matches (YAZ-1767 🔒 D9) — LEAST recently focused first, so
   * the most recently focused one ends on top (a window never focused ranks last). False = none is
   * live: the caller opens one.
   */
  const raiseWindows = (matches: (entry: WindowEntry) => boolean): boolean => {
    const wins = store
      .get()
      // A Files window (YAZ-3357 D2) is never raised for a vault: ⌘1–9, Open Recent and the vault sets skip it.
      .windows.filter((w) => !isFilesWindow(w) && matches(w))
      .map((w) => ({ id: w.id, win: live.get(w.id) }))
      .filter((w): w is { id: string; win: ManagedWindow } => w.win !== undefined && !w.win.isDestroyed())
    const rank = (id: string): number => {
      const at = focusOrder.indexOf(id)
      return at === -1 ? Number.POSITIVE_INFINITY : at
    }
    for (const { win } of wins.sort((a, b) => rank(b.id) - rank(a.id))) focusWindow(win)
    return wins.length > 0
  }

  /**
   * The open-recent door (see `WindowManager.openRecentBeside`) and "Open by itself" (`openAlone`,
   * YAZ-2858 D1): one body, and `alone` picks the match. A `const`, like `openWindow`, so `routeToFile` can call it too (YAZ-2556 D1).
   */
  const openVault = (path: string, alone: boolean, from?: string): boolean => {
    // Beside never passes through the renderer's validating openRoot, so probe here: a dead
    // folder is pruned from the MRU (mirrors the Welcome/in-place path) and opens nothing.
    if (!host.dirExists(path)) {
      store.removeRecent(path)
      return false
    }
    // Opening beside never lands in the renderer that bumps the MRU on an in-place open, so bump here
    // — through `noteUsed`: a vault that is already on top is not written again (YAZ-2555 D5, S25).
    noteUsed(path)
    // Already open (YAZ-1767 🔒 D9) — in a window that shows it, alone or beside others (YAZ-2602 D6): raise that vault's live windows instead of opening a third
    // copy. Roots compare like `resolveLinkTarget`: trailing slash off. "Open by itself" counts only a window with this vault alone (YAZ-2858 D1).
    const wanted = stripSlash(path)
    if (raiseWindows((w) => (alone ? sameVaults(w.roots, [wanted]) : w.roots.some((root) => stripSlash(root) === wanted)))) return true
    // No window to raise: an EMPTY window that asked takes the vault itself (YAZ-3487 D1).
    if (from !== undefined && takeHere(from, [path])) return true
    openWindow({ root: path, file: startFile(path) })
    return true
  }
  const openRecentBeside = (path: string, from?: string): boolean => openVault(path, false, from)

  /** What a new window on `vault` opens on (YAZ-3487 D15): blank (D7), or with "Its last note" the remembered `lastFile`. */
  const startFile = (vault: string): string | null => (store.get().settings.vaultOpensOn === 'last' ? (store.get().folders[vault]?.lastFile ?? null) : null)

  /**
   * YAZ-3487 D1: the window `from` shows `roots` itself when it is EMPTY — no tab, no page, nothing in its right
   * panel; the blank tab is no tab. A Files window never is: it has its own rule (YAZ-3357 D12). It hears the vault
   * chip's `link:set-roots` (YAZ-3343 D22) and shows the vaults blank (D3). `false` = not live, or not empty.
   */
  const takeHere = (from: string, roots: readonly string[]): boolean => {
    const win = liveWindow(from)
    const entry = entryOf(from)
    if (win === undefined || entry === undefined || isFilesWindow(entry)) return false
    if (entry.tabs.length > 0 || entry.file !== null || entry.rightPanel.items.length > 0) return false
    sendLink(win, CONTRACT.link.onSetRoots.channel, [...roots])
    return true
  }

  /** The door for a saved set of vaults (see `WindowManager.openVaultSet`). */
  const openVaultSet = (id: string, from?: string): OpenSetResult => {
    const set = store.get().vaultSets.find((s) => s.id === id)
    if (set === undefined) return { opened: false, missing: [] }
    const missing = set.roots.filter((root) => !host.dirExists(root))
    const found = set.roots.filter((root) => !missing.includes(root))
    if (found.length === 0) return { opened: false, missing }
    // The set's window is the one that shows exactly the vaults that are left (S66): a window opened
    // earlier without the missing folder is raised, not doubled.
    if (!raiseWindows((w) => sameVaults(w.roots, found)) && (from === undefined || !takeHere(from, found))) openWindow({ root: found[0], roots: found, file: startFile(found[0]) })
    store.touchVaultSet(id)
    return { opened: true, missing }
  }

  return {
    idFor,

    rootFor(path, rootOverride) {
      if (host.dirExists(path)) return stripSlash(path)
      if (cannotOpen(path) !== null) return null
      const state = store.get()
      return resolveLinkTarget(path, state.windows.filter((w) => !isFilesWindow(w)), state.recents, rootOverride).root
    },

    restore(which) {
      const state = store.get()
      // The vaults whose windows come back: the ones asked for (D1), or for "last" the vault used last (D2; the quit recorded it, A1).
      const roots = (typeof which !== 'string' ? which : which === 'last' ? state.recents.slice(0, 1).map((r) => r.path) : []).map(stripSlash)
      // A window is on each vault it shows (YAZ-2602 D6, A8): one of them asked for brings it back, with all of them.
      const keep = (w: WindowEntry): boolean => which === 'all' || w.roots.some((root) => roots.includes(stripSlash(root)))
      // A window that does not come back is forgotten, as a close forgets it (D3): its entry goes, in one commit.
      store.removeWindow(...state.windows.filter((w) => !keep(w)).map((w) => w.id))
      const entries = state.windows.filter(keep)
      // Nothing comes back and nothing was asked for (the setting says so, or a first launch): one window on
      // the Welcome screen, with the list of vaults (root null; the screen itself is C2). A launch that
      // asked for a vault opens it itself (`routeToFile`, after this).
      if (entries.length === 0 && typeof which === 'string') openWindow({ root: null, file: null })
      const areas = host.workAreas()
      for (const entry of entries) {
        const bounds = clampBounds(entry.bounds, areas)
        const next = sameBounds(bounds, entry.bounds) ? entry : { ...entry, bounds }
        if (next !== entry) store.upsertWindow(next)
        attach(next)
      }
    },

    openWindow,

    duplicateWindow(from) {
      openBlank(from, false)
    },

    popOut,

    tearOff(from, path, carry, point, alone) {
      // A drag that ended with no point (0,0) was let go where the pointer is now.
      const at = point.x === 0 && point.y === 0 ? host.cursorPoint() : point
      // On a window that shows, the drop was that window's to take or refuse (D4, D8): nothing opens. A hidden window
      // (YAZ-3343) and one in the Dock are not under the pointer.
      for (const [id, win] of live) {
        if (win.isDestroyed() || hiddenWins.has(id) || win.isMinimized()) continue
        const b = win.getBounds()
        if (at.x >= b.x && at.x < b.x + b.width && at.y >= b.y && at.y < b.y + b.height) return 'none'
      }
      // As big as the source stands NOW (the stored bounds lag a drag by BOUNDS_DEBOUNCE_MS), the tab under the pointer.
      const source = liveWindow(from.id)
      const size = source?.getBounds() ?? from.bounds
      // Kept on the display that holds the drop point: near the edge between two displays the window must not jump to
      // the other one, where the tab would be far from the pointer. A point on no display is clamped as any window is.
      const areas = host.workAreas()
      const under = areas.filter((a) => at.x >= a.x && at.x < a.x + a.width && at.y >= a.y && at.y < a.y + a.height)
      const bounds = clampBounds({ ...size, x: at.x - TEAR_OFF_GRAB.x, y: at.y - TEAR_OFF_GRAB.y }, under.length > 0 ? under : areas)
      if (alone && source !== undefined) {
        // The only tab takes its window along (D5): no new window, no reload. Stored now, as `commitBounds` would after
        // the debounce, so an identity read in between sees where the window is.
        store.upsertWindow({ ...(entryOf(from.id) ?? from), bounds })
        source.setBounds(bounds)
        return 'moved'
      }
      popOut(from, path, carry, bounds)
      return 'opened'
    },

    showWindow,

    tabAction(to, ref, action) {
      const win = liveWindow(to)
      if (win === undefined) return false
      if (action.kind === 'show-in-sidebar') showWindow(to)
      sendLink(win, CONTRACT.link.onTabAction.channel, { ref: { path: ref.path, copy: ref.copy }, action })
      return true
    },

    hiddenWindows: () => [...hiddenWins],

    minimizedWindows: () => [...minimizedWins],

    popOutTab(from, ref) {
      const win = liveWindow(from)
      if (win === undefined) return false
      sendLink(win, CONTRACT.link.onPopOutTab.channel, { path: ref.path, copy: ref.copy })
      return true
    },

    addVaultAndTake(to, vault, from, ref) {
      const win = liveWindow(to)
      const entry = entryOf(to)
      if (win === undefined || entry === undefined || isFilesWindow(entry) || from === to || liveWindow(from) === undefined) return false
      sendLink(win, CONTRACT.link.onAddVaultAndTake.channel, { vault, from, ref: { path: ref.path, copy: ref.copy } })
      return true
    },

    moveTo(to, path, carry) {
      const win = live.get(to)
      const entry = entryOf(to)
      // A Files window (YAZ-3357 D2) has no tabs to take one.
      if (win === undefined || win.isDestroyed() || entry === undefined || isFilesWindow(entry) || rootOfPath(entry.roots, path) === null) return false
      // A quiet move from the tab board (YAZ-3343 D13) raises nothing: the user stays on the board they dropped it on.
      if (carry?.background !== true) focusWindow(win)
      sendLink(win, CONTRACT.link.onTakeTab.channel, { path, ...carry })
      return true
    },

    focusTab(to, ref) {
      const win = liveWindow(to)
      if (win === undefined) return false
      // A hidden window (YAZ-3343) shows the first time one of its tabs is opened from the board.
      showWindow(to)
      sendLink(win, CONTRACT.link.onFocusTab.channel, { path: ref.path, copy: ref.copy })
      return true
    },

    closeTabs(to, refs) {
      const win = liveWindow(to)
      if (win === undefined) return false
      // No raise (D3): the user is on the board of another window, closing cards there.
      sendLink(win, CONTRACT.link.onCloseTabs.channel, refs.map((ref) => ({ path: ref.path, copy: ref.copy })))
      return true
    },

    moveTab(from, to, ref, at, background) {
      const source = liveWindow(from)
      const entry = entryOf(to)
      if (source === undefined || from === to || liveWindow(to) === undefined || entry === undefined || isFilesWindow(entry) || rootOfPath(entry.roots, ref.path) === null) return false
      sendLink(source, CONTRACT.link.onSendTab.channel, { to, ref: { path: ref.path, copy: ref.copy }, ...(at === undefined ? {} : { at }), ...(at !== undefined && background === true ? { background: true } : {}) })
      return true
    },

    setName(id, name) {
      return liveWindow(id) !== undefined && store.setWindowName(id, name)
    },

    setRoots(id, roots) {
      const win = liveWindow(id)
      const entry = entryOf(id)
      // Only an EMPTY window switches its vaults this way: a tab of the old vaults would be left in no vault.
      if (win === undefined || entry === undefined || entry.tabs.length > 0 || entry.file !== null) return false
      sendLink(win, CONTRACT.link.onSetRoots.channel, [...roots])
      return true
    },

    closeOther(id) {
      const win = liveWindow(id)
      if (win === undefined) return false
      win.close()
      return true
    },

    openBehind(from) {
      // HIDDEN (D23): it lives on the board until the user shows it there.
      const id = openBlank(from, true)
      tellHidden()
      return id
    },

    highlightTab(to, ref) {
      // A glance: never held for a page that does not listen yet, never a raise.
      const win = liveWindow(to)
      if (win !== undefined) win.webContents.send(CONTRACT.link.onHighlightTab.channel, ref === null ? null : { path: ref.path, copy: ref.copy })
    },

    highlight(from, to) {
      const before = lit.get(from)
      const next = to !== null && to !== from && live.has(to) ? to : undefined
      if (before === next) return
      if (before !== undefined) glow(before, false)
      if (next === undefined) lit.delete(from)
      else {
        lit.set(from, next)
        glow(next, true)
      }
    },

    takeStartView(id) {
      const start = startViews.get(id)
      startViews.delete(id)
      return start
    },

    takeStartEmpty(id) {
      return emptyStarts.delete(id)
    },

    takeStartCollapsed(id) {
      return collapsedStarts.delete(id)
    },

    openRecentBeside,

    openAlone: (path, from) => openVault(path, true, from),

    openVaultSet,

    closeWindow(id) {
      const win = live.get(id)
      if (win !== undefined && !win.isDestroyed()) win.close()
    },

    routeToFile(path, rootOverride) {
      // A FOLDER from outside — a link, or `open -a` — is "Open Folder…" on it
      // (YAZ-2556 D1): the one open-recent door raises that vault's windows, or opens it. A link keeps
      // a trailing slash, and the door keys the vault's bucket by the path it is given: slash off.
      if (host.dirExists(path)) {
        openRecentBeside(stripSlash(path))
        return
      }
      // Validate first (E1): a supported file kind and a live regular file. Anything off →
      // notice, never a dialog; renderer dispatch decides Markdown editor vs read-only viewer.
      const why = cannotOpen(path)
      if (why !== null) {
        linkNotice(`Can't open ${path}: ${why}`)
        return
      }
      const state = store.get()
      // A Files window (YAZ-3357 D2) is never a link's target: it has no page to show it in.
      const target = resolveLinkTarget(path, state.windows.filter((w) => !isFilesWindow(w)), state.recents, rootOverride)
      if (target.kind === 'new') {
        openWindow({ root: target.root, file: target.file })
        return
      }
      const win = live.get(target.id)
      if (win === undefined || win.isDestroyed()) {
        // A stored entry with no live window (mid-close race): fall back to a fresh window on its root.
        openWindow({ root: target.root, file: path })
        return
      }
      focusWindow(win)
      sendLink(win, CONTRACT.link.onOpenFile.channel, path)
    },

    linkNotice,

    vaultNotice(root, message) {
      for (const [id, win] of live) {
        if (!win.isDestroyed() && entryOf(id)?.roots.includes(root) === true) sendLink(win, CONTRACT.link.onNotice.channel, message)
      }
    },

    handleLinkReady(sender) {
      for (const send of heldLinks.get(sender.id) ?? []) send()
      heldLinks.delete(sender.id)
      // A new page has no zoom menu open (YAZ-3444): one left open by the old page closes now.
      const id = idFor(sender)
      if (id !== undefined && zoomMenus.has(id)) zoomMenuClosed(id)
    },

    handleFlushed(sender) {
      pendingFlush.get(sender.id)?.settle()
    },

    openFilesWindow(from, root) {
      const source = from === undefined ? undefined : entryOf(from)
      const roots = root !== null ? [root] : (source?.roots ?? [])
      if (roots.length === 0) return false
      const areas = host.workAreas()
      // The source as it stands now (the stored bounds lag a drag by BOUNDS_DEBOUNCE_MS); a wide Files window by its stored, narrow bounds.
      const at = source === undefined ? null : wideFiles.has(source.id) ? source.bounds : (liveWindow(source.id)?.getBounds() ?? source.bounds)
      // The sidebar's width is page px; the window's is screen px, the App size larger (YAZ-3441).
      const onScreen = (pagePx: number) => Math.round(pagePx * appZoomFactor(store.get().settings))
      const bounds =
        source === undefined || at === null
          ? filesWindowBounds(null, onScreen(FILES_WINDOW_DEFAULT_W), areas)
          : isFilesWindow(source)
            ? clampBounds({ ...at, x: at.x + WINDOW_CASCADE_PX, y: at.y + WINDOW_CASCADE_PX }, areas)
            : filesWindowBounds(at, onScreen(source.sidebarCollapsed ? FILES_WINDOW_DEFAULT_W : store.get().sidebarWidth), areas)
      const vaults = normalizeRoots(roots, roots[0])
      // Its list at the source's sidebar zoom (YAZ-3487, demo round 3 — it was one step above, YAZ-3389 D13): a Files
      // window's own zoom, else the shared `settings.sidebarZoom` (a full window, or no source). The App size is shared already.
      const zoom = source !== undefined && isFilesWindow(source) ? normalizeFilesZoom(source.zoom) : store.get().settings.sidebarZoom
      // A NEW window: its tree starts with every folder closed (YAZ-3487, demo round 3).
      const id = randomUUID()
      collapsedStarts.add(id)
      // The lens comes from the source (D6); the focus list is the vault's, and no name or tab comes along.
      open({ id, kind: 'files', root: vaults[0], roots: vaults, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: source?.sidebarLens ?? DEFAULT_SIDEBAR_LENS, bounds, zoom })
      return true
    },

    openFromFiles(from, action) {
      const files = entryOf(from)
      if (files === undefined || !isFilesWindow(files) || liveWindow(from) === undefined) return false
      const state = store.get()
      const point = filesActionPoint(action, files, state.sessions)
      if (point === null) return false
      const id = pickFilesTarget(point, state.windows, focusOrder, (w) => liveWindow(w) !== undefined && !hiddenWins.has(w))
      if (id === null) {
        // No full window shows the vault: a new one opens beside the Files window, on the page itself for `open`.
        const vault = rootOfPath(files.roots, point) ?? (action.kind === 'session' ? point : null)
        if (vault === null) return false
        const made = openWindow({ root: vault, file: action.kind === 'open' ? action.path : null }, besideFilesBounds(files.bounds, host.workAreas()))
        const win = live.get(made)
        // Anything else waits for its page to listen (`sendLink` holds it until `link:ready`).
        if (action.kind !== 'open' && win !== undefined) sendLink(win, CONTRACT.link.onOpenFromFiles.channel, action)
        return true
      }
      const win = live.get(id)
      if (win === undefined) return false
      // D7: a preview comes to the front with no focus, so the arrows keep browsing the Files window; a background tab raises nothing.
      if (action.kind === 'open' && action.how === 'preview') {
        if (win.isMinimized()) win.restore()
        win.moveTop()
      } else if (action.kind !== 'open' || action.how !== 'background') focusWindow(win)
      sendLink(win, CONTRACT.link.onOpenFromFiles.channel, action)
      return true
    },

    filesWide(id, open) {
      const win = liveWindow(id)
      const entry = entryOf(id)
      if (win === undefined || entry === undefined || !isFilesWindow(entry)) return false
      if (open) {
        if (wideFiles.has(id)) return true
        // The narrow bounds as they stand now go in the store first; from here on `commitBounds` leaves them.
        commitBounds(id, win)
        wideFiles.add(id)
        const narrow = entryOf(id)?.bounds ?? entry.bounds
        // At once, not animated (D10): macOS's animation lays the page out on every frame of it.
        // The board's width is page px, the App size larger on the screen (YAZ-3441).
        win.setBounds(clampBounds({ ...narrow, width: Math.max(narrow.width, wideWidth()) }, host.workAreas()), false)
      } else if (wideFiles.delete(id)) win.setBounds(entry.bounds, false)
      return true
    },

    appZoomChanged(from, to) {
      if (from === to || from <= 0) return
      for (const entry of store.get().windows) {
        if (!isFilesWindow(entry)) continue
        // Its zoom menu is open (YAZ-3444): it waits for the close, from the App size before the FIRST change, so
        // 100 → 110 → 125 ends as 100 → 125 would, with no rounding drift.
        if (zoomMenus.has(entry.id)) {
          if (zoomMenus.get(entry.id) === null) zoomMenus.set(entry.id, from)
          continue
        }
        scaleFilesWindow(entry, from, to)
      }
    },

    filesZoomMenu(id, open) {
      const entry = entryOf(id)
      if (entry === undefined || !isFilesWindow(entry) || liveWindow(id) === undefined) return false
      if (open) {
        if (!zoomMenus.has(id)) zoomMenus.set(id, null)
      } else zoomMenuClosed(id)
      return true
    },

    filesToNormal(id) {
      const win = liveWindow(id)
      const entry = entryOf(id)
      if (win === undefined || entry === undefined || !isFilesWindow(entry)) return false
      // Where it stands now, by its narrow bounds when the board made it wide; a full window's width.
      const at = wideFiles.has(id) ? entry.bounds : win.getBounds()
      const next = randomUUID()
      emptyStarts.add(next)
      // The new window first: the Files window's close must never be the app's last.
      open({ id: next, root: entry.root, roots: [...entry.roots], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: entry.sidebarLens, bounds: clampBounds({ ...at, width: Math.max(at.width, DEFAULT_BOUNDS.width) }, host.workAreas()) })
      win.close()
      return true
    },

    setFilesZoom(id, percent) {
      const entry = entryOf(id)
      if (entry === undefined || !isFilesWindow(entry)) return false
      const zoom = normalizeFilesZoom(percent)
      // The same value writes nothing (YAZ-3394): no commit, no broadcast.
      if (entry.zoom !== zoom) store.upsertWindow({ ...entry, zoom })
      return true
    },

    filesPreview(id, req) {
      const win = liveWindow(id)
      const entry = entryOf(id)
      if (win === undefined || entry === undefined || !isFilesWindow(entry)) return false
      // `req` is in the page's px; the screen's are the App size larger (YAZ-3432), and the popup has that zoom too.
      const z = appZoomFactor(store.get().settings)
      const onScreen = req === null ? null : { width: req.width * z, height: req.height * z, top: req.top * z, bottom: req.bottom * z }
      host.showPreview(win, onScreen === null ? null : filesPreviewBounds(win.getContentBounds(), host.workAreas(), onScreen))
      return true
    },

    async flushAllForQuit() {
      // "Last vault" is the vault you were in (YAZ-2589 A1): `recents[0]` can be behind the window in front,
      // because a window's first focus does not bump it (YAZ-2555 D5). So record it here, before `quitting`
      // stops the bumps and the windows go; `runQuitSequence` flushes the store after this. Of a window that
      // shows several vaults it is the active one (YAZ-2602 A8).
      noteUsed(activeVault(entryOf(focusOrder[0])))
      quitting = true
      // Every renderer at once (YAZ-2198): quit waits one FLUSH_TIMEOUT_MS cap in total, not one per
      // window, and still resolves only once every window has flushed (`runQuitSequence`'s order).
      const wins = [...live].filter(([, win]) => !win.isDestroyed())
      for (const [id, win] of wins) commitBounds(id, win)
      await Promise.all(
        wins.map(async ([, win]) => {
          await flushRenderer(win)
          if (!win.isDestroyed()) win.destroy()
        }),
      )
    },
  }
}
