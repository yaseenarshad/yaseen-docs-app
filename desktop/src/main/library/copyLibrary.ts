/**
 * A LIBRARY THAT MOVES (YAZ-4364, round 3 decisions 1 and 3): when the library folder changes, its contents copy and
 * merge into the new folder, and the old folder stays as it was. Nothing is ever deleted.
 *
 *  - WHEN. The resolved folder (`resolveLibraryFolder`) changes: the user picks a Library folder or resets it, or a
 *    settings folder is set or cleared while no Library folder is picked. A launch also compares the folder of the
 *    last launch (`<userData>/library-folder.json`) with today's, so the first launch with a settings folder copies
 *    today's library into `<settings folder>/library` ONE time. A copy that fails is tried again by the next launch:
 *    the marker moves only after a copy that worked.
 *  - WHAT. `media.json` merges into this Mac's `media-<macId>.json` (`mediaStore.mergeFrom`); the favorites' copies
 *    copy when missing (`favoriteCopies.copyFrom`); a component copies when missing, and one with the same name and
 *    other bytes gets `-2` (`componentStore.mergeFrom`). A second copy changes nothing.
 *  - THE LINE. A copy that brought anything over says so once, in a window: "Copied your library. The old one is
 *    still at …".
 *
 * Electron-free: the stores, the notice and the folders come in, so tests copy between temp folders.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@shared/guards'
import { atomicWrite } from '../fs/fsUtils'
import type { Store } from '../store'
import type { ComponentStore } from './componentStore'
import type { FavoriteCopies } from './favoriteCopies'
import { resolveLibraryFolder } from './folder'
import type { MediaStore } from './mediaStore'

/** Where this Mac keeps the library folder of its last launch, beside the state file. */
export const LIBRARY_MARKER_FILE = 'library-folder.json'

export interface LibraryParts {
  media: Pick<MediaStore, 'mergeFrom'>
  components: Pick<ComponentStore, 'mergeFrom'>
  copies: Pick<FavoriteCopies, 'copyFrom'>
}

/**
 * Copy and merge the library in `from` into the folder the stores point at now. Answers how many things came over
 * (a favorite or a recent row counts as one, a file as one); 0 when `from` is gone or holds nothing new.
 */
export async function copyLibrary(from: string, parts: LibraryParts): Promise<number> {
  if (!existsSync(from)) return 0
  // One after another: each part writes on its own store's chain, and a failure stops the rest, so the next launch
  // tries the whole copy again.
  const media = await parts.media.mergeFrom(from)
  const copies = await parts.copies.copyFrom(from)
  const components = await parts.components.mergeFrom(from)
  return media + copies + components
}

/** The line a copy shows. The first copy into the settings folder says why the library moved. */
export function libraryCopiedNotice(from: string, intoSettingsFolder: boolean): string {
  return intoSettingsFolder
    ? `Your library is now in your settings folder, so it syncs to your other Macs. Copied your library. The old one is still at ${from}`
    : `Copied your library. The old one is still at ${from}`
}

export interface LibraryMovesDeps {
  /** `copyLibrary` over the app's stores. */
  copy(from: string): Promise<number>
  /** One line in a window (`windows.appNotice`): no window is raised for it. */
  notice(message: string): void
}

export interface LibraryMoves {
  /** The copies asked for so far are done (tests). */
  settled(): Promise<void>
  close(): void
}

async function readMarker(file: string): Promise<string | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
    return isRecord(raw) && typeof raw.folder === 'string' && path.isAbsolute(raw.folder) ? raw.folder : null
  } catch {
    return null
  }
}

/**
 * Follows the resolved library folder and copies the library on each change. Call it AFTER the stores'
 * `followLibraryFolder`: they point at the new folder first, and the copy merges into it.
 */
export function followLibraryMoves(store: Pick<Store, 'get' | 'onChange'>, userData: string, deps: LibraryMovesDeps): LibraryMoves {
  const marker = path.join(userData, LIBRARY_MARKER_FILE)
  const resolveNow = (state = store.get()) => resolveLibraryFolder(state.settings.libraryFolder, userData, state.settingsFolder)
  let current = resolveNow()

  async function move(from: string, to: string): Promise<void> {
    try {
      const copied = from === to ? 0 : await deps.copy(from)
      const state = store.get()
      const intoSettings = state.settings.libraryFolder === null && state.settingsFolder !== null && to === resolveNow(state)
      if (copied > 0) deps.notice(libraryCopiedNotice(from, intoSettings))
      await atomicWrite(marker, `${JSON.stringify({ folder: to }, null, 2)}\n`)
    } catch (err) {
      console.warn(`[library] could not copy the library from ${from} to ${to}: ${String(err)}`)
    }
  }

  // The launch: the folder of the last launch, or — before this build kept one — the folder the setting named then
  // (a settings folder did not count before YAZ-4364).
  let chain: Promise<void> = (async () => {
    const at = current
    const last = (await readMarker(marker)) ?? resolveLibraryFolder(store.get().settings.libraryFolder, userData, null)
    if (last !== at || !existsSync(marker)) await move(last, at)
  })()

  const off = store.onChange((state) => {
    const next = resolveNow(state)
    if (next === current) return
    const from = current
    current = next
    chain = chain.then(() => move(from, next))
  })

  return {
    settled: () => chain,
    close: off,
  }
}
