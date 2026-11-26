/**
 * A closed vault's cards, read from its files (YAZ-5252). It runs IN THE COUNT WORKER (`countWorker.ts`), never on the
 * main thread. It gives the cards of the live index: the same walk rule as `walk` (no dot-entry but a folder's settings
 * file, Markdown only, no symlink), only the pages that this vault owns for IDs (a folder that answers for its own IDs
 * is a vault inside the vault, as `idsOwnedBy`), no cards when the vault does not give IDs (YAZ-4946 D8, `plain()` in
 * `live.ts`), and each page's cards as `indexRecord` reads them (`cardRecords` of the body; over `MAX_FILE_BYTES`: none).
 *
 * CHEAP (YAZ-5390): only the card lines are read, never the rest of a page (no properties, no links). And only the files
 * that changed: the scan keeps each file's cards in its OWN cache in the app's storage (`scanDir`, never in the vault),
 * by the file's time, size and inode; a file the cache does not have is taken from the app's own index cache when that
 * file's time and size still match (GRO-2223 D2, the vault was open once); only the rest is read. The change key (main:
 * the git HEAD and each changed file's time and size) decides IF the worker scans: the same key, the kept pack. The
 * files are read 64 at a time, and only their cards are kept.
 *
 * NO SYMLINK IS FOLLOWED, NO READ LEAVES THE VAULT (YAZ-5395, YAZ-5396). Node has no `openat`, so each read checks the
 * file at read time: `open` with `O_NOFOLLOW` (a link as the last part: refused), then the real path of the file must be
 * the path itself (a link in any folder above it, the vault folder included: refused), then the file at that path must
 * be the file that is open (same device and inode: a folder swapped and swapped back between the two: refused). Each
 * folder of the walk is checked the same way before it is listed. The vault root's real path is checked again here, in
 * the worker (main checked it earlier). A refusal stops the scan of THIS vault (`ClosedVaultRefused`, "symlink"); the
 * worker still answers for the others. A hard link to a file outside the vault cannot be seen by any path check.
 */
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { cardRecords } from '@shared/cardLine'
import { isMarkdown, isSkipped } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatterSplit'
import type { FriendVault } from '@shared/friendStatsFormat'
import { IDS_FILE, idsAnswer } from '@shared/pageId'
import { REVIEW_SETTINGS_FILE, sanitizeReviewSettings } from '@shared/reviews'
import { readVaultSection, VAULT_SETTINGS_FILE } from '@shared/vaultSettings'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, VAULT_CONFIG_DIR } from '@shared/types'
import { atomicWrite } from '../fs/fsUtils'
import { CACHE_VERSION, cacheFile } from '../vaultIndex/cache'
import { ClosedVaultsUnreadable, type ClosedVaultWhy } from './countJob'

/** The scan of this vault stops: a link inside it, or a path whose real path is not the path itself. */
class ClosedVaultRefused extends Error {
  constructor(readonly why: ClosedVaultWhy = 'symlink') {
    super(why === 'symlink' ? 'a link inside the vault, or a path that leaves it' : 'the vault could not be read')
  }
}

/** A card as the count keeps it (`countPayload`): its ID, its archive mark and its answers. No text. */
type PackedCard = { id: string | null; off: boolean; reviews: unknown }
/** One file in the scan's own cache: its time, size and inode when it was read, and its cards (none: null). */
type Entry = [mtime: number, size: number, ino: number, cards: PackedCard[] | null]

export interface ScanOptions {
  /** The scan's own cache folder in the app's storage (`<userData>/friends-scan`). None: no cache (each scan reads all). */
  scanDir?: string
  /** The app's index cache folder (`<userData>/index-cache`): the cards of a vault that was open once. */
  indexDir?: string
  /** The change key from main. The same key as the cache's: the kept pack, no walk. */
  key?: string
  /** Tests: runs after the walk and before the reads (a folder swapped in between). */
  afterWalk?: () => Promise<void>
}

/** What a scan did: `scanned` false when the kept pack held (the same key); `read`: the files it read. */
export interface ScanResult {
  vault: FriendVault
  scanned: boolean
  read: number
}

const SCAN_CACHE_VERSION = 1
const READ_AT_ONCE = 64
const errno = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code

/**
 * Opens the file at `abs` for a read only if it is a real file inside the vault (see the head of this file). Null: the
 * file is gone (a pull meanwhile). Throws `ClosedVaultRefused` for a link or a swapped path.
 */
async function readInside(abs: string, maxBytes = MAX_FILE_BYTES): Promise<{ st: Stats; text: string | null } | null> {
  let fh
  try {
    // O_NONBLOCK: a FIFO in place of a page must not hold the worker. It changes nothing for a regular file.
    fh = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (err) {
    if (errno(err) === 'ELOOP') throw new ClosedVaultRefused()
    if (errno(err) === 'ENOENT' || errno(err) === 'ENOTDIR') return null
    throw err
  }
  try {
    const st = await fh.stat()
    if (!st.isFile()) return null
    if ((await realpath(abs)) !== abs) throw new ClosedVaultRefused()
    const now = await lstat(abs)
    if (now.ino !== st.ino || now.dev !== st.dev) throw new ClosedVaultRefused()
    return { st, text: st.size > maxBytes ? null : await fh.readFile('utf8') }
  } finally {
    await fh.close()
  }
}

/** Does the folder `dir` answer for its own IDs (`answersIds`, read with `readInside`)? A refusal goes up. */
async function answersIdsInside(dir: string): Promise<boolean> {
  const got = await readInside(path.join(dir, VAULT_CONFIG_DIR, IDS_FILE))
  if (got?.text == null) return false
  try {
    return idsAnswer(JSON.parse(got.text)) !== undefined
  } catch {
    return false
  }
}

/** A folder of the walk must be a real folder at its own real path. */
async function checkFolder(dir: string): Promise<void> {
  const real = await realpath(dir).catch((err: unknown) => {
    if (errno(err) === 'ELOOP') throw new ClosedVaultRefused()
    throw err
  })
  if (real !== dir) throw new ClosedVaultRefused()
}

/**
 * The pages this vault owns, as `walk` plus `idsOwnedBy` (a sub folder that answers for its own IDs is skipped whole).
 * An unreadable sub folder is skipped, as `walk` does; a refusal stops the scan.
 */
async function walkOwn(dir: string, out: string[], top: boolean): Promise<void> {
  try {
    await checkFolder(dir)
    if (!top && (await answersIdsInside(dir))) return
    const dirents = await readdir(dir, { withFileTypes: true })
    await Promise.all(
      dirents.map(async (e) => {
        if (isSkipped(e.name) && !(e.isFile() && e.name === FOLDER_SETTINGS_FILE)) return
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await walkOwn(full, out, false)
        else if (e.isFile() && isMarkdown(e.name)) out.push(full)
      }),
    )
  } catch (err) {
    if (top || err instanceof ClosedVaultRefused) throw err
  }
}

const packCards = (cards: readonly { id: string | null; off: boolean; reviews: unknown }[]): PackedCard[] | null =>
  cards.length === 0 ? null : cards.map((c) => ({ id: c.id, off: c.off, reviews: c.reviews }))

const scanCacheFile = (dir: string, root: string) => path.join(dir, `${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`)

interface ScanCache {
  v: number
  root: string
  key: string | null
  pack: FriendVault
  files: Record<string, Entry>
}

async function loadScanCache(dir: string | undefined, root: string): Promise<ScanCache | null> {
  if (dir === undefined) return null
  try {
    const doc = JSON.parse(await readFile(scanCacheFile(dir, root), 'utf8')) as ScanCache
    return doc.v === SCAN_CACHE_VERSION && doc.root === root && typeof doc.files === 'object' && doc.files !== null ? doc : null
  } catch {
    return null
  }
}

/** The app's own index cache of this vault (GRO-2223): each file's time, size and cards, by its path. Never throws. */
async function loadIndexCards(dir: string | undefined, root: string): Promise<Map<string, { mtime: number; size: number; cards: unknown }>> {
  const out = new Map<string, { mtime: number; size: number; cards: unknown }>()
  if (dir === undefined) return out
  try {
    const doc = JSON.parse(await readFile(cacheFile(dir, root), 'utf8')) as { version?: unknown; root?: unknown; records?: unknown }
    if (doc.version !== CACHE_VERSION || doc.root !== root || !Array.isArray(doc.records)) return out
    for (const r of doc.records as Record<string, unknown>[]) {
      if (typeof r?.path === 'string' && typeof r.mtime === 'number' && typeof r.size === 'number' && (r.cards === undefined || Array.isArray(r.cards))) out.set(r.path, { mtime: r.mtime, size: r.size, cards: r.cards })
    }
  } catch {
    // no index cache, or a broken one: the files are read
  }
  return out
}

/** The vault folder itself, checked again in the worker: a real folder at its own real path (YAZ-5396). */
async function checkRoot(root: string): Promise<void> {
  const st = await lstat(root).catch(() => null)
  if (st === null) throw new ClosedVaultRefused('unreadable')
  if (st.isSymbolicLink()) throw new ClosedVaultRefused()
  if (!st.isDirectory()) throw new ClosedVaultRefused('unreadable')
  await checkFolder(root)
}

/**
 * The closed vault's cards and review settings, with what the scan did. A link inside the vault, a swapped path, or a
 * read that fails: `ClosedVaultsUnreadable` naming this vault and why.
 */
export async function scanClosedVault(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  try {
    return await scanUnchecked(root, opts)
  } catch (err) {
    throw new ClosedVaultsUnreadable([{ root, why: err instanceof ClosedVaultRefused ? err.why : 'unreadable' }])
  }
}

async function scanUnchecked(root: string, opts: ScanOptions): Promise<ScanResult> {
  await checkRoot(root)
  const kept = await loadScanCache(opts.scanDir, root)
  if (kept !== null && opts.key !== undefined && kept.key === opts.key) return { vault: kept.pack, scanned: false, read: 0 }
  // YAZ-5388 / YAZ-6546: check unified settings.json's `review` section first, falling back to legacy review.json;
  // malformed JSON gives the default settings so one corrupt file never fails every count.
  let raw: unknown = null
  const unified = await readInside(path.join(root, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE))
  if (unified?.text != null) {
    try {
      raw = readVaultSection(JSON.parse(unified.text) as unknown, 'review')
    } catch {
      raw = null
    }
  }
  if (raw === null) {
    const review = await readInside(path.join(root, VAULT_CONFIG_DIR, REVIEW_SETTINGS_FILE))
    try {
      raw = review?.text == null ? null : (JSON.parse(review.text) as unknown)
    } catch {
      raw = null
    }
  }
  const settings = sanitizeReviewSettings(raw)
  const files: Record<string, Entry> = {}
  const pages: { abs: string; cards: PackedCard[] }[] = []
  let read = 0
  if (await answersIdsInside(root)) {
    const own: string[] = []
    await walkOwn(root, own, true)
    await opts.afterWalk?.()
    const index = kept === null ? await loadIndexCards(opts.indexDir, root) : new Map<string, { mtime: number; size: number; cards: unknown }>()
    const one = async (abs: string) => {
      const rel = path.relative(root, abs)
      const st = await lstat(abs).catch(() => null)
      if (st === null || !st.isFile()) {
        // A link here was a page at the walk: the folder changed under the scan. Read it the safe way, which refuses it.
        if (st?.isSymbolicLink()) await readInside(abs)
        return
      }
      const before = kept?.files[rel]
      let cards: PackedCard[] | null
      if (before !== undefined && before[0] === st.mtimeMs && before[1] === st.size && before[2] === st.ino) cards = before[3]
      else {
        const cached = index.get(abs)
        if (cached !== undefined && cached.mtime === st.mtimeMs && cached.size === st.size) cards = packCards((cached.cards ?? []) as PackedCard[])
        else {
          const got = await readInside(abs)
          read++
          if (got === null) return
          cards = got.text === null ? null : packCards(cardRecords(splitFrontmatter(got.text).body))
          files[rel] = [got.st.mtimeMs, got.st.size, got.st.ino, cards]
          if (cards !== null) pages.push({ abs, cards })
          return
        }
      }
      files[rel] = [st.mtimeMs, st.size, st.ino, cards]
      if (cards !== null) pages.push({ abs, cards })
    }
    for (let i = 0; i < own.length; i += READ_AT_ONCE) await Promise.all(own.slice(i, i + READ_AT_ONCE).map(one))
  }
  // The order of the live index's scan (`own.sort()`): the same pack for the same files.
  pages.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  const vault = { pages: pages.map((p) => ({ cards: p.cards })), settings } as unknown as FriendVault
  if (opts.scanDir !== undefined) {
    const doc: ScanCache = { v: SCAN_CACHE_VERSION, root, key: opts.key ?? null, pack: vault, files }
    await mkdir(opts.scanDir, { recursive: true }).catch(() => undefined)
    // A cache that cannot be written costs one more full read next time, never a wrong count.
    await atomicWrite(scanCacheFile(opts.scanDir, root), JSON.stringify(doc)).catch(() => undefined)
  }
  return { vault, scanned: true, read }
}

/** The closed vault's cards and review settings (no cache). Throws `ClosedVaultsUnreadable`. */
export async function scanVaultForCount(root: string, opts: Pick<ScanOptions, 'afterWalk'> = {}): Promise<FriendVault> {
  return (await scanClosedVault(root, opts)).vault
}
