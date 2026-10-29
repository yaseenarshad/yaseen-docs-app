import { MAX_CANVAS_CARDS, MAX_CANVAS_FRAMES, isTocSource, type CanvasCard, type CanvasFrame, type FolderPatch, type TabCanvasPatch } from '@shared/types'
import { isRecord } from '@shared/guards'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireStringArray } from '../fs/validate'
import type { SettingsFolder } from '../settingsFolder'
import { drawingInFront, hotkeyRecording } from '../hotkeyRecording'
import { isSettings, readCanvasCard, readCanvasFrame, readCanvasKey, type Store } from '../store'
import { createSystemHotkeys } from '../systemHotkeys'
import { broadcastAll } from './broadcast'
import { handle, handleWithEvent } from './envelope'

/** The patch crosses IPC from a sandboxed renderer: only `expanded` / `lastFile` / `name` / `key`, each type-checked. */
function requireFolderPatch(raw: unknown): FolderPatch {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
  const patch: FolderPatch = {}
  if (raw.expanded !== undefined) patch.expanded = requireStringArray(raw.expanded, 'expanded')
  if (raw.lastFile !== undefined) {
    if (raw.lastFile !== null && typeof raw.lastFile !== 'string') throw new BridgeFailure('BAD_REQUEST', "'lastFile' must be a string or null")
    patch.lastFile = raw.lastFile
  }
  // The vault's display name (YAZ-1974 D3): the store trims and caps it.
  if (raw.name !== undefined) {
    if (raw.name !== null && typeof raw.name !== 'string') throw new BridgeFailure('BAD_REQUEST', "'name' must be a string or null")
    patch.name = raw.name
  }
  // The vault's number (YAZ-2555 D2): the store keeps a whole number 1–9 and gives each number to one vault.
  if (raw.key !== undefined) {
    if (raw.key !== null && typeof raw.key !== 'number') throw new BridgeFailure('BAD_REQUEST', "'key' must be a number or null")
    patch.key = raw.key
  }
  return patch
}

/** One list of a canvas patch (YAZ-3343 D1): absent, or an array of MAX_CANVAS_CARDS at most whose EVERY entry reads — one bad entry rejects the call. */
function optionalCards<T>(raw: unknown, key: 'set' | 'forget', read: (v: unknown) => T | null, shape: string): T[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > MAX_CANVAS_CARDS) throw new BridgeFailure('BAD_REQUEST', `'${key}' must be an array of at most ${MAX_CANVAS_CARDS} cards`)
  return raw.map((v, i) => {
    const card = read(v)
    if (card === null) throw new BridgeFailure('BAD_REQUEST', `'${key}[${i}]' must be ${shape}`)
    return card
  })
}

/**
 * The tab board's canvas patch (YAZ-3343 D1), strict at the boundary where the loader is lenient: `allWindows` a
 * boolean, `set` cards with finite coordinates, `forget` card keys; a path must be absolute and a copy a whole number from 0.
 */
function requireTabCanvasPatch(raw: unknown): TabCanvasPatch {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
  if (raw.allWindows !== undefined && typeof raw.allWindows !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'allWindows' must be a boolean")
  if (raw.snap !== undefined && typeof raw.snap !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'snap' must be a boolean")
  const set = optionalCards<CanvasCard>(raw.set, 'set', readCanvasCard, '{ win, path, copy, by, x, y }')
  const forget = optionalCards(raw.forget, 'forget', readCanvasKey, '{ win, path, copy, by }')
  // The frames (YAZ-3343): `setFrames` as `{ win, x, y }`, `forgetFrames` as window ids — strict, as the cards.
  let setFrames: CanvasFrame[] | undefined
  if (raw.setFrames !== undefined) {
    if (!Array.isArray(raw.setFrames) || raw.setFrames.length > MAX_CANVAS_FRAMES) throw new BridgeFailure('BAD_REQUEST', `'setFrames' must be an array of at most ${MAX_CANVAS_FRAMES} frames`)
    setFrames = raw.setFrames.map((v, i) => {
      const frame = readCanvasFrame(v)
      if (frame === null) throw new BridgeFailure('BAD_REQUEST', `'setFrames[${i}]' must be { win, x, y }`)
      return frame
    })
  }
  if (raw.forgetFrames !== undefined && (!Array.isArray(raw.forgetFrames) || raw.forgetFrames.length > MAX_CANVAS_FRAMES || !raw.forgetFrames.every((w) => typeof w === 'string' && w !== ''))) throw new BridgeFailure('BAD_REQUEST', "'forgetFrames' must be an array of window ids")
  const forgetFrames = raw.forgetFrames as string[] | undefined
  return { ...(raw.allWindows === undefined ? {} : { allWindows: raw.allWindows }), ...(raw.snap === undefined ? {} : { snap: raw.snap }), ...(set === undefined ? {} : { set }), ...(forget === undefined ? {} : { forget }), ...(setFrames === undefined ? {} : { setFrames }), ...(forgetFrames === undefined ? {} : { forgetFrames: [...forgetFrames] }) }
}

/** The `state.*` half of `window.yaseenDocs` over the main-owned store (GRO-2159). */
export function registerStateIpc(store: Store, settingsFolder: Pick<SettingsFolder, 'missing' | 'hasOtherMacs' | 'settled'>): void {
  handle(CONTRACT.state.get, async () => store.get())
  handle(CONTRACT.state.setSettings, async (settings: unknown) => {
    if (!isSettings(settings)) throw new BridgeFailure('BAD_REQUEST', "'settings' must be a complete SettingsState")
    store.setSettings(settings)
  })
  handle(CONTRACT.state.settingsFolder, async () => ({ folder: store.get().settingsFolder, missing: settingsFolder.missing() }))
  // YAZ-3276 D6: a folder with another Mac's file wins (0 is older than every file); an empty folder takes
  // this Mac's settings (now is newer than none). Null keeps the settings and never deletes this Mac's file.
  handle(CONTRACT.state.setSettingsFolder, async (folder: unknown) => {
    const next = folder === null ? null : requireAbsPath(folder, 'folder')
    if (next === store.get().settingsFolder) return
    store.setSettingsFolder(next, next !== null && (await settingsFolder.hasOtherMacs(next)) ? 0 : Date.now())
    // The row asks `state.settingsFolder` right after this answers: wait for the new folder's first read,
    // so `missing` is that folder's, not the old one's (YAZ-3297). At most 2 s: a network folder that hangs
    // must not hang the door; the row then shows what is known, and the next open shows the rest.
    await Promise.race([settingsFolder.settled(), new Promise((done) => setTimeout(done, 2000))])
  })
  // "Used by macOS" (YAZ-3397 D3): this Mac's keys, read off its plist when the Hotkeys page asks, kept until the file changes.
  const systemHotkeys = createSystemHotkeys()
  handle(CONTRACT.state.systemHotkeys, async () => systemHotkeys())
  // A key recorder starts or stops in the calling window (YAZ-3397 D6); `main/index.ts` rebuilds the menu with no key while any listens.
  handleWithEvent(CONTRACT.hotkeys.recording, async (event, on: unknown) => {
    if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean")
    hotkeyRecording.set(event.sender, on)
  })
  // A drawing opens over a note in the calling window, or closes (YAZ-3564 K9); `main/index.ts` rebuilds the menu as for a drawing tab.
  handleWithEvent(CONTRACT.hotkeys.drawingInFront, async (event, on: unknown) => {
    if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean")
    drawingInFront.set(event.sender, on)
  })
  handle(CONTRACT.state.setSidebarWidth, async (width: unknown) => {
    if (typeof width !== 'number' || !Number.isFinite(width)) throw new BridgeFailure('BAD_REQUEST', "'width' must be a finite number")
    store.setSidebarWidth(width)
  })
  // The two orders across vaults take the same arguments by the same rule (YAZ-2631 D1; focus: YAZ-2702 Decision 3).
  for (const order of ['setFavoritesOrder', 'setFocusOrder'] as const) {
    handle(CONTRACT.state[order], async (roots: unknown, paths: unknown) => {
      store[order](requireStringArray(roots, 'roots').map((root) => requireAbsPath(root, 'root')), requireStringArray(paths, 'paths').map((path) => requireAbsPath(path, 'path')))
    })
  }
  handle(CONTRACT.state.pushRecent, async (path: unknown) => {
    store.pushRecent(requireAbsPath(path, 'path'))
  })
  handle(CONTRACT.state.removeRecent, async (path: unknown) => {
    store.removeRecent(requireAbsPath(path, 'path'))
  })
  handle(CONTRACT.state.setFolder, async (root: unknown, patch: unknown) => {
    store.setFolder(requireAbsPath(root, 'root'), requireFolderPatch(patch))
  })
  handle(CONTRACT.state.setFolds, async (root: unknown, file: unknown, keys: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    store.setFolds(r, f, requireStringArray(keys, 'keys'))
  })
  handle(CONTRACT.state.setTocSource, async (root: unknown, file: unknown, source: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    // `null` is Auto. Any other word — `auto` itself among them — is no source.
    if (source !== null && !isTocSource(source)) throw new BridgeFailure('BAD_REQUEST', "'source' must be 'headings', 'bullets' or null")
    store.setTocSource(r, f, source)
  })
  handle(CONTRACT.state.setSectionIndent, async (root: unknown, file: unknown, on: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    // Off is `false`, a value that is stored. There is no `null` here: nothing un-sets a note's switch.
    if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean")
    store.setSectionIndent(r, f, on)
  })
  handle(CONTRACT.state.setTocSwitch, async (root: unknown, file: unknown, on: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean")
    store.setTocSwitch(r, f, on)
  })
  handle(CONTRACT.state.setBaseGroups, async (root: unknown, key: unknown, collapsed: unknown) => {
    const r = requireAbsPath(root, 'root')
    if (typeof key !== 'string' || key === '') throw new BridgeFailure('BAD_REQUEST', "'key' must be a non-empty string")
    store.setBaseGroups(r, key, requireStringArray(collapsed, 'collapsed'))
  })
  handle(CONTRACT.state.setTabCanvas, async (patch: unknown) => {
    store.setTabCanvas(requireTabCanvasPatch(patch))
  })
  // Every live window gets the new state (`state.onChange` in the renderer), whichever window changed it.
  store.onChange((state) => broadcastAll(CONTRACT.state.onChange.channel, state))
}
