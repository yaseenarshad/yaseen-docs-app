import { MAX_FILE_BYTES, type IndexRecord } from '@shared/types'
import { kindOnPhone, type FileContent, type VaultStore } from '../store'
import { gitBlobSha } from './gitSha'
import type { GithubRemote } from './githubRemote'
import { INDEX_STATE, phoneRecord, type PhoneIndex } from './phoneIndex'
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
  /**
   * A file that is not eager but must download in this pass too. It is kept as bytes. Default: none. 3D does NOT use
   * it: the media of the window downloads after the pass (`mobile/src/media/ahead.ts`), so the first download and the
   * checkpoint never wait for pictures.
   */
  alsoEager?: (path: string) => boolean
  /** Downloads at one time. Proof 1B: six at a time made the first download 3 times faster. */
  parallel?: number
  onProgress?: (progress: PassProgress) => void
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
  const saved = await store.getState<PhoneIndex>(vault, INDEX_STATE)
  const trusted = checkpoint !== null && saved !== undefined && saved.commit === checkpoint.commit
  await slice()

  const wanted = (path: string) => isEager(path) || (options.alsoEager?.(path) ?? false)
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
  async function getOne(path: string) {
    const sha = tree.get(path)!
    let content = stored.has(path) ? await storedAt(path, sha) : null
    if (content === null) {
      const source = localBySha.get(sha)
      if (source !== undefined && source !== path) content = await storedAt(source, sha)
      if (content === null) {
        const bytes = await remote.blob(sha)
        fetched++
        content = isEager(path) ? decoder.decode(bytes) : bytes
      }
      await store.write(vault, path, content)
    }
    if (isIndexed(path) && typeof content === 'string') built.set(path, phoneRecord(path, tree.bytes.get(path) ?? 0, content, times(path)))
    progress.done++
    report()
    await slice()
  }

  // `parallel` downloads at one time. On the first failure no new file starts; the pass waits for the ones in flight,
  // so nothing writes after it has failed (the next pass may start at once).
  let next = 0
  let failure: { error: unknown } | null = null
  await Promise.all(
    Array.from({ length: Math.min(parallel, todo.length) }, async () => {
      while (failure === null && next < todo.length) {
        try {
          await getOne(todo[next++])
        } catch (error) {
          failure ??= { error }
        }
      }
    }),
  )
  if (failure !== null) throw (failure as { error: unknown }).error

  // Gone, too large, or a picture or sound that changed: the kept copy goes (R5, F7, R7).
  for (const path of stored) {
    const sha = tree.get(path)
    if (sha === undefined || tooBig(path) || (!wanted(path) && old[path] !== sha)) await store.remove(vault, path)
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
  const index: PhoneIndex = { commit: head.sha, records }
  await store.setState(vault, INDEX_STATE, index)
  // LAST: until this lands, the next pass starts from the old checkpoint and continues (F5).
  await store.setCheckpoint(vault, { commit: head.sha, etag: head.etag === '' ? null : head.etag, shas: Object.fromEntries(tree) })

  const touched = [...diff.added, ...diff.changed, ...diff.removed, ...diff.renamed.flatMap((r) => [r.from, r.to])]
  const settings = [...new Set(touched.filter((p) => kindOnPhone(p) === 'settings'))].sort()
  return { kind: 'synced', commit: head.sha, diff, settings, index, fetched, first: checkpoint === null, sizes: tree.bytes }
}
