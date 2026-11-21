import { MAX_FILE_BYTES, type IndexRecord } from '@shared/types'
import { kindOnPhone, type FileContent, type VaultStore } from '../store'
import { gitBlobSha } from './gitSha'
import { MAX_BATCH_FILES, type GithubRemote } from './githubRemote'
import { INDEX_RULES, INDEX_STATE, ofTheseRules, phoneRecord, type PhoneIndex } from './phoneIndex'
import { diffTrees, isEager, isIndexed, type TreeDiff } from './plan'
import { uiSlicer, yieldToUi as defaultYield } from './yieldToUi'

/** Files done of files to get in this pass (4A's progress bar, round 10 item 8). A resumed download starts above 0. */
export interface PassProgress {
  done: number
  total: number
}

export interface PassOptions {
  remote: GithubRemote
  store: VaultStore
  /** The vault id (`vaultId`). */
  vault: string
  /** The clock for the records' times. */
  now?: () => number
  /** Gives the UI thread back (default: `scheduler.yield`, else a zero timeout). The pass calls it each ~8 ms of work. */
  yieldToUi?: () => Promise<void>
  /** Downloads at one time. Proof 1B: six at a time made the first download 3 times faster. */
  parallel?: number
  onProgress?: (progress: PassProgress) => void
  /** From this many files to download, text files come in batches (default `BATCH_FROM`). Tests of the one-file path raise it. */
  batchFrom?: number
  /** In-memory PhoneIndex already held by the sync engine, avoiding a redundant multi-MB IDB deserialization when its commit matches (YAZ-6027). */
  heldIndex?: PhoneIndex | null
}

/**
 * YAZ-5929 (decision D1 on YAZ-5928): from this many text files to download in one pass, they come in batches of one
 * GraphQL query each (`GithubRemote.blobs`). Under it, each file is one `GET git/blobs/{sha}`, as before.
 */
export const BATCH_FROM = 10
/**
 * One batch holds at most `MAX_BATCH_FILES` (100) files and about 1 MB of text, by the sizes in the tree. A file over
 * 1 MB is not batched: it uses the one-file call (GitHub may cut a long text short in GraphQL).
 */
export const BATCH_BYTES = 1024 * 1024
/** Batch queries at one time. Each is up to 100 files, so few lanes keep the first download fast; GitHub asks for few. */
export const BATCH_LANES = 3

/** The files to download, packed in order into batches by count and bytes; the files too large for a batch go `alone`. */
export function packBatches(paths: readonly string[], bytesOf: (path: string) => number): { batches: string[][]; alone: string[] } {
  const batches: string[][] = []
  const alone: string[] = []
  let current: string[] = []
  let bytes = 0
  for (const path of paths) {
    const size = bytesOf(path)
    if (size > BATCH_BYTES) {
      alone.push(path)
      continue
    }
    if (current.length >= MAX_BATCH_FILES || (current.length > 0 && bytes + size > BATCH_BYTES)) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(path)
    bytes += size
  }
  if (current.length > 0) batches.push(current)
  return { batches, alone }
}

export type PassResult =
  | { kind: 'unchanged' }
  | {
      kind: 'synced'
      commit: string
      diff: TreeDiff
      /** Settings files that changed (`.yaseendocs/`, a folder's `.folder.md`; row R13). */
      settings: string[]
      index: PhoneIndex
      /** Blobs downloaded (stored copies that were already right, and renames, cost nothing). */
      fetched: number
      /** This pass made the first full copy of the vault. */
      first: boolean
      /** Each file's size in bytes, from the tree (3D: a picture over its limit downloads only when it shows). */
      sizes: ReadonlyMap<string, number>
    }

const decoder = new TextDecoder('utf-8', { ignoreBOM: true }) // keep a BOM, as the Mac's read does: the SHA check matches

/**
 * ONE sync pass (October 2E). Every failure is thrown as it is (`GithubError`, `StorageFullError`); the engine turns
 * it into a status. The steps:
 * 1. Ask for the head with the stored ETag. Unchanged (a free 304): stop (R1).
 * 2. Get the file list of the new head (one request; `TREE_TRUNCATED` stops before anything is stored: F6).
 * 3. Compare it with the stored map: added, changed, removed, renamed (R6, R8, R11).
 * 4. Get each eager file that is not stored at its SHA yet. A stored copy is checked with git's own hash first, and a
 *    rename or copy is taken from the stored file, so an interrupted pass continues without a second fetch (F5).
 *    A page over the size limit is not downloaded (F7). Media that changed or went loses its kept copy (R7).
 *    YAZ-5929: when `BATCH_FROM` (10) or more files must download, the stored copies are checked first; then the
 *    files to download come in batches (`packBatches`: up to 100 files, about 1 MB), one GraphQL query each
 *    (`GithubRemote.blobs`). A text is kept only when its git SHA is the tree's SHA (`gitBlobSha`). A file that
 *    GitHub calls binary, cut short, or gives with another SHA downloads alone (`GET git/blobs/{sha}`), so nothing
 *    wrong is written and the worst case is the old path. A 2,500-file first download is about 27 calls, not 2,502.
 * 5. Store the files; then the index (`indexRecord`, 2B); then the checkpoint, LAST (F5).
 */
export async function syncPass(options: PassOptions): Promise<PassResult> {
  const { remote, store, vault } = options
  const now = options.now ?? Date.now
  const slice = uiSlicer(options.yieldToUi ?? defaultYield)
  const parallel = Math.max(1, options.parallel ?? 6)

  const checkpoint = await store.checkpoint(vault)
  const head = await remote.head(checkpoint?.etag ?? undefined)
  if (head === 'unchanged') return { kind: 'unchanged' }
  if (checkpoint !== null && head.sha === checkpoint.commit) {
    if (head.etag !== checkpoint.etag) await store.setCheckpoint(vault, { ...checkpoint, etag: head.etag })
    return { kind: 'unchanged' }
  }

  const tree = await remote.tree(head.sha)
  await slice()
  const old = checkpoint?.shas ?? {}
  const diff = diffTrees(checkpoint?.shas ?? null, tree)
  const stored = new Set((await store.list(vault)).map((e) => e.path))
  const saved =
    checkpoint !== null && options.heldIndex != null && options.heldIndex.commit === checkpoint.commit && ofTheseRules(options.heldIndex)
      ? options.heldIndex
      : await store.getState<PhoneIndex>(vault, INDEX_STATE)
  // An index of an older build's rules is not trusted: every record is built again from the stored files.
  const trusted = checkpoint !== null && saved !== undefined && saved.commit === checkpoint.commit && ofTheseRules(saved)
  await slice()

  // Only the eager files: the media of the window downloads after the pass (`media/ahead.ts`), so the first download
  // and the checkpoint never wait for pictures.
  const wanted = isEager
  const tooBig = (path: string) => isEager(path) && (tree.bytes.get(path) ?? 0) > MAX_FILE_BYTES
  const todo: string[] = []
  for (const [path, sha] of tree) if (wanted(path) && !tooBig(path) && !(checkpoint !== null && old[path] === sha && stored.has(path))) todo.push(path)
  // A stored file whose SHA is known: the source of a rename or a copy (R6), checked again before use.
  const localBySha = new Map<string, string>()
  for (const path of stored) if (old[path] !== undefined && !localBySha.has(old[path])) localBySha.set(old[path], path)

  const time = now()
  const times = (path: string) => ({ ctime: saved?.records[path]?.ctime ?? time, mtime: time })
  const built = new Map<string, IndexRecord>()
  const progress: PassProgress = { done: 0, total: todo.length }
  const report = () => options.onProgress?.({ ...progress })
  report()
  let fetched = 0

  const storedAt = async (path: string, sha: string): Promise<FileContent | null> => {
    const file = await store.read(vault, path)
    return file !== null && (await gitBlobSha(file.content)) === sha ? file.content : null
  }
  /** The stored copy at `sha`: the file itself, or the source of a rename or a copy (written to `path`). Null: download it. */
  async function fromStore(path: string, sha: string): Promise<FileContent | null> {
    const own = stored.has(path) ? await storedAt(path, sha) : null
    if (own !== null) return own
    const source = localBySha.get(sha)
    const copy = source !== undefined && source !== path ? await storedAt(source, sha) : null
    if (copy !== null) await store.write(vault, path, copy)
    return copy
  }
  /** `text`: the batch's text, checked against `sha`. Without it, the one-file call. */
  async function download(path: string, sha: string, text?: string): Promise<FileContent> {
    let content: FileContent
    if (text !== undefined) content = text
    else {
      const bytes = await remote.blob(sha)
      content = isEager(path) ? decoder.decode(bytes) : bytes
    }
    fetched++
    await store.write(vault, path, content)
    return content
  }
  async function finish(path: string, content: FileContent) {
    if (isIndexed(path) && typeof content === 'string') built.set(path, phoneRecord(path, tree.bytes.get(path) ?? 0, content, times(path)))
    progress.done++
    report()
    await slice()
  }
  async function getOne(path: string) {
    const sha = tree.get(path)!
    await finish(path, (await fromStore(path, sha)) ?? (await download(path, sha)))
  }
  /** One GraphQL query for the batch; each text is kept only at its tree SHA; each other file downloads alone. */
  async function getBatch(paths: readonly string[]) {
    const shas = [...new Set(paths.map((path) => tree.get(path)!))]
    const texts = await remote.blobs(shas)
    const checked = new Map<string, string>()
    for (let i = 0; i < shas.length; i++) {
      const text = texts[i]
      if (text !== null && text !== undefined && (await gitBlobSha(text)) === shas[i]) checked.set(shas[i], text)
      await slice()
    }
    const batchItems: Array<{ path: string; content: string }> = []
    const fallbackPaths: string[] = []
    for (const path of paths) {
      const text = checked.get(tree.get(path)!)
      if (text !== undefined) batchItems.push({ path, content: text })
      else fallbackPaths.push(path)
    }
    if (batchItems.length > 0 && failure === null) {
      if (store.writeBatch !== undefined) {
        await store.writeBatch(vault, batchItems)
        fetched += batchItems.length
        for (const { path, content } of batchItems) await finish(path, content)
      } else {
        for (const { path, content } of batchItems) {
          if (failure !== null) return
          await finish(path, await download(path, tree.get(path)!, content))
        }
      }
    }
    for (const path of fallbackPaths) {
      // Nothing writes after a failure in another lane.
      if (failure !== null) return
      const sha = tree.get(path)!
      await finish(path, await download(path, sha))
    }
  }

  // `width` lanes at one time. On the first failure no new item starts; the pass waits for the ones in flight,
  // so nothing writes after it has failed (the next pass may start at once).
  let failure: { error: unknown } | null = null
  async function lanes<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>) {
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(width, items.length) }, async () => {
        while (failure === null && next < items.length) {
          try {
            await work(items[next++])
          } catch (error) {
            failure ??= { error }
          }
        }
      }),
    )
    if (failure !== null) throw (failure as { error: unknown }).error
  }

  const batchFrom = options.batchFrom ?? BATCH_FROM
  if (todo.length < batchFrom) await lanes(todo, parallel, getOne)
  else {
    // The stored copies first (an interrupted download, a rename): only the rest downloads.
    const local = new Set<string>()
    await lanes(todo, parallel, async (path) => {
      const content = await fromStore(path, tree.get(path)!)
      if (content === null) return
      local.add(path)
      await finish(path, content)
    })
    const missing = todo.filter((path) => !local.has(path))
    const alone = async (path: string) => finish(path, await download(path, tree.get(path)!))
    if (missing.length < batchFrom) await lanes(missing, parallel, alone)
    else {
      const packed = packBatches(missing, (path) => tree.bytes.get(path) ?? 0)
      await lanes(packed.batches, Math.min(parallel, BATCH_LANES), getBatch)
      await lanes(packed.alone, parallel, alone)
    }
  }

  // Gone, too large, or a picture or sound that changed: the kept copy goes (R5, F7, R7).
  const toRemove: string[] = []
  for (const path of stored) {
    const sha = tree.get(path)
    if (sha === undefined || tooBig(path) || (!wanted(path) && old[path] !== sha)) toRemove.push(path)
  }
  if (toRemove.length > 0) {
    if (store.removeBatch !== undefined) await store.removeBatch(vault, toRemove)
    else for (const path of toRemove) await store.remove(vault, path)
    await slice()
  }

  const records: Record<string, IndexRecord> = trusted ? { ...saved.records } : {}
  for (const path of Object.keys(records)) if (!tree.has(path) || !isIndexed(path)) delete records[path]
  for (const [path, sha] of tree) {
    if (!isIndexed(path)) continue
    const made = built.get(path)
    if (made !== undefined) records[path] = made
    else if (tooBig(path)) records[path] = phoneRecord(path, tree.bytes.get(path) ?? 0, null, times(path))
    else if (!(trusted && old[path] === sha && records[path] !== undefined)) {
      const file = await store.read(vault, path)
      if (file !== null && typeof file.content === 'string') records[path] = phoneRecord(path, tree.bytes.get(path) ?? 0, file.content, times(path))
    }
    await slice()
  }
  const index: PhoneIndex = { commit: head.sha, rules: INDEX_RULES, records }
  await store.setState(vault, INDEX_STATE, index)
  // LAST: until this lands, the next pass starts from the old checkpoint and continues (F5).
  await store.setCheckpoint(vault, { commit: head.sha, etag: head.etag === '' ? null : head.etag, shas: Object.fromEntries(tree) })

  const touched = [...diff.added, ...diff.changed, ...diff.removed, ...diff.renamed.flatMap((r) => [r.from, r.to])]
  const settings = [...new Set(touched.filter((p) => kindOnPhone(p) === 'settings'))].sort()
  return { kind: 'synced', commit: head.sha, diff, settings, index, fetched, first: checkpoint === null, sizes: tree.bytes }
}
