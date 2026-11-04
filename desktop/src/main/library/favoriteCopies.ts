/**
 * THE FAVORITES' OWN COPIES (YAZ-4363, round 2 decision 6): `<library>/favorites/<sha1(itemKey)>.<ext>`, one
 * full-quality picture for each Iconify or Pixabay favorite, beside `media.json`. Iconify or Pixabay can drop a
 * picture; the copy stays, and an add or a tile uses it first (`providers.ts`'s `favoriteCopy`), also offline.
 *
 *  - THE NAME IS THE ID. The file is named by the hash of `itemKey`, so no field in `media.json` can lose it, and a
 *    lookup needs nothing but the request. The extension comes from the picture's type.
 *  - THE BEST PICTURE. A copy is what `media:import` fetches: the Iconify SVG; Pixabay's `vectorURL`, else
 *    `largeImageURL`, else `webformatURL`. The 20 MB import limit stays (`fetchImage`).
 *  - ONE BACKFILL. A launch, each change of `media.json` (a favorite add, an auto-favorite at the third use, another
 *    Mac's favorites) and a new Pixabay key start a pass. A pass copies each favorite without a copy: the first at
 *    once, then one each second. Pixabay waits until a key exists. A pass that finds the network gone stops; a copy
 *    that failed is tried again by the next pass. A change during a pass runs one more pass after it.
 *  - A REMOVAL DELETES THE COPY (`remove`, after `media:favorites` remove). The copy is a copy, not the user's data:
 *    `rm`, not the trash, so an unfavorite does not fill the Trash with hashed files.
 *  - A LIBRARY THAT MOVES (YAZ-4364): `copyFrom` copies the copies the new folder lacks; it never writes over one.
 *  - THE FOLDER SCAN IS CACHED ON ITS OWN mtime, as `componentStore.ts` does: a tile asks for its copy, and one
 *    `stat` of the folder answers whether the last `readdir` is still true.
 *
 * Electron-free: the favorites, the fetch and the key check come in, so tests run on a temp folder with no network.
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { LIBRARY_FAVORITES_DIR, type FavoriteCopiesStatus, type MediaBytesRequest, type MediaImportResponse, type MediaPreviewResponse, type StoredMediaItem } from '@shared/types'
import { parseDataUrl } from '@shared/drawingAssets'
import { BridgeFailure, atomicWrite, createChain } from '../fs/fsUtils'

/** The wait between two copies of one pass (round 2 decision 6): a backfill of many favorites is gentle on the providers. */
export const FAVORITE_COPY_INTERVAL_MS = 1000

/** The providers whose favorites get a copy: the two that serve bytes. A shape, a component or a library drawing has none. */
const needsCopy = (item: StoredMediaItem): item is StoredMediaItem & { provider: 'iconify' | 'pixabay' } => item.provider === 'iconify' || item.provider === 'pixabay'

export const favoriteCopyHash = (itemKey: string): string => createHash('sha1').update(itemKey).digest('hex')

/** A copy's file name parts: `<40 hex>.<ext>`. An `atomicWrite` tmp file (`….tmp-<hex>`) never matches. */
const COPY_NAME_RE = /^([0-9a-f]{40})\.([a-z0-9]{1,8})$/

/** The file extension for a picture's type; `image/svg+xml` → `svg`, `image/jpeg` → `jpg`. Null for no image type. */
export function copyExtension(mimeType: string): string | null {
  const m = /^image\/([a-z0-9.+-]+)$/.exec(mimeType.toLowerCase())
  if (m === null) return null
  const sub = m[1].replace(/\+xml$/, '').replace(/[^a-z0-9]/g, '')
  if (sub === '') return null
  return sub === 'jpeg' ? 'jpg' : sub.slice(0, 8)
}

/** The type a copy's extension stands for — the inverse of `copyExtension`. */
export const copyMimeType = (ext: string): string => (ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)

export interface FavoriteCopiesDeps {
  /** The favorites as `media.json` holds them now (every Mac's, after YAZ-4364). */
  favorites: () => Promise<StoredMediaItem[]>
  /** Whether this Mac has a Pixabay key: a Pixabay copy waits until it does. */
  hasPixabayKey: () => Promise<boolean>
  intervalMs?: number
  /** The wait between two copies; a test passes one that resolves at once. */
  wait?: (ms: number) => Promise<void>
}

export interface FavoriteCopies {
  /**
   * The copy for a request, as a tile picture; null when there is none. `import` also answers the favorite's own
   * item (`media.json`'s row), so an add works with no network; that needs the item to be a favorite still.
   */
  preview(req: MediaBytesRequest): Promise<MediaPreviewResponse | null>
  import(req: MediaBytesRequest): Promise<MediaImportResponse | null>
  /**
   * The fetch a copy is made with: `providers.ts`'s `import` WITHOUT the copy step (a copy of a copy is no copy).
   * Until it is given, passes wait; the first `start` runs the launch backfill, and answers when it is done.
   */
  start(fetchOriginal: (req: MediaBytesRequest) => Promise<MediaImportResponse>): Promise<void>
  /** Start a pass, or ask the running one for one more after it. Never throws; answers when the passes are done. */
  backfill(): Promise<void>
  /** Delete the copy of `itemKey` (its favorite was removed). A copy that is not there is no failure. */
  remove(itemKey: string): Promise<void>
  status(): Promise<FavoriteCopiesStatus>
  /** Point at another library folder (the setting changed); a running pass stops, and a new one starts there. */
  setFolder(folder: string): void
  /** Copy the copies of the library in `from` that this folder lacks (YAZ-4364: the library moved). Answers how many. */
  copyFrom(from: string): Promise<number>
  close(): Promise<void>
}

export function createFavoriteCopies(initialFolder: string, deps: FavoriteCopiesDeps): FavoriteCopies {
  const interval = deps.intervalMs ?? FAVORITE_COPY_INTERVAL_MS
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()))
  let folder = initialFolder
  let fetchOriginal: ((req: MediaBytesRequest) => Promise<MediaImportResponse>) | null = null
  let closed = false
  /** The running passes, and whether a change asked for one more after the current one. */
  let running: Promise<void> | null = null
  let again = false
  /** The itemKeys whose last try failed (not offline): the status says so, and the next pass tries again. */
  const failed = new Set<string>()
  /** Writes and deletes of one folder in order, so a removal never races the copy that is landing. */
  const chain = createChain()
  /** The last scan: hash → file name and size, while the folder's mtime is unchanged. */
  let scan: { dir: string; mtimeMs: number; files: Map<string, { name: string; size: number }> } | null = null

  const dirOf = (library: string): string => path.join(library, LIBRARY_FAVORITES_DIR)

  async function listing(dir = dirOf(folder)): Promise<Map<string, { name: string; size: number }>> {
    const dirStat = await stat(dir).catch(() => null)
    if (dirStat === null) return new Map()
    if (scan !== null && scan.dir === dir && scan.mtimeMs === dirStat.mtimeMs) return scan.files
    const files = new Map<string, { name: string; size: number }>()
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const m = COPY_NAME_RE.exec(name)
      if (m === null) continue
      const st = await stat(path.join(dir, name)).catch(() => null)
      if (st !== null && st.isFile()) files.set(m[1], { name, size: st.size })
    }
    scan = { dir, mtimeMs: dirStat.mtimeMs, files }
    return files
  }

  async function readCopy(itemKey: string): Promise<MediaPreviewResponse | null> {
    const dir = dirOf(folder)
    const hit = (await listing(dir)).get(favoriteCopyHash(itemKey))
    if (hit === undefined) return null
    const ext = COPY_NAME_RE.exec(hit.name)?.[2] ?? ''
    const bytes = await readFile(path.join(dir, hit.name)).catch(() => null)
    if (bytes === null) return null
    const mimeType = copyMimeType(ext)
    return { mimeType, dataURL: `data:${mimeType};base64,${bytes.toString('base64')}` }
  }

  async function save(item: StoredMediaItem, fetched: MediaImportResponse, library: string): Promise<void> {
    const parsed = parseDataUrl(fetched.dataURL)
    const ext = copyExtension(fetched.mimeType)
    if (parsed === null || ext === null) throw new BridgeFailure('UNSUPPORTED_TYPE', 'the provider answered with something that is not an image')
    await chain.run(async () => {
      // A removal while the picture was on its way wins: the favorite is gone, so no copy lands.
      if (library !== folder || !(await deps.favorites()).some((f) => f.itemKey === item.itemKey)) return
      const dir = dirOf(library)
      await mkdir(dir, { recursive: true })
      await atomicWrite(path.join(dir, `${favoriteCopyHash(item.itemKey)}.${ext}`), Buffer.from(parsed.base64, 'base64'))
      scan = null
    })
  }

  /** One pass over the favorites of the folder it started in. */
  async function pass(): Promise<void> {
    const library = folder
    const fetch = fetchOriginal
    if (fetch === null) return
    const favorites = (await deps.favorites()).filter(needsCopy)
    const have = await listing(dirOf(library))
    let hasKey: boolean | null = null
    let first = true
    for (const item of favorites) {
      if (closed || library !== folder) return
      if (have.has(favoriteCopyHash(item.itemKey))) continue
      if (item.provider === 'pixabay' && !(hasKey ??= await deps.hasPixabayKey())) continue
      if (!first) await wait(interval)
      first = false
      try {
        await save(item, await fetch({ provider: item.provider, id: item.providerId }), library)
        failed.delete(item.itemKey)
      } catch (cause) {
        // No network: the rest would fail the same way. The next launch, change or key tries again.
        if (cause instanceof BridgeFailure && cause.code === 'OFFLINE') return
        failed.add(item.itemKey)
        console.warn(`[favorites] could not copy ${item.itemKey}: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
  }

  function backfill(): Promise<void> {
    if (closed || fetchOriginal === null) return Promise.resolve()
    if (running !== null) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await pass().catch((err: unknown) => console.warn(`[favorites] the copy pass stopped: ${String(err)}`))
      } while (again && !closed)
      running = null
    })()
    return running
  }

  return {
    preview: (req) => readCopy(`${req.provider}:${req.id}`),

    async import(req) {
      const itemKey = `${req.provider}:${req.id}`
      const row = (await deps.favorites()).find((f) => f.itemKey === itemKey)
      if (row === undefined) return null
      const copy = await readCopy(itemKey)
      if (copy === null) return null
      // The favorite's own row, as a plain item: the stamp is the library's, not the picture's.
      const { updatedAt: _stamp, ...item } = row
      return { ...copy, item }
    },

    start(fetch) {
      const first = fetchOriginal === null
      fetchOriginal = fetch
      return first ? backfill() : Promise.resolve()
    },

    backfill,

    remove(itemKey) {
      failed.delete(itemKey)
      return chain.run(async () => {
        const dir = dirOf(folder)
        const hit = (await listing(dir)).get(favoriteCopyHash(itemKey))
        if (hit === undefined) return
        await rm(path.join(dir, hit.name), { force: true })
        scan = null
      })
    },

    async status() {
      const favorites = await deps.favorites()
      const files = await listing()
      const missing = favorites.filter(needsCopy).filter((f) => !files.has(favoriteCopyHash(f.itemKey)))
      const hasKey = missing.some((f) => f.provider === 'pixabay') ? await deps.hasPixabayKey() : true
      const waitingForKey = hasKey ? 0 : missing.filter((f) => f.provider === 'pixabay').length
      const failedNow = missing.filter((f) => failed.has(f.itemKey) && !(f.provider === 'pixabay' && !hasKey)).length
      let bytes = 0
      for (const file of files.values()) bytes += file.size
      return {
        favorites: favorites.length,
        saved: favorites.filter(needsCopy).length - missing.length,
        saving: missing.length - waitingForKey - failedNow,
        waitingForKey,
        failed: failedNow,
        bytes,
      }
    },

    copyFrom(from) {
      return chain.run(async () => {
        const dir = dirOf(folder)
        const fromDir = dirOf(from)
        if (path.resolve(fromDir) === path.resolve(dir)) return 0
        const have = await listing(dir)
        let copied = 0
        for (const name of await readdir(fromDir).catch(() => [] as string[])) {
          const m = COPY_NAME_RE.exec(name)
          if (m === null || have.has(m[1])) continue
          await mkdir(dir, { recursive: true })
          // EXCL: a copy that landed meanwhile (a backfill, another Mac) is not written over.
          const ok = await copyFile(path.join(fromDir, name), path.join(dir, name), constants.COPYFILE_EXCL).then(
            () => true,
            () => false,
          )
          if (ok) copied++
        }
        if (copied > 0) scan = null
        return copied
      })
    },

    setFolder(next) {
      if (next === folder) return
      folder = next
      scan = null
      failed.clear()
      void backfill()
    },

    async close() {
      closed = true
      await running
    },
  }
}
