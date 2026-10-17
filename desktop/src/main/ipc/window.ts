import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { MAX_FOLD_KEYS_PER_FILE, MAX_WINDOW_ROOTS, isSidebarLens, rootOfPath, type OpenSetResult, type PageView, type PopOutCarry, type RightPanelIdentity, type SidebarLens, type WindowEntry, type WindowIdentity } from '@shared/types'
import { isRecord } from '@shared/guards'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { normalizeRightPanel, normalizeTabs, type Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { handle, handleWithEvent } from './envelope'

/** `root` / `file` in the patch: absent (untouched), null, or an absolute path. */
function optionalPath(raw: Record<string, unknown>, key: 'root' | 'file'): string | null | undefined {
  const v = raw[key]
  if (v === undefined || v === null) return v
  if (typeof v !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${key}' must be a string or null`)
  return requireAbsPath(v, key)
}

/** `tabs` in the patch (GRO-2232): absent (untouched), or absolute paths only — one bad element rejects the whole call. */
function optionalTabs(raw: Record<string, unknown>): string[] | undefined {
  const v = raw.tabs
  if (v === undefined) return undefined
  if (!Array.isArray(v)) throw new BridgeFailure('BAD_REQUEST', `'tabs' must be an array of absolute paths`)
  return v.map((t, i) => requireAbsPath(t, `tabs[${i}]`))
}

/** `roots` in the patch (YAZ-2602 D1): `tabs`' rule — absent (untouched), or absolute paths only, MAX_WINDOW_ROOTS at most. */
function optionalRoots(raw: Record<string, unknown>): string[] | undefined {
  const v = raw.roots
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length > MAX_WINDOW_ROOTS) throw new BridgeFailure('BAD_REQUEST', `'roots' must be an array of at most ${MAX_WINDOW_ROOTS} absolute paths`)
  return v.map((r, i) => requireAbsPath(r, `roots[${i}]`))
}

/** `rightPanel` is an all-or-nothing identity patch; store normalization repairs its invariants. */
function optionalRightPanel(raw: Record<string, unknown>): RightPanelIdentity | undefined {
  const value = raw.rightPanel
  if (value === undefined) return undefined
  if (!isRecord(value)
    || typeof value.open !== 'boolean'
    || typeof value.width !== 'number'
    || !Number.isFinite(value.width)
    || !Array.isArray(value.items)
    || (value.expanded !== null && typeof value.expanded !== 'string')) {
    throw new BridgeFailure('BAD_REQUEST', "'rightPanel' must be a complete panel identity")
  }
  const items = value.items.map((item, i) => requireAbsPath(item, `rightPanel.items[${i}]`))
  const expanded = value.expanded === null ? null : requireAbsPath(value.expanded, 'rightPanel.expanded')
  return { open: value.open, width: value.width, items, expanded }
}

/** `sidebarCollapsed`: absent (untouched), or a boolean. */
function optionalSidebarCollapsed(raw: Record<string, unknown>): boolean | undefined {
  const v = raw.sidebarCollapsed
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'sidebarCollapsed' must be a boolean")
  return v
}

/** `sidebarLens` (YAZ-1628): absent (untouched), or one of the three lenses (YAZ-2619). */
function optionalSidebarLens(raw: Record<string, unknown>): SidebarLens | undefined {
  const v = raw.sidebarLens
  if (v === undefined) return undefined
  if (!isSidebarLens(v)) throw new BridgeFailure('BAD_REQUEST', "'sidebarLens' must be 'files', 'focus' or 'favorites'")
  return v
}

/**
 * A page view from the renderer (YAZ-2951 D5, S19): a copy of a good one, folds cut at
 * MAX_FOLD_KEYS_PER_FILE; anything else is `undefined`, so the new window opens with no page view
 * rather than not at all.
 */
function optionalPageView(v: unknown): PageView | undefined {
  if (!isRecord(v)) return undefined
  const { scrollTop, zoomKey, folds, magnification } = v
  if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop)) return undefined
  if (zoomKey !== null && typeof zoomKey !== 'string') return undefined
  if (!Array.isArray(folds) || !folds.every((k) => typeof k === 'string')) return undefined
  if (typeof magnification !== 'number' || !Number.isFinite(magnification)) return undefined
  return { scrollTop, zoomKey, folds: (folds as string[]).slice(0, MAX_FOLD_KEYS_PER_FILE), magnification }
}

/** "Move to new window"'s carry (YAZ-2951 D2): absent, or an object whose `view` passes `optionalPageView`. */
function optionalPopOutCarry(v: unknown): PopOutCarry {
  if (v === undefined) return {}
  if (!isRecord(v)) throw new BridgeFailure('BAD_REQUEST', "'carry' must be an object")
  const view = optionalPageView(v.view)
  return view === undefined ? {} : { view }
}

/** A saved set's `id` or `name` (YAZ-2602 D8): a string; the store decides what it names. */
function requireString(v: unknown, param: 'id' | 'name'): string {
  if (typeof v !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${param}' must be a string`)
  return v
}

/**
 * The `window.*` half of `window.yaseenDocs`. The caller is resolved through the window lookup
 * (`webContents.id` → window id) and answered from `AppState.windows`. `open` / `duplicate`
 * are D6 plumbing into the window manager (GRO-2160; the gestures land in D-), and
 * `app:flushed` is the renderer's half of the close/quit flush handshake. One door of `link.*` is
 * answered here too, because it needs the caller's window: `link:ready` (YAZ-2589 A2).
 */
export function registerWindowIpc(store: Store, windows: WindowManagerIpc): void {
  const entryFor = (e: IpcMainInvokeEvent): WindowEntry => {
    const id = windows.idFor(e.sender)
    if (id === undefined) throw new BridgeFailure('BAD_REQUEST', 'sender is not a registered window')
    const entry = store.get().windows.find((w) => w.id === id)
    if (entry === undefined) throw new BridgeFailure('NOT_FOUND', `window ${id} is not in the app state`)
    return entry
  }

  handleWithEvent(CONTRACT.window.identity, async (e): Promise<WindowIdentity> => {
    const { id, root, roots, file, tabs, rightPanel, sidebarCollapsed, sidebarLens } = entryFor(e)
    // A new window's page view goes out with its FIRST identity only (YAZ-2951 S17): a reload starts fresh.
    const startView = windows.takeStartView(id)
    return { id, root, roots: [...roots], file, tabs: [...tabs], rightPanel: { ...rightPanel, items: [...rightPanel.items] }, sidebarCollapsed, sidebarLens, ...(startView !== undefined ? { startView } : {}) }
  })

  handleWithEvent(CONTRACT.window.setIdentity, async (e, patch: unknown) => {
    if (!isRecord(patch)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
    const patchRoots = optionalRoots(patch)
    // The vault list leads (YAZ-2602 S76): with `roots` in the patch, `root` is its first entry.
    const root = patchRoots !== undefined ? (patchRoots[0] ?? null) : optionalPath(patch, 'root')
    const file = optionalPath(patch, 'file')
    const tabs = optionalTabs(patch)
    const rightPanel = optionalRightPanel(patch)
    const sidebarCollapsed = optionalSidebarCollapsed(patch)
    const sidebarLens = optionalSidebarLens(patch)
    const entry = entryFor(e)
    // The tabs invariant holds on the entry AS WRITTEN (GRO-2232): the loader's repair rule,
    // applied to whichever of `file` / `tabs` the patch left untouched.
    const nextFile = file !== undefined ? file : entry.file
    const nextTabs = normalizeTabs(tabs ?? entry.tabs, nextFile)
    // `root` alone keeps the list when it names the vault the window is already on, and is the whole list otherwise (YAZ-2602 A10).
    const roots = patchRoots ?? (root === undefined || root === entry.root ? entry.roots : [])
    // A page comes on show (YAZ-2663 D1): `file` is in the patch, names a page, and is not the page the window had.
    // The store adds the use in the commit of the window (R2). A restored window sends no patch at its start, so a launch adds none (S10).
    const opened = file != null && file !== entry.file ? file : null
    store.upsertWindow({
      ...entry,
      ...(root !== undefined ? { root } : {}),
      roots,
      ...(sidebarCollapsed !== undefined ? { sidebarCollapsed } : {}),
      ...(sidebarLens !== undefined ? { sidebarLens } : {}),
      file: nextFile,
      tabs: nextTabs,
      rightPanel: normalizeRightPanel(rightPanel ?? entry.rightPanel, nextTabs),
    }, opened)
  })

  // `window:close-self` (GRO-2232): the REAL close on the caller's own window, so the
  // close/flush handshake in windows.ts runs — never a destroy. Resolved via the window lookup
  // only (no state lookup): a window mid-close can still ask.
  handleWithEvent(CONTRACT.window.closeSelf, async (e) => {
    const id = windows.idFor(e.sender)
    if (id === undefined) throw new BridgeFailure('BAD_REQUEST', 'sender is not a registered window')
    windows.closeWindow(id)
  })

  // `window:zoom` (YAZ-1710): the app-wide zoom the stock roles used to do, on the caller's own
  // window — level ± 0.5 per step, 0 for Actual Size. The renderer calls this only when no note
  // has focus; a focused note zooms itself.
  handleWithEvent(CONTRACT.window.zoom, async (e, step: unknown) => {
    if (step !== -1 && step !== 0 && step !== 1) throw new BridgeFailure('BAD_REQUEST', 'step must be -1, 0 or 1')
    e.sender.setZoomLevel(step === 0 ? 0 : e.sender.getZoomLevel() + 0.5 * step)
  })

  handle(CONTRACT.window.open, async (opts: unknown) => {
    if (!isRecord(opts)) throw new BridgeFailure('BAD_REQUEST', 'options must be an object')
    windows.openWindow({ root: optionalPath(opts, 'root') ?? null, file: optionalPath(opts, 'file') ?? null })
  })

  // `window:duplicate` (⌘⇧N, YAZ-2951 D5): the window asks after it saved its page, with the page view of the tab on show.
  handleWithEvent(CONTRACT.window.duplicate, async (e, view: unknown) => {
    windows.duplicateWindow(entryFor(e), optionalPageView(view))
  })

  // `window:pop-out` (YAZ-2933 D1): a tab's "Move to new window". Main copies the CALLER's window, so the
  // renderer never names a list of vaults; a path in no vault of that window is no tab of it.
  handleWithEvent(CONTRACT.window.popOut, async (e, path: unknown, carry: unknown) => {
    const from = entryFor(e)
    const target = requireAbsPath(path, 'path')
    if (rootOfPath(from.roots, target) === null) throw new BridgeFailure('BAD_REQUEST', 'path is in no vault of this window')
    windows.popOut(from, target, optionalPopOutCarry(carry))
  })

  // `window:open-recent` (YAZ-1767 D1): the vault switcher's door — an absolute path in, and the
  // manager's verdict out: true = the vault is in front (its windows raised, D9, or a new one
  // opened; MRU bumped), false = the folder is gone and was pruned from the MRU instead. Any
  // window may ask; the caller is not consulted.
  handle(CONTRACT.window.openRecent, async (path: unknown): Promise<boolean> => windows.openRecentBeside(requireAbsPath(path, 'path')))
  // `window:open-alone` (YAZ-2858 D1): "Open by itself" — the same contract, but main raises only a
  // window that shows this vault alone, else it opens a new one.
  handle(CONTRACT.window.openAlone, async (path: unknown): Promise<boolean> => windows.openAlone(requireAbsPath(path, 'path')))

  // Saved sets of vaults (YAZ-2602 D8; the user reads "workspace"). `window:open-set` is the
  // manager's door: what opened, and the folders that are gone. Any window may ask it, and may
  // rename or remove a set. `window:save-set` saves the CALLER's own vaults, so the renderer never
  // sends a list; false = the store refused (fewer than two vaults, an empty name, or R12).
  handle(CONTRACT.window.openSet, async (id: unknown): Promise<OpenSetResult> => windows.openVaultSet(requireString(id, 'id')))
  handleWithEvent(CONTRACT.window.saveSet, async (e, name: unknown): Promise<boolean> => store.saveVaultSet(requireString(name, 'name'), entryFor(e).roots) !== null)
  handle(CONTRACT.window.renameSet, async (id: unknown, name: unknown): Promise<boolean> => store.renameVaultSet(requireString(id, 'id'), requireString(name, 'name')))
  handle(CONTRACT.window.removeSet, async (id: unknown) => {
    store.removeVaultSet(requireString(id, 'id'))
  })

  // Explicit paste outside a Crepe editor uses Chromium insertion for native selection/undo.
  handleWithEvent(SPECIAL.menuPasteTextFallback, async (e, text: unknown) => {
    if (windows.idFor(e.sender) === undefined || typeof text !== 'string') throw new BridgeFailure('BAD_REQUEST', 'invalid paste target or text')
    if (text !== '') await e.sender.insertText(text)
  })

  // `link:ready` (YAZ-2589 A2): this renderer now listens for link pushes, so the manager sends
  // what it held for it.
  handleWithEvent(CONTRACT.link.ready, async (e) => windows.handleLinkReady(e.sender))

  // The renderer's ack in the flush handshake (fire-and-forget send, so no envelope).
  ipcMain.on(SPECIAL.appFlushed, (e) => windows.handleFlushed(e.sender))
}
