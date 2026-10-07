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
import { DEFAULT_SIDEBAR_LENS, defaultRightPanelIdentity, stripSlash, type OpenWindowOptions, type RecentRoots, type StartupWindows, type WindowBounds, type WindowEntry } from '@shared/types'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import type { Store } from './store'

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

const DEFAULT_BOUNDS: WindowBounds = { x: 100, y: 100, width: 1200, height: 800 }

/** The slice of `BrowserWindow` the manager drives; a test fake implements it in a few lines. */
export interface ManagedWindow {
  webContents: { id: number; send(channel: string, ...args: unknown[]): void }
  getBounds(): WindowBounds
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  focus(): void
  /** Like Electron's: emits `close` first — the manager intercepts it to run the flush handshake. */
  close(): void
  /** Like Electron's: destroys without emitting `close` (`closed` still fires). */
  destroy(): void
  on(event: 'move' | 'resize' | 'closed' | 'focus', listener: () => void): unknown
  on(event: 'close', listener: (e: { preventDefault(): void }) => void): unknown
}

/** The Electron-only half, injected by `main/index.ts`: window construction and display geometry. */
export interface WindowHost {
  /** Builds the `BrowserWindow` at `entry.bounds` and loads `<renderer>?win=<entry.id>`. */
  create(entry: WindowEntry): ManagedWindow
  /** Every display's workArea, primary first (`clampBounds` keeps the earliest area on ties). */
  workAreas(): WindowBounds[]
  /** Whether `path` exists as a regular file — `routeToFile` (E1) probes before opening anything, and `rootFor` before it counts the path as asked for (YAZ-2589 A6). */
  exists(path: string): boolean
  /** Whether `path` exists as a directory — `openRecentBeside` probes before touching the MRU (GRO-2211, moved here by YAZ-1767), and `routeToFile` asks it first: a folder goes to that door (YAZ-2556 D1). */
  dirExists(path: string): boolean
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
  /** D6 plumbing: same folder + file as `from`, cascaded bounds, fresh id (the ⌘⇧N gesture is GRO-2167). */
  duplicateWindow(from: WindowEntry): void
  /**
   * The ONE back-end door for "open a recent vault" (YAZ-1767 🔒 D1): the sidebar's vault
   * switcher and App's `openVault` (a vault window's Open Folder… / Open Recent, YAZ-1914) land here via `window:open-recent`, the Window menu's vault rows (⌘1–⌘9, YAZ-2555 D3) call it in main, and so does
   * `routeToFile` for a FOLDER that comes from outside the app (YAZ-2556 D1). Probes
   * the directory FIRST (GRO-2211): a dead folder is pruned from the MRU and opens nothing →
   * `false`. A live one is bumped to the top of the MRU, then (🔒 D9) every live window already
   * on that vault is RAISED — most recently focused on top — and nothing new opens; with none
   * open, a new window opens on the vault's remembered `folders[root].lastFile` (D2). → `true`.
   */
  openRecentBeside(path: string): boolean
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
  /** `link:ready` arrived from this renderer (wired in `ipc/window.ts`): it listens now, so the link pushes held for it go out (YAZ-2589 A2). */
  handleLinkReady(sender: { id: number }): void
  /** `app:flushed` arrived from this renderer (wired in `ipc/window.ts`). */
  handleFlushed(sender: { id: number }): void
  /** `before-quit`: record the vault of the window in front (YAZ-2589 A1), then handshake every window at once (YAZ-2198); `windows[]` is kept, and the next launch brings back what it is asked for. */
  flushAllForQuit(): Promise<void>
}

/** What the IPC layer (`ipc/window.ts`) needs from the manager; tests fake just this slice. */
export type WindowManagerIpc = Pick<WindowManager, 'idFor' | 'openWindow' | 'duplicateWindow' | 'openRecentBeside' | 'closeWindow' | 'handleFlushed' | 'handleLinkReady'>

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

/**
 * Restored bounds must land on a display that still exists: the window goes fully inside the
 * work area it overlaps most (fully off-screen → the nearest one; ties keep the earliest, so
 * callers pass the primary first), shrunk to fit if oversized. No work areas at all leaves
 * the bounds alone (nothing to clamp against).
 */
export function clampBounds(bounds: WindowBounds, workAreas: readonly WindowBounds[]): WindowBounds {
  if (workAreas.length === 0) return bounds
  let area = workAreas[0]
  let best = overlapArea(bounds, area)
  for (const wa of workAreas) {
    const o = overlapArea(bounds, wa)
    if (o > best) {
      area = wa
      best = o
    }
  }
  if (best === 0) area = workAreas.reduce((a, b) => (centreDistanceSq(bounds, b) < centreDistanceSq(bounds, a) ? b : a))
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

// ---------- deep-link routing (pure, E1 GRO-2171) ----------

export type LinkTarget = { kind: 'existing'; id: string; root: string } | { kind: 'new'; root: string; file: string }

/** `root` is an ancestor directory of `path` (or its dirname) — by segment, so `/a/b` never contains `/a/bc/x.md`. */
const rootContains = (root: string, path: string): boolean => {
  const r = stripSlash(root)
  return path.startsWith(r === '/' ? '/' : r + '/') && path.length > r.length + 1
}

/**
 * Where a `yaseendocs://` link to `path` should land: (1) the open window whose root contains
 * it — most specific root wins, ties keep the first in `windows[]`, Welcome windows never match;
 * (2) a new window on the most recent `recents` folder containing it (the list is already
 * most-recent-first); (3) a new window on the file's parent folder. A containing `rootOverride`
 * pins the effective root instead: the open window on exactly that root, else a new window there.
 * Both kinds say the `root`: the vault the path belongs to (`rootFor`, YAZ-2589 D1).
 */
export function resolveLinkTarget(
  path: string,
  windows: readonly WindowEntry[],
  recents: RecentRoots,
  rootOverride?: string | null,
): LinkTarget {
  if (rootOverride != null && rootContains(rootOverride, path)) {
    for (const w of windows) if (w.root !== null && stripSlash(w.root) === stripSlash(rootOverride)) return { kind: 'existing', id: w.id, root: w.root }
    return { kind: 'new', root: rootOverride, file: path }
  }
  let best: { id: string; root: string } | undefined
  for (const w of windows) {
    if (w.root === null || !rootContains(w.root, path)) continue
    if (best === undefined || w.root.length > best.root.length) best = { id: w.id, root: w.root }
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
      if (!quitting) noteUsed(entryOf(id)?.root ?? null)
      focusOrder.splice(at, 1)
    }
    focusOrder.unshift(id)
  }

  const entryOf = (id: string): WindowEntry | undefined => store.get().windows.find((w) => w.id === id)

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

  /** Patch only `bounds` onto the entry as it is NOW (the renderer may have changed root/file since). */
  const commitBounds = (id: string, win: ManagedWindow): void => {
    const entry = entryOf(id)
    if (entry === undefined || win.isDestroyed()) return
    const bounds = win.getBounds()
    if (!sameBounds(bounds, entry.bounds)) store.upsertWindow({ ...entry, bounds })
  }

  const attach = (entry: WindowEntry): void => {
    const win = host.create(entry)
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
      heldLinks.delete(wcId)
      const at = focusOrder.indexOf(id)
      if (at !== -1) focusOrder.splice(at, 1)
      if (quitting) return
      // A user close forgets the window; the LAST one closing quits the app (`window-all-closed`), so that is
      // a quit too: its entry stays, and its vault is the "last vault" (YAZ-2589 A1).
      if (live.size > 0) store.removeWindow(id)
      else noteUsed(entryOf(id)?.root ?? null)
    })
  }

  const open = (entry: WindowEntry): void => {
    store.upsertWindow(entry)
    attach(entry)
  }

  const openWindow = (opts: OpenWindowOptions): void => {
    // A window opened on a vault is a use of that vault (YAZ-2555 D5); its first focus does not count.
    noteUsed(opts.root)
    open({ id: randomUUID(), root: opts.root, file: opts.file, tabs: opts.file === null ? [] : [opts.file], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: DEFAULT_SIDEBAR_LENS, focusDirs: [], focusFavorites: [], bounds: clampBounds({ ...DEFAULT_BOUNDS }, host.workAreas()) })
  }

  const focusWindow = (win: ManagedWindow): void => {
    if (win.isMinimized()) win.restore()
    win.focus()
  }

  /** A link push to `win`: at once when its renderer listens, else held for `handleLinkReady` (YAZ-2589 A2). */
  const sendLink = (win: ManagedWindow, channel: string, payload: string): void => {
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

  /** The one open-recent door (see `WindowManager.openRecentBeside`). A `const`, like `openWindow`, so `routeToFile` can call it too (YAZ-2556 D1). */
  const openRecentBeside = (path: string): boolean => {
    // Beside never passes through the renderer's validating openRoot, so probe here: a dead
    // folder is pruned from the MRU (mirrors the Welcome/in-place path) and opens nothing.
    if (!host.dirExists(path)) {
      store.removeRecent(path)
      return false
    }
    // Opening beside never lands in the renderer that bumps the MRU on an in-place open, so bump here
    // — through `noteUsed`: a vault that is already on top is not written again (YAZ-2555 D5, S25).
    noteUsed(path)
    // Already open (YAZ-1767 🔒 D9): raise that vault's live windows instead of opening a third
    // copy — LEAST recently focused first, so the most recently focused one ends on top (a
    // window never focused ranks last). Roots compare like `resolveLinkTarget`: trailing slash off.
    const wanted = stripSlash(path)
    const alreadyOpen = store
      .get()
      .windows.filter((w) => w.root !== null && stripSlash(w.root) === wanted)
      .map((w) => ({ id: w.id, win: live.get(w.id) }))
      .filter((w): w is { id: string; win: ManagedWindow } => w.win !== undefined && !w.win.isDestroyed())
    if (alreadyOpen.length > 0) {
      const rank = (id: string): number => {
        const at = focusOrder.indexOf(id)
        return at === -1 ? Number.POSITIVE_INFINITY : at
      }
      for (const { win } of alreadyOpen.sort((a, b) => rank(b.id) - rank(a.id))) focusWindow(win)
      return true
    }
    openWindow({ root: path, file: store.get().folders[path]?.lastFile ?? null })
    return true
  }

  return {
    idFor,

    rootFor(path, rootOverride) {
      if (host.dirExists(path)) return stripSlash(path)
      if (cannotOpen(path) !== null) return null
      const state = store.get()
      return resolveLinkTarget(path, state.windows, state.recents, rootOverride).root
    },

    restore(which) {
      const state = store.get()
      // The vaults whose windows come back: the ones asked for (D1), or for "last" the vault used last (D2; the quit recorded it, A1).
      const roots = (typeof which !== 'string' ? which : which === 'last' ? state.recents.slice(0, 1).map((r) => r.path) : []).map(stripSlash)
      const keep = (w: WindowEntry): boolean => which === 'all' || (w.root !== null && roots.includes(stripSlash(w.root)))
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
        const cascaded = { ...from.bounds, x: from.bounds.x + WINDOW_CASCADE_PX, y: from.bounds.y + WINDOW_CASCADE_PX }
        // Clone every ordered path list so the new window's durable identity cannot alias the source;
        // sidebar visibility, the lens and the two Focus Mode lists (YAZ-1628, YAZ-1766) are copied by value and then persist independently.
        open({
          id: randomUUID(),
          root: from.root,
          file: from.file,
          tabs: [...from.tabs],
          rightPanel: { ...from.rightPanel, items: [...from.rightPanel.items] },
          sidebarCollapsed: from.sidebarCollapsed,
          sidebarLens: from.sidebarLens,
          focusDirs: [...from.focusDirs],
          focusFavorites: [...from.focusFavorites],
          bounds: clampBounds(cascaded, host.workAreas()),
        })
    },

    openRecentBeside,

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
      const target = resolveLinkTarget(path, state.windows, state.recents, rootOverride)
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

    handleLinkReady(sender) {
      for (const send of heldLinks.get(sender.id) ?? []) send()
      heldLinks.delete(sender.id)
    },

    handleFlushed(sender) {
      pendingFlush.get(sender.id)?.settle()
    },

    async flushAllForQuit() {
      // "Last vault" is the vault you were in (YAZ-2589 A1): `recents[0]` can be behind the window in front,
      // because a window's first focus does not bump it (YAZ-2555 D5). So record it here, before `quitting`
      // stops the bumps and the windows go; `runQuitSequence` flushes the store after this.
      noteUsed(entryOf(focusOrder[0])?.root ?? null)
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
