/**
 * THE LIBRARY'S MEDIA STORE (🔒 YAZ-1775 D5, YAZ-1817): the one library every vault's windows share for media
 * favorites, the recent MRU and what the Add tab learned (YAZ-4157). The rules live in `@shared/mediaLibrary`; this
 * module is the disk half.
 *
 * TWO MACS (YAZ-4364, round 3 decision 2): the library folder can sync (`<settings folder>/library`). Each Mac
 * writes only its own `media-<macId>.json`, so a sync tool never has two writers on one file. A read merges every
 * `media-*.json` and an old `media.json` (`mergeMediaLibraries`: per itemKey the newest wins, a removal stays
 * removed). A write puts the whole merged library, with its change, in this Mac's file.
 *
 * Lazy: a read never creates anything; this Mac's file appears on the first mutation. This Mac's own file, when it
 * is not a version-1 library, is moved aside (`readOrQuarantine`) and read as empty. Another Mac's file, or an old
 * `media.json`, that does not parse (half-synced) is skipped: moving it aside would sync, and cost that Mac its file.
 *
 * Mutations serialise on one chain: two windows favoriting in the same tick are two
 * read-modify-writes, and interleaving them would lose one. A mutation that changes nothing
 * (favoriting a favorite) does not write.
 *
 * Watching is `watchedFolder.ts`'s — depth 0, filtered to the library files' own names, so `components/`
 * and an `atomicWrite` tmp file never notify. An own write notifies this process's subscribers
 * synchronously (every window, whichever vault, hears it — that is the whole point of D5) and its
 * watcher echo is dropped by mtime; a write by the OTHER machine, through a synced folder, is another
 * file or another mtime, and notifies as usual.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_LIBRARY_FILE, type MediaFavoritesRequest, type MediaLibraryFile, type MediaUsedRequest, type StoredMediaItem } from '@shared/types'
import { MEDIA_FILE_RE, addFavorite, addWord, mediaFileName, mergeMediaLibraries, recordUse, removeFavorite, sanitizeMediaLibrary } from '@shared/mediaLibrary'
import { atomicWrite, createChain, fsCall, readOrQuarantine } from '../fs/fsUtils'
import { createWatchedFolder } from '../watchedFolder'

export interface MediaStore {
  /** Every verb answers the favorites list it produced. */
  favorites(req: MediaFavoritesRequest): Promise<StoredMediaItem[]>
  /** List, one add, or a word (YAZ-4157); every verb answers the whole library it produced, in ONE write. */
  used(req: MediaUsedRequest): Promise<MediaLibraryFile>
  /**
   * Merge the library of another folder into this one (YAZ-4364: the library folder changed). Answers how many rows
   * it brought; a second merge brings none and writes nothing.
   */
  mergeFrom(folder: string): Promise<number>
  /** Point at another library folder (the setting changed); the old one goes quiet. */
  setFolder(folder: string): void
  /** Fires after any change to a library file — an own write or an external one. Returns an unsubscribe. */
  onChanged(listener: () => void): () => void
  close(): Promise<void>
}

export interface MediaStoreDeps {
  now?: () => number
  /** This Mac's ID (`vaultIndex/mint.ts` `macId`): the name of the one file this Mac writes. */
  macId: () => Promise<string>
}

/** True for a file name a read merges: a Mac's own `media-<macId>.json`, or the old `media.json`. */
export const isMediaLibraryFileName = (name: string): boolean => name === MEDIA_LIBRARY_FILE || MEDIA_FILE_RE.test(name)

/** Every library file in `dir`, merged; `own` (this Mac's file name) is read first and wins a tie. */
async function readMerged(dir: string, own: string | null, quarantineOwn: boolean): Promise<MediaLibraryFile> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter(isMediaLibraryFileName)
  // This Mac's file first, then the other Macs' in a fixed order, then the old file.
  names.sort((a, b) => Number(b === own) - Number(a === own) || Number(a === MEDIA_LIBRARY_FILE) - Number(b === MEDIA_LIBRARY_FILE) || a.localeCompare(b))
  const libs = await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name)
      if (name === own && quarantineOwn) return readOrQuarantine(file, sanitizeMediaLibrary, 'media', 'a valid media library')
      try {
        return sanitizeMediaLibrary(JSON.parse(await readFile(file, 'utf8')))
      } catch {
        return null
      }
    }),
  )
  return mergeMediaLibraries(libs.filter((lib): lib is MediaLibraryFile => lib !== null))
}

const rowCount = (lib: MediaLibraryFile): number => lib.favorites.length + lib.recent.length + lib.used.length

export function createMediaStore(initialFolder: string, deps: MediaStoreDeps): MediaStore {
  const now = deps.now ?? Date.now
  const listeners = new Set<() => void>()
  const chain = createChain()
  let folder = initialFolder

  const ownName = async (): Promise<string> => mediaFileName(await deps.macId())
  const notify = (): void => listeners.forEach((l) => l())

  const watched = createWatchedFolder({
    dir: initialFolder,
    depth: 0,
    tag: 'media',
    relevant: (p, dir) => path.dirname(p) === dir && isMediaLibraryFileName(path.basename(p)),
    onChange: notify,
  })

  const read = async (): Promise<MediaLibraryFile> => readMerged(folder, await ownName(), true)

  async function write(lib: MediaLibraryFile): Promise<void> {
    const dir = folder
    const p = path.join(dir, await ownName())
    const { mtime } = await fsCall(p, async () => {
      await mkdir(dir, { recursive: true })
      return atomicWrite(p, `${JSON.stringify(lib, null, 2)}\n`)
    })
    watched.noteOwnWrite(p, mtime)
    notify()
  }

  /** One read-modify-write on the chain; writes only when `mutate` produced a different library. */
  const mutate = (fn: (lib: MediaLibraryFile) => MediaLibraryFile): Promise<MediaLibraryFile> =>
    chain.run(async () => {
      const before = await read()
      const after = fn(before)
      if (after !== before) await write(after)
      return after
    })

  return {
    favorites(req) {
      const lib = req.op === 'list' ? chain.wait(read) : mutate((l) => (req.op === 'add' ? addFavorite(l, req.item, now()) : removeFavorite(l, req.itemKey, now())))
      return lib.then((l) => l.favorites)
    },
    used(req) {
      if (req.op === 'list') return chain.wait(read)
      return mutate((l) => (req.op === 'record' ? recordUse(l, req.item, req.query, now()) : addWord(l, req.item, req.word, now())))
    },
    mergeFrom(from) {
      return chain.run(async () => {
        if (path.resolve(from) === path.resolve(folder)) return 0
        const here = await read()
        const there = await readMerged(from, null, false)
        if (rowCount(there) === 0 && Object.keys(there.removed).length === 0) return 0
        const merged = mergeMediaLibraries([here, there])
        // A merge that changes nothing writes nothing: a second copy is silent.
        if (JSON.stringify(merged) === JSON.stringify(here)) return 0
        await write(merged)
        const keys = (lib: MediaLibraryFile) => new Set([...lib.favorites, ...lib.recent, ...lib.used].map((row) => `${row.itemKey}@${row.updatedAt}`))
        const before = keys(here)
        return [...keys(merged)].filter((key) => !before.has(key)).length
      })
    },
    setFolder(next) {
      if (next === folder) return
      folder = next
      watched.setFolder(next)
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      listeners.clear()
      return watched.close()
    },
  }
}
