import { existsSync } from 'node:fs'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { MAX_FOLD_KEYS_PER_FILE, MAX_WINDOW_ROOTS, cleanVaultName, isSidebarLens, normalizeFilesZoom, rootOfPath, type FilesAction, type FilesPreviewRequest, type OpenSetResult, type PageView, type RestoreSessionResult, type PopOutCarry, type RightPanelIdentity, type SidebarLens, type StoredTab, type TabAction, type TabRef, type WindowEntry, type WindowIdentity } from '@shared/types'
import { isRecord } from '@shared/guards'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { normalizeRightPanel, normalizeTabs, readStoredTab, readTabRef, type Store } from '../store'
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

/** `tabStrip` in the patch (YAZ-3057): absent (untouched), or tabs with absolute paths — one bad element rejects the whole call. */
function optionalTabStrip(raw: Record<string, unknown>, key: 'tabStrip' | 'tabs' = 'tabStrip'): StoredTab[] | undefined {
  const v = raw[key]
  if (v === undefined) return undefined
  if (!Array.isArray(v)) throw new BridgeFailure('BAD_REQUEST', `'${key}' must be an array of tabs`)
  return v.map((t, i) => {
    const tab = readStoredTab(t)
    if (tab === null) throw new BridgeFailure('BAD_REQUEST', `'${key}[${i}]' must be { path, name?, active? } with an absolute path`)
    return tab
  })
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

/** `sidebarLens` (YAZ-1628): absent (untouched), or one of the five lenses (YAZ-2619; Sessions, YAZ-3147 D4; Recents, YAZ-3235 D4). */
function optionalSidebarLens(raw: Record<string, unknown>): SidebarLens | undefined {
  const v = raw.sidebarLens
  if (v === undefined) return undefined
  if (!isSidebarLens(v)) throw new BridgeFailure('BAD_REQUEST', "'sidebarLens' must be 'files', 'focus', 'favorites', 'sessions' or 'recents'")
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

/** "Move to new window"'s carry (YAZ-2951 D2, YAZ-2949 D7): absent, or an object whose `view` passes `optionalPageView`, with an optional display `name`. */
function optionalPopOutCarry(v: unknown): PopOutCarry {
  if (v === undefined) return {}
  if (!isRecord(v)) throw new BridgeFailure('BAD_REQUEST', "'carry' must be an object")
  const view = optionalPageView(v.view)
  // The tab's display name (YAZ-2949 D7) is only a label: cleaned like a vault's name, and a blank or
  // non-string name is no name — never an error.
  const name = cleanVaultName(v.name)
  // A quiet move (YAZ-3343 D13): only `true` is one; anything else is the ordinary move.
  return { ...(view === undefined ? {} : { view }), ...(name === null ? {} : { name }), ...(v.background === true ? { background: true as const } : {}) }
}

/** A saved set's or a session's `id` or `name` (YAZ-2602 D8, YAZ-3147 D2), or a window id `to` / `from` (YAZ-3343): a string; the store decides what it names. */
function requireString(v: unknown, param: 'id' | 'name' | 'to' | 'from'): string {
  if (typeof v !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${param}' must be a string`)
  return v
}

/** The most tabs one `window:close-tabs` call names (YAZ-3343 D3): far more than a window holds, so a junk list is refused whole. */
export const MAX_CLOSE_REFS = 1000

/** A tab of a window named without its id (YAZ-3343 D3): `{ path, copy }`, an absolute path and a whole copy number from 0. */
function requireTabRef(v: unknown, param: string): TabRef {
  if (isRecord(v)) requireAbsPath(v.path, `${param}.path`)
  const ref = readTabRef(v)
  if (ref === null) throw new BridgeFailure('BAD_REQUEST', `'${param}' must be { path, copy } with an absolute path and a whole copy number from 0`)
  return ref
}

/** A Files window's action (YAZ-3357 D2): one of the union's shapes, its paths absolute and in a vault of the Files window `from`. */
function requireFilesAction(v: unknown, from: WindowEntry): FilesAction {
  if (!isRecord(v)) throw new BridgeFailure('BAD_REQUEST', "'action' must be an object")
  const inVault = (raw: unknown, param: string): string => {
    const path = requireAbsPath(raw, param)
    if (rootOfPath(from.roots, path) === null) throw new BridgeFailure('BAD_REQUEST', `'${param}' is in no vault of this window`)
    return path
  }
  switch (v.kind) {
    case 'open':
      if (v.how !== 'preview' && v.how !== 'keep' && v.how !== 'background') throw new BridgeFailure('BAD_REQUEST', "'action.how' must be preview, keep or background")
      return { kind: 'open', path: inVault(v.path, 'action.path'), how: v.how }
    case 'history':
    case 'share':
      return { kind: v.kind, path: inVault(v.path, 'action.path') }
    case 'review':
      return { kind: 'review', dir: inVault(v.dir, 'action.dir') }
    case 'inbox':
      return { kind: 'inbox', root: inVault(v.root, 'action.root') }
    case 'session':
      return { kind: 'session', id: requireString(v.id, 'id') }
    default:
      throw new BridgeFailure('BAD_REQUEST', "'action.kind' must be open, history, share, review, inbox or session")
  }
}

/** The floating preview's place (YAZ-3357 D9): four finite numbers, the size above 0. */
function requireFilesPreview(v: unknown): FilesPreviewRequest {
  if (!isRecord(v) || ![v.width, v.height, v.top, v.bottom].every((n) => typeof n === 'number' && Number.isFinite(n)) || (v.width as number) <= 0 || (v.height as number) <= 0) {
    throw new BridgeFailure('BAD_REQUEST', "'req' must be { width, height, top, bottom } with a size above 0")
  }
  return { width: v.width as number, height: v.height as number, top: v.top as number, bottom: v.bottom as number }
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
    const { id, root, roots, file, tabs, tabStrip, name, rightPanel, sidebarCollapsed, sidebarLens, kind, zoom } = entryFor(e)
    // A new window's page view goes out with its FIRST identity only (YAZ-2951 S17): a reload starts fresh.
    const startView = windows.takeStartView(id)
    // A window the tab board opened empty (YAZ-3343) says so once: it boots with no tab.
    const startEmpty = windows.takeStartEmpty(id)
    // A Files window's page that starts (a launch, a reload) starts with its board closed (YAZ-3357 D3, D10; bug YAZ-3392):
    // main ends a wide state left from the page before, so the window is narrow again and the next board grows it.
    if (kind === 'files') windows.filesWide(id, false)
    // The copies and display names (YAZ-3057) go out with EVERY identity read: a reload keeps them, as a restart does.
    return { id, root, roots: [...roots], file, tabs: [...tabs], ...(tabStrip === undefined ? {} : { tabStrip: tabStrip.map((t) => ({ ...t })) }), ...(name === undefined ? {} : { name }), rightPanel: { ...rightPanel, items: [...rightPanel.items] }, sidebarCollapsed, sidebarLens, ...(startView !== undefined ? { startView } : {}), ...(startEmpty ? { startEmpty: true as const } : {}), ...(kind === undefined ? {} : { kind }), ...(kind === 'files' ? { zoom: normalizeFilesZoom(zoom) } : {}) }
  })

  handleWithEvent(CONTRACT.window.setIdentity, async (e, patch: unknown) => {
    if (!isRecord(patch)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
    const patchRoots = optionalRoots(patch)
    // The vault list leads (YAZ-2602 S76): with `roots` in the patch, `root` is its first entry.
    const root = patchRoots !== undefined ? (patchRoots[0] ?? null) : optionalPath(patch, 'root')
    const file = optionalPath(patch, 'file')
    const tabs = optionalTabs(patch)
    const tabStrip = optionalTabStrip(patch)
    const rightPanel = optionalRightPanel(patch)
    const sidebarCollapsed = optionalSidebarCollapsed(patch)
    const sidebarLens = optionalSidebarLens(patch)
    // A `name` in the patch is an unknown key and is ignored: a window is named through `window:set-name` alone (YAZ-3343 D14).
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
      // A patch without the strip keeps the stored one; the store makes it true to the new `tabs` (YAZ-3057).
      ...(tabStrip !== undefined ? { tabStrip } : {}),
      rightPanel: normalizeRightPanel(rightPanel ?? entry.rightPanel, nextTabs),
    }, opened)
  })

  // `window:files-zoom` (YAZ-3389 D13): the caller's OWN Files window sidebar zoom, a percent; main normalizes and stores it.
  handleWithEvent(CONTRACT.window.filesZoom, async (e, percent: unknown) => {
    if (typeof percent !== 'number' || !Number.isFinite(percent)) throw new BridgeFailure('BAD_REQUEST', 'percent must be a finite number')
    const id = windows.idFor(e.sender)
    if (id === undefined || !windows.setFilesZoom(id, percent)) throw new BridgeFailure('BAD_REQUEST', 'sender is not a Files window')
  })

  // `window:files-zoom-menu` (YAZ-3444): the caller's OWN Files window's zoom menu opened or closed; main holds that
  // window's resize for a new App size until the close.
  handleWithEvent(CONTRACT.window.filesZoomMenu, async (e, open: unknown) => {
    if (typeof open !== 'boolean') throw new BridgeFailure('BAD_REQUEST', 'open must be a boolean')
    const id = windows.idFor(e.sender)
    if (id === undefined || !windows.filesZoomMenu(id, open)) throw new BridgeFailure('BAD_REQUEST', 'sender is not a Files window')
  })

  // `window:close-self` (GRO-2232): the REAL close on the caller's own window, so the
  // close/flush handshake in windows.ts runs — never a destroy. Resolved via the window lookup
  // only (no state lookup): a window mid-close can still ask.
  handleWithEvent(CONTRACT.window.closeSelf, async (e) => {
    const id = windows.idFor(e.sender)
    if (id === undefined) throw new BridgeFailure('BAD_REQUEST', 'sender is not a registered window')
    windows.closeWindow(id)
  })

  handle(CONTRACT.window.open, async (opts: unknown) => {
    if (!isRecord(opts)) throw new BridgeFailure('BAD_REQUEST', 'options must be an object')
    windows.openWindow({ root: optionalPath(opts, 'root') ?? null, file: optionalPath(opts, 'file') ?? null })
  })

  // `window:duplicate` (⌘⇧N): a window on the caller's vaults with no tab (YAZ-3343 replaced YAZ-2951 D5's copy of the tabs and page view).
  handleWithEvent(CONTRACT.window.duplicate, async (e) => {
    windows.duplicateWindow(entryFor(e))
  })

  // `window:pop-out` (YAZ-2933 D1): a tab's "Move to new window". Main copies the CALLER's window, so the
  // renderer never names a list of vaults; a path in no vault of that window is no tab of it.
  handleWithEvent(CONTRACT.window.popOut, async (e, path: unknown, carry: unknown) => {
    const from = entryFor(e)
    const target = requireAbsPath(path, 'path')
    if (rootOfPath(from.roots, target) === null) throw new BridgeFailure('BAD_REQUEST', 'path is in no vault of this window')
    windows.popOut(from, target, optionalPopOutCarry(carry))
  })

  // `window:move-to` (YAZ-3091 D1, D2): a tab's "Move to ▸ <window>". Main checks the target again: a window
  // that closed, or that shows no vault of the page, refuses, and the source keeps its tab.
  handleWithEvent(CONTRACT.window.moveTo, async (e, to: unknown, path: unknown, carry: unknown) => {
    const from = entryFor(e)
    const id = requireString(to, 'to')
    const target = requireAbsPath(path, 'path')
    if (id === from.id) throw new BridgeFailure('BAD_REQUEST', 'a tab cannot move to its own window')
    if (!windows.moveTo(id, target, optionalPopOutCarry(carry))) throw new BridgeFailure('NOT_FOUND', 'that window is closed or shows no vault of this page')
  })

  // The tab board's doors to other windows (YAZ-3343 D3): `window:focus-tab` raises `to` and makes its tab active,
  // `window:close-tabs` has `to` close tabs. The board handles its OWN window's tabs itself, so the caller as the
  // target is a bad request; a window that closed is NOT_FOUND, as `window:move-to` says it.
  handleWithEvent(CONTRACT.window.focusTab, async (e, to: unknown, ref: unknown) => {
    const from = entryFor(e)
    const id = requireString(to, 'to')
    const tab = requireTabRef(ref, 'ref')
    if (id === from.id) throw new BridgeFailure('BAD_REQUEST', 'the board shows its own window: it needs no door')
    if (!windows.focusTab(id, tab)) throw new BridgeFailure('NOT_FOUND', 'that window is closed')
  })
  handleWithEvent(CONTRACT.window.closeTabs, async (e, to: unknown, refs: unknown) => {
    const from = entryFor(e)
    const id = requireString(to, 'to')
    if (!Array.isArray(refs) || refs.length > MAX_CLOSE_REFS) throw new BridgeFailure('BAD_REQUEST', `'refs' must be an array of at most ${MAX_CLOSE_REFS} { path, copy }`)
    const tabs = refs.map((ref, i) => requireTabRef(ref, `refs[${i}]`))
    if (id === from.id) throw new BridgeFailure('BAD_REQUEST', 'the board shows its own window: it needs no door')
    if (!windows.closeTabs(id, tabs)) throw new BridgeFailure('NOT_FOUND', 'that window is closed')
  })

  // `window:move-tab` (YAZ-3343 D13): a card dropped in another window's frame. Window `from` — the caller or any
  // other — sends its tab on to `to` through `link:send-tab`; main checks both windows and `to`'s vaults first, as
  // `window:move-to` does, and `move-to` checks again when the tab goes.
  handleWithEvent(CONTRACT.window.moveTab, async (e, from: unknown, to: unknown, ref: unknown) => {
    entryFor(e)
    const source = requireString(from, 'from')
    const target = requireString(to, 'to')
    const tab = requireTabRef(ref, 'ref')
    if (source === target) throw new BridgeFailure('BAD_REQUEST', 'a tab cannot move to its own window')
    if (!windows.moveTab(source, target, tab)) throw new BridgeFailure('NOT_FOUND', 'a window is closed, or that window shows no vault of this page')
  })

  // `window:close-other` (YAZ-3343 D21): a frame's "Close window" on the tab board. The window's REAL close, so
  // its flush handshake runs; the caller closes itself with `close-self`.
  handleWithEvent(CONTRACT.window.closeOther, async (e, id: unknown) => {
    const from = entryFor(e)
    const target = requireString(id, 'id')
    if (target === from.id) throw new BridgeFailure('BAD_REQUEST', 'a window closes itself with window:close-self')
    if (!windows.closeOther(target)) throw new BridgeFailure('NOT_FOUND', 'that window is closed')
  })

  // `window:open-behind` (YAZ-3343 D22, D23): "New window" from the tab board's empty canvas — the CALLER's vaults,
  // no tab, hidden. Main names the vaults, so the renderer never hands a list of them.
  handleWithEvent(CONTRACT.window.openBehind, async (e) => windows.openBehind(entryFor(e)))

  // `window:set-roots` (YAZ-3343 D22): the vault chip on an empty frame. Any window may ask; only a live window
  // with no tab takes it, and switches itself (`link:set-roots`).
  handleWithEvent(CONTRACT.window.setRoots, async (e, id: unknown, roots: unknown) => {
    entryFor(e)
    const target = requireString(id, 'id')
    const next = optionalRoots({ roots })
    if (next === undefined || next.length === 0) throw new BridgeFailure('BAD_REQUEST', "'roots' must hold at least one absolute path")
    if (!windows.setRoots(target, next)) throw new BridgeFailure('NOT_FOUND', 'that window is closed, or it has tabs')
  })

  // `window:pop-out-tab` (YAZ-3343 D37): "Move to new window" on another window's card. That window does it
  // itself, so its unsaved text is saved first; the caller's own cards use `window:pop-out` with `background`.
  handleWithEvent(CONTRACT.window.popOutTab, async (e, from: unknown, ref: unknown) => {
    const caller = entryFor(e)
    const source = requireString(from, 'from')
    const tab = requireTabRef(ref, 'ref')
    if (source === caller.id) throw new BridgeFailure('BAD_REQUEST', 'a window pops out its own tab with window:pop-out')
    if (!windows.popOutTab(source, tab)) throw new BridgeFailure('NOT_FOUND', 'that window is closed')
  })

  // `window:show` / `window:hidden-windows-now` / `window:minimized-windows-now` (YAZ-3343 D23): the tab board's hidden and minimized windows.
  handleWithEvent(CONTRACT.window.showWindow, async (e, id: unknown) => {
    entryFor(e)
    if (!windows.showWindow(requireString(id, 'id'))) throw new BridgeFailure('NOT_FOUND', 'that window is closed')
  })
  handleWithEvent(CONTRACT.window.hiddenWindows, async (e) => {
    entryFor(e)
    return windows.hiddenWindows()
  })
  handleWithEvent(CONTRACT.window.minimizedWindows, async (e) => {
    entryFor(e)
    return windows.minimizedWindows()
  })

  // `window:highlight-tab` (YAZ-3343 D33): the board's highlight on another window's card lights that tab there.
  handleWithEvent(CONTRACT.window.highlightTab, async (e, to: unknown, ref: unknown) => {
    entryFor(e)
    windows.highlightTab(requireString(to, 'to'), ref === null ? null : requireTabRef(ref, 'ref'))
  })

  // `window:tab-action` (YAZ-3343 D31): a card menu's tab action on another window's card; that window runs it.
  handleWithEvent(CONTRACT.window.tabAction, async (e, to: unknown, ref: unknown, action: unknown) => {
    entryFor(e)
    const target = requireString(to, 'to')
    const tab = requireTabRef(ref, 'ref')
    if (!isRecord(action)) throw new BridgeFailure('BAD_REQUEST', "'action' must be an object")
    let clean: TabAction
    if (action.kind === 'duplicate' || action.kind === 'show-in-sidebar') clean = { kind: action.kind }
    else if (action.kind === 'set-name' && (action.name === null || typeof action.name === 'string')) clean = { kind: 'set-name', name: action.name === null ? null : cleanVaultName(action.name) }
    else if (action.kind === 'set-review' && typeof action.on === 'boolean') clean = { kind: 'set-review', on: action.on }
    else throw new BridgeFailure('BAD_REQUEST', "'action' must be duplicate, set-name, show-in-sidebar or set-review")
    if (!windows.tabAction(target, tab, clean)) throw new BridgeFailure('NOT_FOUND', 'that window is closed')
  })

  // `window:set-name` (YAZ-3343 D14): any window may name any OPEN window, or with null (or a name that is empty
  // once cleaned) give it back its automatic label. The store cleans the name as a vault's.
  handleWithEvent(CONTRACT.window.setName, async (e, id: unknown, name: unknown) => {
    entryFor(e)
    const target = requireString(id, 'id')
    if (name !== null && typeof name !== 'string') throw new BridgeFailure('BAD_REQUEST', "'name' must be a string or null")
    if (!windows.setName(target, name)) throw new BridgeFailure('NOT_FOUND', 'that window is closed')
  })

  // `window:highlight` (YAZ-3091 D8): the "Move to ▸" row under the pointer lights up its window. Main takes the
  // CALLER from the sender, so a window can only light another window for its own menu.
  handleWithEvent(CONTRACT.window.highlight, async (e, to: unknown) => {
    windows.highlight(entryFor(e).id, to === null ? null : requireString(to, 'to'))
  })

  // `window:note-closed` (YAZ-3487 D10): the notes of tabs the caller closed go to "Recently closed" of ITS vaults.
  handleWithEvent(CONTRACT.window.noteClosed, async (e, files: unknown) => {
    const roots = entryFor(e).roots
    if (!Array.isArray(files)) throw new BridgeFailure('BAD_REQUEST', "'files' must be a list of absolute paths")
    store.addClosed(roots, files.map((file, i) => requireAbsPath(file, `files[${i}]`)))
  })

  // `window:open-recent` (YAZ-1767 D1): the vault switcher's door — an absolute path in, and the
  // manager's verdict out: true = the vault is in front (its windows raised, D9, or a new one
  // opened; MRU bumped), false = the folder is gone and was pruned from the MRU instead. Any
  // window may ask. The caller counts only when nothing is raised: an EMPTY caller takes the vault itself (YAZ-3487 D1).
  handleWithEvent(CONTRACT.window.openRecent, async (e, path: unknown): Promise<boolean> => windows.openRecentBeside(requireAbsPath(path, 'path'), windows.idFor(e.sender)))
  // `window:open-alone` (YAZ-2858 D1): "Open by itself" — the same contract, but main raises only a
  // window that shows this vault alone, else the empty caller takes it, else it opens a new one.
  handleWithEvent(CONTRACT.window.openAlone, async (e, path: unknown): Promise<boolean> => windows.openAlone(requireAbsPath(path, 'path'), windows.idFor(e.sender)))

  // Saved sets of vaults (YAZ-2602 D8; the user reads "workspace"). `window:open-set` is the
  // manager's door: what opened, and the folders that are gone. Any window may ask it, and may
  // rename or remove a set. `window:save-set` saves the CALLER's own vaults, so the renderer never
  // sends a list; false = the store refused (fewer than two vaults, an empty name, or R12).
  handleWithEvent(CONTRACT.window.openSet, async (e, id: unknown): Promise<OpenSetResult> => windows.openVaultSet(requireString(id, 'id'), windows.idFor(e.sender)))
  handleWithEvent(CONTRACT.window.saveSet, async (e, name: unknown): Promise<boolean> => store.saveVaultSet(requireString(name, 'name'), entryFor(e).roots) !== null)
  handle(CONTRACT.window.renameSet, async (id: unknown, name: unknown): Promise<boolean> => store.renameVaultSet(requireString(id, 'id'), requireString(name, 'name')))
  handle(CONTRACT.window.removeSet, async (id: unknown) => {
    store.removeVaultSet(requireString(id, 'id'))
  })

  // Sessions (YAZ-3147 D2): saved copies of a window's tabs. `window:save-session` saves the CALLER's own
  // tabs from its window entry — the strip with its copies and names, else `tabs` with `file` as the active
  // tab — so the renderer sends only a name. It answers the session's id, or null when the store refused.
  // Any window may restore, rename, change or delete a session; each change reaches every window as `state:changed` (S36).
  handleWithEvent(CONTRACT.window.saveSession, async (e, name: unknown, replaceId: unknown): Promise<string | null> => {
    const session = requireString(name, 'name')
    const replace = replaceId === undefined ? undefined : requireString(replaceId, 'id')
    const { tabStrip, tabs, file, roots } = entryFor(e)
    const strip = tabStrip ?? tabs.map((path) => (path === file ? { path, active: true as const } : { path }))
    return store.saveSession(session, strip, roots, replace)?.id ?? null
  })
  // A restore (D3) answers the tabs whose file exists and the vaults whose folder exists; the renderer adds
  // them to its own window. An unknown id answers nothing to open. The session becomes the last used (S26).
  handle(CONTRACT.window.restoreSession, async (id: unknown): Promise<RestoreSessionResult> => {
    const session = store.get().sessions.find((s) => s.id === requireString(id, 'id'))
    if (session === undefined) return { tabs: [], roots: [], missing: [] }
    const result: RestoreSessionResult = { tabs: [], roots: session.roots.filter((r) => existsSync(r)), missing: [] }
    for (const tab of session.tabs) {
      if (existsSync(tab.path)) result.tabs.push({ ...tab })
      else result.missing.push(tab.path)
    }
    store.touchSession(session.id)
    return result
  })
  handle(CONTRACT.window.renameSession, async (id: unknown, name: unknown): Promise<boolean> => store.renameSession(requireString(id, 'id'), requireString(name, 'name')))
  // "Remove from session" (S30): the renderer sends the tabs that stay, checked as a window's strip is.
  handle(CONTRACT.window.setSessionTabs, async (id: unknown, tabs: unknown): Promise<boolean> => {
    const sessionId = requireString(id, 'id')
    const kept = optionalTabStrip({ tabs }, 'tabs')
    if (kept === undefined) throw new BridgeFailure('BAD_REQUEST', "'tabs' must be an array of tabs")
    return store.setSessionTabs(sessionId, kept)
  })
  handle(CONTRACT.window.removeSession, async (id: unknown) => {
    store.removeSession(requireString(id, 'id'))
  })

  // `window:open-files` (YAZ-3357 D5, D6): the vault menu's "Open in Files window" — beside the CALLER, on `root` or on
  // every vault of the caller. A root the caller does not name in its own list is still a vault: any folder may open.
  handleWithEvent(CONTRACT.window.openFiles, async (e, root: unknown) => {
    const from = entryFor(e)
    const vault = root === null ? null : requireAbsPath(root, 'root')
    if (!windows.openFilesWindow(from.id, vault)) throw new BridgeFailure('BAD_REQUEST', 'this window shows no vault')
  })
  // `window:open-from-files` (YAZ-3357 D2): ONE door for every click in a Files window; main picks the window. Only a Files window asks.
  handleWithEvent(CONTRACT.window.openFromFiles, async (e, action: unknown) => {
    const from = entryFor(e)
    if (from.kind !== 'files') throw new BridgeFailure('BAD_REQUEST', 'only a Files window opens through this door')
    if (!windows.openFromFiles(from.id, requireFilesAction(action, from))) throw new BridgeFailure('NOT_FOUND', 'no window can open that')
  })
  // `window:files-wide` (YAZ-3357 D3): the board opens or closes in the CALLER, a Files window; main owns the width.
  handleWithEvent(CONTRACT.window.filesWide, async (e, open: unknown) => {
    if (typeof open !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'open' must be a boolean")
    if (!windows.filesWide(entryFor(e).id, open)) throw new BridgeFailure('BAD_REQUEST', 'only a Files window grows for the board')
  })
  // `window:files-to-normal` (YAZ-3357 D13): the CALLER, a Files window, becomes a full window where it stands.
  handleWithEvent(CONTRACT.window.filesToNormal, async (e) => {
    if (!windows.filesToNormal(entryFor(e).id)) throw new BridgeFailure('BAD_REQUEST', 'only a Files window turns into a full window')
  })
  // `window:files-preview` (YAZ-3357 D9): the CALLER's floating preview, shown beside it or hidden.
  handleWithEvent(CONTRACT.window.filesPreview, async (e, req: unknown) => {
    if (!windows.filesPreview(entryFor(e).id, req === null ? null : requireFilesPreview(req))) throw new BridgeFailure('BAD_REQUEST', 'only a Files window has a floating preview')
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
