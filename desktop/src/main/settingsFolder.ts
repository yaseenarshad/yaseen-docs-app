/**
 * THE SETTINGS FOLDER (YAZ-3276 D4): keeps the store and the chosen folder the same, both ways, while
 * `AppState.settingsFolder` names one. The rules are `@shared/settingsSync`; this is the disk half.
 *
 *  - IN. The watcher (`createWatchedFolder`, depth 0) sees a `settings-*.json` change. A read lists the
 *    OTHER Macs' files — never this Mac's own, so its echo changes nothing. A newer file goes into the
 *    store (`applyFolderSettings`), which sends `state:changed` to every window as for any change.
 *  - OUT. A new save on this Mac (`settingsSavedAt` moved) writes this Mac's file, debounced, atomically.
 *    The same text as the last write is skipped: git gets no empty commit, and no write starts another.
 *    A read writes this Mac's file too when this Mac is newer than every file: an empty folder (D6), or
 *    an edit made while the folder was missing (D5). It never writes to mirror a file it just took.
 *  - MISSING (D5). A read or a write that fails sets `missing`; the store keeps its settings, and edits
 *    still move `settingsSavedAt`. The watcher never announces the folder itself, so a folder that comes
 *    back with the same files makes no event (YAZ-3296): while `missing`, one timer reads again every
 *    `retryMs`. The first read that works clears `missing` and sends what this Mac changed meanwhile.
 *
 * Electron-free (like `store.ts`): the Mac ID and the host name come in, so tests run two "Macs" on one folder.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { newestFile, parseSettingsFile, SETTINGS_FILE_RE, settingsFileName, settingsFileText, type SettingsFile } from '@shared/settingsSync'
import { atomicWrite } from './fs/fsUtils'
import type { Store } from './store'
import { createWatchedFolder, type WatchedFolder } from './watchedFolder'

/** The same wait as the store's own write (`WRITE_DEBOUNCE_MS`): a burst of changes is one file write. */
const WRITE_DEBOUNCE_MS = 150
/** While the folder is missing, a read this often (D5, YAZ-3296): one `readdir` of one folder, so 5 s costs nothing. */
const RETRY_MS = 5000

export interface SettingsFolder {
  /** The first read. `index.ts` waits for it (at most 500 ms) before the first window; with no folder it is done at once. */
  ready: Promise<void>
  /** True while the chosen folder cannot be read or written (D5). Always false with no folder. */
  missing(): boolean
  /** True when `folder` holds a file of another Mac (D6). A folder that can't be read holds none. */
  hasOtherMacs(folder: string): Promise<boolean>
  /** The reads and writes asked for so far are done: after a choice, `missing` is the new folder's (YAZ-3297). */
  settled(): Promise<void>
  /** The pending write, at once (quit). */
  flush(): Promise<void>
  /** Stop following the store and the folder (tests; the app keeps one for its life). */
  close(): Promise<void>
}

export interface SettingsFolderDeps {
  /** This Mac's ID (`vaultIndex/mint.ts` `macId`, YAZ-2677 R13): the name of its file. */
  macId: () => Promise<string>
  /** The host name, written in the file for a person who reads the folder. */
  host: string
  debounceMs?: number
  retryMs?: number
}

export function followSettingsFolder(store: Pick<Store, 'get' | 'onChange' | 'applyFolderSettings'>, deps: SettingsFolderDeps): SettingsFolder {
  let folder = store.get().settingsFolder
  let watcher: WatchedFolder | null = null
  let missing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The one read that waits while the folder is missing (D5): at most one, gone with the folder or the pointer. */
  let retry: ReturnType<typeof setTimeout> | null = null
  /** The text of this Mac's last write to `folder`; null after a re-point, so the new folder gets a file. */
  let lastText: string | null = null
  /** The `settingsSavedAt` this module already acted on: a store change that keeps it is no new save. */
  let savedAt = store.get().settingsSavedAt
  /** After `close()`: a read or a write still in the chain starts no new retry. */
  let closed = false
  /** Reads and writes in order, so a write never races a read of the same folder. */
  let chain: Promise<void> = Promise.resolve()

  const run = (work: () => Promise<void>): Promise<void> =>
    (chain = chain.then(work).then(
      () => {
        missing = false
      },
      (err: unknown) => {
        missing = folder !== null
        console.warn(`[settings] the settings folder ${folder ?? ''} could not be used: ${String(err)}`)
        if (missing && retry === null && !closed) {
          retry = setTimeout(() => {
            retry = null
            void run(pull)
          }, deps.retryMs ?? RETRY_MS)
        }
      },
    ))

  async function others(dir: string): Promise<SettingsFile[]> {
    const own = settingsFileName(await deps.macId())
    const names = (await readdir(dir)).filter((name) => SETTINGS_FILE_RE.test(name) && name !== own)
    // A file that can't be read or parsed (half-synced) is skipped; its next change reads it again.
    const files = await Promise.all(names.map((name) => readFile(path.join(dir, name), 'utf8').then(parseSettingsFile, () => null)))
    return files.filter((file): file is SettingsFile => file !== null)
  }

  async function push(): Promise<void> {
    const dir = folder
    if (dir === null) return
    const { settings, settingsSavedAt } = store.get()
    const text = settingsFileText(deps.host, settingsSavedAt, settings)
    if (text === lastText) return
    const file = path.join(dir, settingsFileName(await deps.macId()))
    const { mtime } = await atomicWrite(file, text)
    // Drops the watcher's echo, and re-anchors a watcher that started before the folder existed.
    watcher?.noteOwnWrite(file, mtime)
    lastText = text
  }

  async function pull(): Promise<void> {
    const dir = folder
    if (dir === null) return
    const files = await others(dir)
    const own = store.get().settingsSavedAt
    const newer = newestFile(files, own)
    if (newer !== null) {
      savedAt = newer.savedAt
      store.applyFolderSettings(newer.settings, newer.savedAt)
    } else if (files.every((file) => file.savedAt < own)) {
      await push()
    }
  }

  function point(): Promise<void> {
    if (timer !== null) clearTimeout(timer)
    if (retry !== null) clearTimeout(retry)
    timer = retry = null
    // A new folder starts clean; its first read says whether it is missing (YAZ-3297).
    missing = false
    if (folder === null) {
      void watcher?.close()
      watcher = null
      return chain
    }
    if (watcher === null) {
      watcher = createWatchedFolder({ dir: folder, depth: 0, tag: 'settings', relevant: (p) => SETTINGS_FILE_RE.test(path.basename(p)), onChange: () => void run(pull) })
    } else {
      watcher.setFolder(folder)
    }
    return run(pull)
  }

  const off = store.onChange((state) => {
    if (state.settingsFolder !== folder) {
      folder = state.settingsFolder
      savedAt = state.settingsSavedAt
      lastText = null
      void point()
      return
    }
    if (state.settingsSavedAt === savedAt) return
    savedAt = state.settingsSavedAt
    if (folder === null) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run(push)
    }, deps.debounceMs ?? WRITE_DEBOUNCE_MS)
  })

  return {
    ready: point(),
    missing: () => missing,
    hasOtherMacs: (dir) => others(dir).then((files) => files.length > 0, () => false),
    settled: () => chain,
    flush() {
      if (timer === null) return chain
      clearTimeout(timer)
      timer = null
      return run(push)
    },
    async close() {
      closed = true
      off()
      if (timer !== null) clearTimeout(timer)
      if (retry !== null) clearTimeout(retry)
      timer = retry = null
      await chain
      await watcher?.close()
      watcher = null
    },
  }
}
