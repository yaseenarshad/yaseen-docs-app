/**
 * THE FAVORITES' OWN COPIES (YAZ-4363, round 2 decision 6; YAZ-4370): `<library>/favorites/<sha1(itemKey)>.<ext>`, one
 * copy of what each favorite adds to a board, whatever its kind, beside the media files. A provider can drop a
 * picture, a library can go, a shape can be renamed, a component deleted; the copy stays, and an add or a tile uses
 * it first, also offline.
 *
 *  - TWO KINDS OF COPY. A picture (Iconify, Pixabay) is its bytes, `.<svg|jpg|png|…>`; `providers.ts`'s
 *    `favoriteCopy` asks for it. Elements (an Excalidraw library item, a shape, a component) are one
 *    `.excalidraw` file in a component file's shape, image bytes inside; the Add panel reads it (`media:favorite-elements`).
 *  - WHO MAKES IT. Main: the pictures, a library item (`media:drawing` without the copy step) and a component (its
 *    own file). The Add panel: a shape, which only the renderer's catalog and engine can build (`missingForPanel`,
 *    `saveElements`).
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
 *    `rm`, not the trash, so an unfavorite does not fill the Trash with hashed files. A favorite that left through a
 *    merge (another Mac removed it) never ran `remove` here: each pass first deletes the copy of every removed
 *    itemKey that is not a favorite again (YAZ-4366). A copy that no removal names stays, as one that came before its
 *    favorite (a sync, a move: the copies move before the media) is not an orphan.
 *  - A LIBRARY THAT MOVES (YAZ-4364): `copyFrom` copies the copies the new folder lacks; it never writes over one.
 *    Each lands whole or not at all (YAZ-4379): `createDurable`, a fsynced tmp file linked onto the name. A copy that
 *    failed fails the move, so the next launch copies it again from the old folder. A component that moved to another
 *    slug (YAZ-4378) takes its copy along, under its new itemKey's name.
 *  - A PASS LOOKS AGAIN BEFORE EACH FETCH (YAZ-4382): a copy that landed meanwhile (a move, another Mac) is not
 *    fetched again. The look is one `stat` while the folder's mtime is unchanged.
 *  - THE FOLDER SCAN IS CACHED ON ITS OWN mtime, as `componentStore.ts` does: a tile asks for its copy, and one
 *    `stat` of the folder answers whether the last `readdir` is still true.
 *
 * Electron-free: the favorites, the fetch and the key check come in, so tests run on a temp folder with no network.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { LIBRARY_FAVORITES_DIR, MAX_COMPONENT_FRAGMENT_BYTES, type FavoriteCopiesStatus, type MediaBytesRequest, type MediaImportResponse, type MediaPreviewResponse, type StoredMediaItem } from '@shared/types'
import { parseDataUrl } from '@shared/drawingAssets'
import { parseComponentFragment } from '@shared/savedComponents'
import { componentItemKey, type ComponentMoves } from '@shared/mediaLibrary'
import { BridgeFailure, atomicWrite, createChain, createDurable } from '../fs/fsUtils'
import { makeLibraryDir } from './folder'

/** The wait between two copies of one pass (round 2 decision 6): a backfill of many favorites is gentle on the providers. */
export const FAVORITE_COPY_INTERVAL_MS = 1000

/** The favorites whose copy is a picture: the two providers that serve bytes. Every other kind's copy is elements. */
const isPicture = (item: StoredMediaItem): item is StoredMediaItem & { provider: 'iconify' | 'pixabay' } => item.provider === 'iconify' || item.provider === 'pixabay'
/** The kind whose copy the Add panel makes: a shape is built from the renderer's catalog by its engine. */
const madeByPanel = (item: StoredMediaItem): boolean => item.provider === 'shape'
/** The extension of an elements copy (YAZ-4370): a component file's own. */
export const ELEMENTS_COPY_EXT = 'excalidraw'

/** A fragment in a component file's shape, from bare elements (a library item has no image bytes). */
const fragmentOf = (elements: readonly unknown[]): string => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} }, null, 2)}\n`

export const favoriteCopyHash = (itemKey: string): string => createHash('sha1').update(itemKey).digest('hex')

/** A copy's file name parts: `<40 hex>.<ext>`. An `atomicWrite` tmp file (`….tmp-<hex>`) never matches. */
const COPY_NAME_RE = /^([0-9a-f]{40})\.([a-z0-9]{1,10})$/

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
  /** The itemKeys of the library's removal notes (`media.json`'s `removed`): a pass deletes their copies. */
  removedKeys?: () => Promise<readonly string[]>
  /** Whether this Mac has a Pixabay key: a Pixabay copy waits until it does. */
  hasPixabayKey: () => Promise<boolean>
  /** A saved component's file, by slug (`componentStore.read`); it throws when the component is gone. */
  readComponent?: (slug: string) => Promise<string>
  intervalMs?: number
  /** The wait between two copies; a test passes one that resolves at once. */
  wait?: (ms: number) => Promise<void>
}

/** How main makes a copy: `providers.ts`'s `import` and `drawing` WITHOUT the copy step (a copy of a copy is no copy). */
export interface CopyFetchers {
  picture(req: MediaBytesRequest): Promise<MediaImportResponse>
  /** A library item's elements, by its `providerId`. */
  drawing(id: string): Promise<readonly unknown[]>
}

export interface FavoriteCopies {
  /** The picture copy's type and size, with no read of its bytes: a kept tile can answer first (YAZ-4366). */
  find(req: MediaBytesRequest): Promise<{ mimeType: string; size: number } | null>
  /**
   * The copy for a request, as a tile picture; null when there is none. `import` also answers the favorite's own
   * item (`media.json`'s row), so an add works with no network; that needs the item to be a favorite still.
   */
  preview(req: MediaBytesRequest): Promise<MediaPreviewResponse | null>
  import(req: MediaBytesRequest): Promise<MediaImportResponse | null>
  /** The elements copy of a favorite, as a component fragment's text; null when there is none (YAZ-4370). */
  readElements(itemKey: string): Promise<string | null>
  /**
   * Keep the Add panel's copy of a favorite's elements (a shape). Only for a favorite with no copy yet, and only a
   * valid fragment of at most 32 MB; answers whether it was kept. The first copy stays.
   */
  saveElements(itemKey: string, fragmentJson: string): Promise<boolean>
  /** The favorites whose copy the Add panel makes (shapes) and that have none yet. */
  missingForPanel(): Promise<string[]>
  /**
   * A favorite or a copy holds `itemKey` (YAZ-4366): a deleted component's favorite and copy stay, so a new component
   * must not take its slug (`componentStore`'s `slugHeld`).
   */
  holds(itemKey: string): Promise<boolean>
  /**
   * How main makes a copy. Until it is given, passes wait; the first `start` runs the launch backfill, and answers
   * when it is done.
   */
  start(fetchers: CopyFetchers): Promise<void>
  /** Start a pass, or ask the running one for one more after it. Never throws; answers when the passes are done. */
  backfill(): Promise<void>
  /** Delete the copy of `itemKey` (its favorite was removed). A copy that is not there is no failure. */
  remove(itemKey: string): Promise<void>
  status(): Promise<FavoriteCopiesStatus>
  /** Point at another library folder (the setting changed); a running pass stops, and a new one starts there. */
  setFolder(folder: string): void
  /**
   * Copy the copies of the library in `from` that this folder lacks (YAZ-4364: the library moved). Answers how many.
   * `moves` are the components that came over under another slug (YAZ-4378): their copies take the new name. A copy
   * that could not be made throws, after the others are tried.
   */
  copyFrom(from: string, moves?: ComponentMoves): Promise<number>
  close(): Promise<void>
}

export function createFavoriteCopies(initialFolder: string, deps: FavoriteCopiesDeps): FavoriteCopies {
  const interval = deps.intervalMs ?? FAVORITE_COPY_INTERVAL_MS
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()))
  let folder = initialFolder
  let fetchers: CopyFetchers | null = null
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
    if (ext === ELEMENTS_COPY_EXT) return null // elements are no picture
    const bytes = await readFile(path.join(dir, hit.name)).catch(() => null)
    if (bytes === null) return null
    const mimeType = copyMimeType(ext)
    return { mimeType, dataURL: `data:${mimeType};base64,${bytes.toString('base64')}` }
  }

  /** Write one copy, unless the favorite went meanwhile or a copy landed meanwhile. Answers whether it wrote. */
  function write(itemKey: string, ext: string, bytes: Buffer | string, library: string): Promise<boolean> {
    return chain.run(async () => {
      // A removal while the copy was on its way wins: the favorite is gone, so no copy lands.
      if (library !== folder || !(await deps.favorites()).some((f) => f.itemKey === itemKey)) return false
      const dir = dirOf(library)
      if ((await listing(dir)).has(favoriteCopyHash(itemKey))) return false
      await makeLibraryDir(library, LIBRARY_FAVORITES_DIR)
      await atomicWrite(path.join(dir, `${favoriteCopyHash(itemKey)}.${ext}`), bytes)
      scan = null
      return true
    })
  }

  async function savePicture(item: StoredMediaItem, fetched: MediaImportResponse, library: string): Promise<void> {
    const parsed = parseDataUrl(fetched.dataURL)
    const ext = copyExtension(fetched.mimeType)
    if (parsed === null || ext === null) throw new BridgeFailure('UNSUPPORTED_TYPE', 'the provider answered with something that is not an image')
    await write(item.itemKey, ext, Buffer.from(parsed.base64, 'base64'), library)
  }

  /** A fragment that a component file could be, or a throw: an elements copy must insert. */
  function checkFragment(fragmentJson: string): void {
    if (Buffer.byteLength(fragmentJson) > MAX_COMPONENT_FRAGMENT_BYTES) throw new BridgeFailure('TOO_LARGE', 'that copy is over 32 MB')
    try {
      parseComponentFragment(fragmentJson)
    } catch (err) {
      throw new BridgeFailure('BAD_REQUEST', `not a copy of elements: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Main's own copy of one favorite: a picture, a library item's elements or a component's file. */
  async function copyOne(item: StoredMediaItem, fetch: CopyFetchers, library: string): Promise<void> {
    if (isPicture(item)) return savePicture(item, await fetch.picture({ provider: item.provider, id: item.providerId }), library)
    let fragment: string
    if (item.provider === 'excalidraw') fragment = fragmentOf(await fetch.drawing(item.providerId))
    else if (item.provider === 'component' && deps.readComponent !== undefined) fragment = await deps.readComponent(item.providerId)
    else throw new BridgeFailure('NOT_FOUND', `no copy can be made of ${item.itemKey}`)
    checkFragment(fragment)
    await write(item.itemKey, ELEMENTS_COPY_EXT, fragment, library)
  }

  /** The copies of removed favorites that are not favorites again (YAZ-4366), on the chain with the writes. */
  function dropRemoved(library: string): Promise<void> {
    return chain.run(async () => {
      if (library !== folder || deps.removedKeys === undefined) return
      const keep = new Set((await deps.favorites()).map((f) => favoriteCopyHash(f.itemKey)))
      const dir = dirOf(library)
      const files = await listing(dir)
      for (const itemKey of await deps.removedKeys()) {
        const hash = favoriteCopyHash(itemKey)
        const hit = files.get(hash)
        if (hit === undefined || keep.has(hash)) continue
        await rm(path.join(dir, hit.name), { force: true })
        scan = null
      }
    })
  }

  /** One pass over the favorites of the folder it started in. */
  async function pass(): Promise<void> {
    const library = folder
    const fetch = fetchers
    if (fetch === null) return
    await dropRemoved(library)
    const favorites = (await deps.favorites()).filter((item) => !madeByPanel(item))
    let hasKey: boolean | null = null
    let first = true
    for (const item of favorites) {
      if (closed || library !== folder) return
      // The folder again, each time (YAZ-4382): a move or another Mac may have brought the copy meanwhile.
      if ((await listing(dirOf(library))).has(favoriteCopyHash(item.itemKey))) continue
      if (item.provider === 'pixabay' && !(hasKey ??= await deps.hasPixabayKey())) continue
      // One each second for what goes to the network; a component's own file is on this disk.
      if (item.provider !== 'component') {
        if (!first) await wait(interval)
        first = false
      }
      try {
        await copyOne(item, fetch, library)
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
    if (closed || fetchers === null) return Promise.resolve()
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
    async find(req) {
      const hit = (await listing()).get(favoriteCopyHash(`${req.provider}:${req.id}`))
      const ext = hit === undefined ? undefined : COPY_NAME_RE.exec(hit.name)?.[2]
      return hit === undefined || ext === undefined || ext === ELEMENTS_COPY_EXT ? null : { mimeType: copyMimeType(ext), size: hit.size }
    },

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

    async readElements(itemKey) {
      const dir = dirOf(folder)
      const hit = (await listing(dir)).get(favoriteCopyHash(itemKey))
      if (hit === undefined || COPY_NAME_RE.exec(hit.name)?.[2] !== ELEMENTS_COPY_EXT) return null
      return readFile(path.join(dir, hit.name), 'utf8').catch(() => null)
    },

    async saveElements(itemKey, fragmentJson) {
      checkFragment(fragmentJson)
      const kept = await write(itemKey, ELEMENTS_COPY_EXT, fragmentJson, folder)
      if (kept) failed.delete(itemKey)
      return kept
    },

    async missingForPanel() {
      const files = await listing()
      return (await deps.favorites()).filter((f) => madeByPanel(f) && !files.has(favoriteCopyHash(f.itemKey))).map((f) => f.itemKey)
    },

    async holds(itemKey) {
      return (await listing()).has(favoriteCopyHash(itemKey)) || (await deps.favorites()).some((f) => f.itemKey === itemKey)
    },

    start(next) {
      const first = fetchers === null
      fetchers = next
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
      const missing = favorites.filter((f) => !files.has(favoriteCopyHash(f.itemKey)))
      const hasKey = missing.some((f) => f.provider === 'pixabay') ? await deps.hasPixabayKey() : true
      const keyless = (f: StoredMediaItem) => f.provider === 'pixabay' && !hasKey
      const waitingForKey = missing.filter(keyless).length
      const waitingForPanel = missing.filter(madeByPanel).length
      const failedNow = missing.filter((f) => failed.has(f.itemKey) && !keyless(f) && !madeByPanel(f)).length
      let bytes = 0
      for (const file of files.values()) bytes += file.size
      return {
        favorites: favorites.length,
        saved: favorites.length - missing.length,
        saving: missing.length - waitingForKey - waitingForPanel - failedNow,
        waitingForKey,
        waitingForPanel,
        failed: failedNow,
        bytes,
      }
    },

    copyFrom(from, moves = {}) {
      return chain.run(async () => {
        const library = folder
        const dir = dirOf(library)
        const fromDir = dirOf(from)
        if (path.resolve(fromDir) === path.resolve(dir)) return 0
        // A moved component's copy is named by its old itemKey there, and by its new one here.
        const renamed = new Map(Object.entries(moves).map(([slug, to]) => [favoriteCopyHash(componentItemKey(slug)), favoriteCopyHash(componentItemKey(to.slug))]))
        const have = await listing(dir)
        let copied = 0
        let failure: unknown = null
        for (const name of await readdir(fromDir).catch(() => [] as string[])) {
          const m = COPY_NAME_RE.exec(name)
          if (m === null) continue
          const hash = renamed.get(m[1]) ?? m[1]
          if (have.has(hash)) continue
          try {
            const bytes = await readFile(path.join(fromDir, name))
            await makeLibraryDir(library, LIBRARY_FAVORITES_DIR)
            // Whole or not at all, and never over a copy that landed meanwhile (a backfill, another Mac): EEXIST.
            await createDurable(path.join(dir, `${hash}.${m[2]}`), bytes)
            copied++
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') failure ??= err
          }
        }
        if (copied > 0) scan = null
        if (failure !== null) throw failure
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
