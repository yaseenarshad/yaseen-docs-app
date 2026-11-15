import {
  INDEX_FILE,
  LIST_VERSION,
  NUMBERS_FILE,
  PARKED,
  POINTER_FILE,
  readPointerFile,
  readStatsFile,
  SETTLE_MS,
  emptyNumbers,
  gistErrorCode,
  isOurNumbersGist,
  relinkPointers,
  isListFile,
  listFile,
  listPatch,
  readListFiles,
  readListGist,
  type GistDoc,
  type FriendsIndex,
  type GistsApi,
  type IndexFind,
  type IndexHandle,
  type WriteOptions,
} from './friendGists'
import { isTimeZone, type FriendStats } from './friendStats'
import {
  BrokenList,
  LIST_PATH,
  ListError,
  MAX_STALE_WRITES,
  NewerList,
  applyPatch,
  backoff,
  createRepoList,
  listErrorCode,
  listFileText,
  noteText,
  readGuarded,
  readNote,
  readRepoList,
  repoKey,
  staleReadError,
  STALE_WINDOW_MS,
  type ReadGuard,
  type RepoListRead,
  type RepoListSnapshot,
  type RepoPort,
} from './friendListStore'

/**
 * WHERE THE LIST IS, AND EACH WRITE OF IT (YAZ-5083, the list in the vault repo). Pure logic on `GistsApi` and
 * `RepoPort`: the phone and the Mac share it.
 *
 * - `findFriendsIndex` (read only; the Mac's sender uses it): the list gist's note names the home vault; a device that
 *   has that vault reads the list there. An OLD list (a gist list of version 1 or 2, not moved yet) is read as it is.
 * - `openFriendsList` (the phone): the same, and it MOVES an old list into the home vault once, and makes a new list
 *   when asked (the first share, paste or group).
 * - `updateList`: one change of the list as an OPERATION, with compare-and-swap (`STALE_HEAD`: read again, apply again).
 */

/** Where a handle's list lives: the home vault's repo, and the note gist that names it (null: no note yet). */
export interface ListStore {
  readonly port: RepoPort
  readonly note: string | null
  /** YAZ-5398: this device's memory, clock and wait for each read of the list (never older than its own writes). */
  readonly guard?: ReadGuard
}

/** The read guard of a device's options (YAZ-5398). */
export const guardOf = (opts: Partial<Pick<WriteOptions, 'memory' | 'now' | 'sleep'>> | undefined): ReadGuard | undefined =>
  opts === undefined || opts.sleep === undefined ? undefined : { memory: opts.memory, now: opts.now ?? Date.now, sleep: opts.sleep }

/** The commit subject of a list write, in AutoSync's form (`sync (phone): …`), so the vault's history reads the same. */
export const LIST_COMMIT = 'friends (phone): friends.json'

const older = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const fileText = (gist: GistDoc, file: string): string | null => {
  const f = gist.files[file]
  return f === undefined || f.truncated || typeof f.content !== 'string' ? null : f.content
}

async function removeQuietly(api: GistsApi, id: string): Promise<void> {
  try {
    await api.remove(id)
  } catch (err) {
    if (gistErrorCode(err) !== 'NOT_FOUND') throw err
  }
}

/** The handle of a list read from the repo. */
export function handleOf(store: ListStore, snap: RepoListSnapshot, owner: string | null): IndexHandle {
  const { read } = snap
  const seenAt = (store.guard?.now ?? Date.now)()
  return { id: store.note ?? '', index: read.value, raw: read.raw, etag: snap.etag, createdAt: '', files: read.files, state: read.list, owner, sha: snap.sha, store, extra: snap.extra, rev: snap.rev, seenAt }
}

/** The repo ports of the device (its vaults on the friends account), or none. */
async function portsOf(api: GistsApi): Promise<readonly RepoPort[]> {
  return (await api.repos?.()) ?? []
}

/**
 * The list as it is on GitHub now (an ETag read of the branch: free when nothing changed). A list that is gone or cannot
 * be read throws (`BrokenList`: nothing is written to it, YAZ-5191); a newer one throws `NewerList`.
 * YAZ-5398: never a list OLDER than this copy or than what this device wrote or read (a stale read of GitHub): such a
 * read is made again, and if it stays older, this throws `GITHUB_DOWN` (quiet). So a step never goes back.
 */
export async function latestList(handle: IndexHandle): Promise<IndexHandle> {
  const store = handle.store
  if (store === undefined || handle.sha === undefined) throw new Error('This list is not in a vault yet')
  const r = await readGuarded(store.port, store.guard, { etag: handle.etag, known: handle.sha, min: handle.rev ?? 0, minAt: handle.seenAt })
  if (r.kind === 'unchanged') return r.etag === handle.etag ? handle : { ...handle, etag: r.etag }
  if (r.stale) throw staleReadError()
  return fromRead(store, r.read, handle.owner ?? null)
}

function fromRead(store: ListStore, read: RepoListRead, owner: string | null): IndexHandle {
  if (read.kind === 'ok') return handleOf(store, read.snap, owner)
  if (read.kind === 'newer') throw new NewerList()
  throw new BrokenList(read.kind === 'missing')
}

/** One change of the list: the files to write (`null` deletes one), and what the caller learns. `patch: null`: no write. */
export type ListOp<T> = (current: IndexHandle) => { patch: Record<string, string | null> | null; result: T }

/**
 * Writes ONE change of the list with compare-and-swap. The operation runs on the list as read (`handle`); when GitHub
 * says the branch moved (`STALE_HEAD`), it runs AGAIN on the newest list, so two devices' changes compose and none is
 * lost (I7). After `MAX_STALE_WRITES` moves in a row it stops with `GITHUB_DOWN` (quiet: it runs again later).
 */
export async function updateList<T>(handle: IndexHandle, op: ListOp<T>, opts: Pick<WriteOptions, 'sleep'> & { message?: string }): Promise<{ handle: IndexHandle; result: T }> {
  const store = handle.store
  if (store === undefined || handle.sha === undefined) throw new Error('This list is not in a vault yet')
  let base = handle
  for (let attempt = 0; ; attempt++) {
    const { patch, result } = op(base)
    if (patch === null || Object.keys(patch).length === 0) return { handle: base, result }
    const files = applyPatch(base.files ?? {}, patch)
    // YAZ-5398: each write adds 1 to the list's write count; a read with a lower count is a stale read.
    const rev = (base.rev ?? 0) + 1
    let sha: string
    try {
      sha = await store.port.commit(base.sha!, LIST_PATH, listFileText(files, base.extra ?? {}, rev), opts.message ?? LIST_COMMIT)
    } catch (err) {
      if (listErrorCode(err) === 'STALE_HEAD') {
        if (attempt >= MAX_STALE_WRITES) throw Object.assign(new Error('The friends list kept changing on GitHub'), { code: 'GITHUB_DOWN' })
        await opts.sleep(backoff(attempt))
        base = await latestList(base)
        continue
      }
      throw err
    }
    const seenAt = (store.guard?.now ?? Date.now)()
    store.guard?.memory?.saw(repoKey(store.port), rev, seenAt)
    const read = readListFiles(files)
    const at = { sha, etag: null, rev, seenAt }
    return { handle: read.kind !== 'ok' ? { ...base, ...at } : { ...base, ...at, index: read.value, raw: read.raw, files: read.files, state: read.list }, result }
  }
}

/** A plain write: the operation gives only files. */
export async function writeList(handle: IndexHandle, patch: (current: IndexHandle) => Record<string, string | null> | null, opts: Pick<WriteOptions, 'sleep'>): Promise<IndexHandle> {
  return (await updateList(handle, (cur) => ({ patch: patch(cur), result: undefined }), opts)).handle
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding the list.

interface NoteGist {
  id: string
  createdAt: string
  owner: string | null
  read: ReturnType<typeof readNote>
  gist: GistDoc
  /** YAZ-5400: GitHub cut the gist at 300 files (an old list of more): it cannot be read whole. */
  cut: boolean
}

/**
 * The person's list gists, oldest first, each read. A gist deleted meanwhile is skipped.
 * YAZ-5400: a gist is one by ANY list file name, not only the head's: GitHub names at most 300 files of a gist (in the
 * list call and in a read), in name order, and an old list's entry files (`notecards-friends.f.…`) sort BEFORE the head.
 * Such a list is never taken for "no list" (that made a new, empty one).
 */
async function listGists(api: GistsApi): Promise<NoteGist[]> {
  const items = (await api.list()).filter((g) => g.files.some(isListFile)).sort(older)
  const out: NoteGist[] = []
  for (const item of items) {
    let gist: GistDoc | 'unchanged'
    try {
      gist = await api.read(item.id)
    } catch (err) {
      if (gistErrorCode(err) === 'NOT_FOUND') continue
      throw err
    }
    if (gist === 'unchanged') continue
    out.push({ id: item.id, createdAt: item.createdAt, owner: gist.owner ?? null, read: readNote(fileText(gist, INDEX_FILE)), gist, cut: gist.truncated === true })
  }
  return out
}

/** An old list (a gist list, version 1 or 2) as a read-only handle (YAZ-5350: a list GitHub cut short is not read). */
function legacyHandle(g: NoteGist): IndexFind {
  if (g.cut) return { kind: 'broken', id: g.id, cut: true }
  const read = readListGist(g.gist)
  if (read.kind === 'newer') return { kind: 'newer', id: g.id }
  if (read.kind !== 'ok') return { kind: 'broken', id: g.id }
  return { kind: 'ok', handle: { id: g.id, index: read.value, raw: read.raw, etag: g.gist.etag, createdAt: g.createdAt, files: read.files, state: read.list, owner: g.owner } }
}

/** YAZ-5399: GitHub answered 404 for the repo itself (deleted, or this token lost all access to it). */
const repoGone = (err: unknown): boolean => listErrorCode(err) === 'NO_LIST_ACCESS' && (err as { gone?: unknown }).gone === true

/**
 * The list in the vault the note names, if this device has it.
 * - YAZ-5399: a home repo that GitHub does not know any more (deleted, or no access at all: GitHub answers 404 for a
 *   private repo it hides) is `home-gone`: the person gets a way out (`restartList`).
 * - YAZ-5399: a RENAMED or TRANSFERRED repo: GitHub's repo API redirects the old name to the repo, and the port carries
 *   the new name. A device that may write (`renote`) writes the new name into the note at once.
 * - YAZ-5398: the note proves that the list file was there (the note is written after it), so a head with no list file
 *   is first taken as a stale read and read again; only a file that stays missing is "needs repair".
 * - YAZ-5444: a file that stays missing PAST the stale window (`fileGoneForGood`) is a real change on GitHub (deleted by
 *   hand, or the vault made again under the same name), not a lag: `home-gone` with `fileGone`, so the person gets the
 *   same way out (`restartList`). Inside the window it stays "needs repair" (nothing is offered on a lag).
 */
async function atHome(
  api: GistsApi,
  ports: readonly RepoPort[],
  home: string,
  note: string | null,
  owner: string | null,
  guard: ReadGuard | undefined,
  renote = false,
  noteAt: string | null = null,
): Promise<IndexFind> {
  // A vault of this device, or (with the same token) the repo the note names, also one this device has not added.
  let port: RepoPort | undefined
  try {
    port = ports.find((p) => p.repo === home) ?? (api.repo === undefined ? undefined : await api.repo(home))
  } catch (err) {
    if (repoGone(err)) return { kind: 'home-gone', home }
    throw err
  }
  if (port === undefined) return { kind: 'elsewhere', home }
  let r: Awaited<ReturnType<typeof readGuarded>>
  try {
    r = await readGuarded(port, guard, { min: 1 })
  } catch (err) {
    if (repoGone(err)) return { kind: 'home-gone', home }
    throw err
  }
  if (r.kind === 'unchanged') throw new Error('a head read with no ETag cannot be unchanged')
  const read = r.read
  if (read.kind === 'ok') {
    // The repo has a new name (GitHub followed its redirect): the note names it from now on (one read of the repo).
    if (renote && note !== null) {
      const now = port.repo !== home ? port.repo : await port.canonical?.().catch(() => home)
      if (now !== undefined && now !== home) await api.update(note, { [INDEX_FILE]: noteText(now) })
    }
    return { kind: 'ok', handle: handleOf({ port, note, guard }, read.snap, owner) }
  }
  if (read.kind === 'newer') return { kind: 'newer', id: note ?? '' }
  // YAZ-5444: the file stayed missing on every guarded read, and no lag can explain it any more.
  if (read.kind === 'missing' && r.stale && note !== null && fileGoneForGood(port, guard, noteAt)) return { kind: 'home-gone', home, fileGone: true }
  // The note names this vault and the file is gone (deleted by hand) or broken: nothing is written (YAZ-5191).
  return { kind: 'broken', id: note ?? '' }
}

/**
 * YAZ-5444: a list file that is missing at the home is GONE (not a lag) only when nothing in the stale window can
 * explain it: this device saw no list there in the last `STALE_WINDOW_MS` (its memory, YAZ-5398), and the note was last
 * written more than `STALE_WINDOW_MS` ago (the note is always written AFTER its list file, so a lagging replica of a
 * list that another device made a moment ago is never taken for a gone file). A lag is seconds; the window is minutes.
 */
function fileGoneForGood(port: RepoPort, guard: ReadGuard | undefined, noteAt: string | null): boolean {
  const now = (guard?.now ?? Date.now)()
  const floor = guard?.memory?.floor(repoKey(port)) ?? null
  // A list (rev 1 or more) seen inside the window: a missing file may be a lag. (A missing file that the stale rule
  // already took is remembered as rev 0: that is no sign of a lag.)
  if (floor !== null && floor.rev > 0 && Math.abs(now - floor.at) < STALE_WINDOW_MS) return false
  const at = noteAt === null ? NaN : Date.parse(noteAt)
  return Number.isFinite(at) && now - at >= STALE_WINDOW_MS
}

/** A list file in one of the device's vaults with no note (the note was deleted, or a stop before it was written). */
async function findOrphanList(ports: readonly RepoPort[], owner: string | null, guard: ReadGuard | undefined): Promise<IndexFind | null> {
  for (const port of ports) {
    let read: RepoListRead
    try {
      read = await readRepoList(port, guard)
    } catch (err) {
      if (listErrorCode(err) === 'NO_LIST_ACCESS') continue
      throw err
    }
    if (read.kind === 'missing') continue
    if (read.kind === 'ok') return { kind: 'ok', handle: handleOf({ port, note: null, guard }, read.snap, owner) }
    return read.kind === 'newer' ? { kind: 'newer', id: '' } : { kind: 'broken', id: '' }
  }
  return null
}

/**
 * Finds the list, and writes NOTHING (the Mac's sender). An old gist list that is not moved yet comes back as a handle
 * with no `store` (read only). `elsewhere`: the list is in a vault this device does not have.
 */
export async function findFriendsIndex(api: GistsApi, opts?: WriteOptions): Promise<IndexFind> {
  const guard = guardOf(opts)
  const ports = await portsOf(api)
  const gists = await listGists(api)
  const first = gists[0]
  if (first === undefined) return (await findOrphanList(ports, null, guard)) ?? { kind: 'none' }
  if (first.cut) return { kind: 'broken', id: first.id, cut: true }
  switch (first.read.kind) {
    case 'note':
      return atHome(api, ports, first.read.home, first.id, first.owner, guard, false, first.gist.updatedAt)
    case 'legacy':
      return legacyHandle(first)
    case 'newer':
      return { kind: 'newer', id: first.id }
    default:
      return { kind: 'broken', id: first.id }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Opening the list on the phone: move an old list, make a new one.

export interface ListSeed {
  vaults: string[]
  nickname: string | null
  numbers?: FriendStats
  zone?: string | null
}

/** The home vault for a new or moved list: the first vault that counts that this device has, else its first vault. */
export function chooseHome(ports: readonly RepoPort[], preferred: readonly string[]): RepoPort | null {
  for (const repo of preferred) {
    const port = ports.find((p) => p.repo === repo.toLowerCase())
    if (port !== undefined) return port
  }
  return ports[0] ?? null
}

/**
 * The list for a device that may write (the phone). An old gist list is MOVED into the home vault first (once; the gist
 * then holds only the note). With `seed`, a person with no list gets one (the first share, paste or group); without it,
 * `none`. Never makes a second list: a list file that a vault of this device already holds is used.
 */
export async function openFriendsList(api: GistsApi, opts: WriteOptions, seed: ListSeed | null = null): Promise<IndexFind> {
  const guard = guardOf(opts)
  const ports = await portsOf(api)
  const gists = await listGists(api)
  const first = gists[0]
  if (first !== undefined) {
    // YAZ-5400: an old list that GitHub cut at 300 files is not read, not moved, and never replaced by a new list.
    if (first.cut) return { kind: 'broken', id: first.id, cut: true }
    if (first.read.kind === 'note') {
      const found = await atHome(api, ports, first.read.home, first.id, first.owner, guard, true, first.gist.updatedAt)
      if (found.kind === 'ok') await tidyOldGist(api, first.gist)
      return found
    }
    if (first.read.kind === 'newer') return { kind: 'newer', id: first.id }
    if (first.read.kind !== 'legacy') return { kind: 'broken', id: first.id }
    return moveOldList(api, ports, first, opts, gists.slice(1))
  }
  // No note: a list file already in one of my vaults (adopted), or a new list.
  const orphan = await findOrphanList(ports, null, guard)
  if (orphan !== null) {
    if (orphan.kind !== 'ok') return orphan
    return withNote(api, orphan.handle, ports, opts)
  }
  if (seed === null) return { kind: 'none' }
  return makeList(api, ports, seed, opts)
}

/** The version 2 files of a new list: the head, and numbers generation 0 (done). */
function newListFiles(seed: ListSeed, numbers: string): Record<string, string> {
  return {
    [INDEX_FILE]: JSON.stringify({ v: LIST_VERSION, nickname: seed.nickname, vaults: seed.vaults.map((v) => v.toLowerCase()), ...(isTimeZone(seed.zone) && { zone: seed.zone }) }),
    [listFile.gen(0, numbers)]: JSON.stringify({ v: 1, stats: numbers, covers: [] }),
    [listFile.done(numbers)]: '{"v":1}',
  }
}

/** A new list: the numbers gist first, then the list file in the home vault, then the note that names that vault. */
async function makeList(api: GistsApi, ports: readonly RepoPort[], seed: ListSeed, opts: WriteOptions): Promise<IndexFind> {
  const home = chooseHome(ports, seed.vaults)
  if (home === null) return { kind: 'no-vault' }
  const now = opts.now ?? Date.now
  const numbers = await api.create(opts.describe('numbers'), { [NUMBERS_FILE]: JSON.stringify(seed.numbers ?? emptyNumbers(now())) })
  await opts.sleep(1000)
  const guard = guardOf(opts)
  const made = await createRepoList(home, newListFiles(seed, numbers.id), LIST_COMMIT, opts.sleep, guard)
  if (made.kind !== 'ok') {
    await removeQuietly(api, numbers.id)
    return made.kind === 'newer' ? { kind: 'newer', id: '' } : { kind: 'broken', id: '' }
  }
  // Another device made the list at the same moment: its numbers gist is the one; mine goes.
  if (made.snap.read.value.stats !== numbers.id) await removeQuietly(api, numbers.id)
  return withNote(api, handleOf({ port: home, note: null, guard }, made.snap, null), ports, opts)
}

/**
 * Writes the note that names the list's vault, once, and looks again after `SETTLE_MS` (two devices may each write one
 * at the same moment: every device keeps the OLDEST, as decision 15's list gist did).
 */
async function withNote(api: GistsApi, handle: IndexHandle, ports: readonly RepoPort[], opts: WriteOptions): Promise<IndexFind> {
  const home = handle.store!.port.repo
  let gists = await listGists(api)
  if (gists.length === 0) {
    await api.create(opts.describe('index'), { [INDEX_FILE]: noteText(home) })
    await opts.sleep(SETTLE_MS)
    gists = await listGists(api)
  }
  const first = gists[0]
  if (first === undefined) return { kind: 'ok', handle }
  // A twin note of mine (the same vault) goes; the oldest stays.
  for (const g of gists.slice(1)) if (g.read.kind === 'note' && g.read.home === home && g.owner === first.owner) await removeQuietly(api, g.id).catch(() => undefined)
  if (first.read.kind === 'note') {
    if (first.read.home === home) return { kind: 'ok', handle: { ...handle, id: first.id, owner: first.owner, store: { port: handle.store!.port, note: first.id, guard: guardOf(opts) } } }
    // The oldest note names another vault: that list is the one (a new list that lost the race is left empty).
    return atHome(api, ports, first.read.home, first.id, first.owner, guardOf(opts), true, first.gist.updatedAt)
  }
  if (first.read.kind === 'legacy') return moveOldList(api, ports, first, opts)
  return first.read.kind === 'newer' ? { kind: 'newer', id: first.id } : { kind: 'broken', id: first.id }
}

/**
 * MOVES an old gist list (version 1 or 2) into the home vault, once:
 * 1. a list file that one of my vaults already holds is used as it is (another device moved it a moment ago);
 * 2. else the old list is written as records (live entries; every tombstone and generation as it is) by a CAS commit;
 * 3. only then the gist's head becomes the note (`v: 3`: an older app reads "a newer list" and writes nothing), and the
 *    old files leave the gist. A stop before 3 moves it again next time, onto the file that is there (step 1).
 */
async function moveOldList(api: GistsApi, ports: readonly RepoPort[], old: NoteGist, opts: WriteOptions, twins: readonly NoteGist[] = []): Promise<IndexFind> {
  const legacy = legacyHandle(old)
  if (legacy.kind !== 'ok') return legacy
  const h = legacy.handle
  const guard = guardOf(opts)
  let target = await findOrphanList(ports, old.owner, guard)
  if (target === null) {
    const home = chooseHome(ports, h.index.vaults)
    if (home === null) return { kind: 'no-vault' }
    const files = await movedFiles(api, h, opts)
    const made = await createRepoList(home, files, LIST_COMMIT, opts.sleep, guard)
    target = made.kind === 'ok' ? { kind: 'ok', handle: handleOf({ port: home, note: old.id, guard }, made.snap, old.owner) } : made.kind === 'newer' ? { kind: 'newer', id: '' } : { kind: 'broken', id: '' }
  }
  if (target.kind !== 'ok') return target
  const port = target.handle.store!.port
  await api.update(old.id, { [INDEX_FILE]: noteText(port.repo) })
  let handle: IndexHandle = { ...target.handle, id: old.id, owner: old.owner, store: { port, note: old.id, guard } }
  // An older app may have written the old list between this move's read and the note (after the note it reads "a
  // newer list" and stops). Its entry and tombstone FILES of that moment join the moved list: a tombstone above all,
  // so a remove it began is finished here (never lost). What it wrote into an old head's arrays cannot be told apart.
  const read = await gistNow(api, old.id)
  if (read !== null) {
    const late = Object.keys(read.files).filter((n) => n !== INDEX_FILE && isListFile(n) && old.gist.files[n] === undefined)
    if (late.length > 0)
      handle = await writeList(
        handle,
        (cur) => {
          const patch: Record<string, string | null> = {}
          for (const name of late) {
            const text = read.files[name]?.content
            if (typeof text !== 'string' || (cur.files ?? {})[name] !== undefined) continue
            const m = /\.([fgs])\.([0-9a-f]+)\.json$/.exec(name)
            // An entry that a tombstone of the list already ended is not brought back.
            if (m !== null && (cur.state?.tombs ?? []).some((t) => t.mine === m[2])) continue
            patch[name] = text
          }
          return Object.keys(patch).length === 0 ? null : patch
        },
        opts,
      )
    // Only the files this move READ (or joined just now) leave the gist; none is deleted unread.
    await tidyOldGist(api, { ...old.gist, files: { ...old.gist.files, ...Object.fromEntries(late.map((n) => [n, read.files[n]])) } })
  }
  // Old twin lists (two devices made one at the same moment, before): their entries join the moved list, their
  // pointers name the kept numbers gist, then their numbers gist and the twin go (as decision 15's rule did).
  for (const twin of twins) {
    if (twin.read.kind !== 'legacy') continue
    const t = legacyHandle(twin)
    if (t.kind !== 'ok') continue
    const other = t.handle.index
    handle = await writeList(
      handle,
      (cur) => {
        const ix = cur.index
        const next = {
          ...ix,
          friends: [...ix.friends, ...other.friends.filter((f) => !ix.friends.some((k) => k.mine === f.mine))],
          groups: [...ix.groups, ...other.groups.filter((g) => !ix.groups.some((k) => k.mine === g.mine))],
          shared: [...(ix.shared ?? []), ...(other.shared ?? []).filter((x) => !(ix.shared ?? []).some((k) => k.mine === x.mine))],
          nickname: ix.nickname ?? other.nickname,
          vaults: [...new Set([...ix.vaults, ...other.vaults])],
        }
        const patch = listPatch(cur, next)
        return Object.keys(patch).length === 0 ? null : patch
      },
      opts,
    )
    const kept = handle.index.stats
    if (other.stats !== null && other.stats !== kept) {
      if (kept !== null) await relinkPointers(api, [...other.friends.map((f) => f.mine), ...other.groups.map((g) => g.mine), ...(other.shared ?? []).map((x) => x.mine)], kept, opts)
      if (await isOurNumbersGist(api, other.stats)) await removeQuietly(api, other.stats)
    }
    await removeQuietly(api, twin.id)
  }
  return { kind: 'ok', handle }
}

/**
 * The records of a moved list: the head with its own fields (the arrays of a version 1 head become records), each live
 * entry, and each tombstone, generation and done mark as it is. A version 1 remove that waits becomes a tombstone.
 */
export async function movedFiles(api: GistsApi, h: IndexHandle, opts: WriteOptions): Promise<Record<string, string>> {
  const files = h.files ?? {}
  const head = JSON.parse(files[INDEX_FILE] ?? '{}') as Record<string, unknown>
  const { friends: _f, groups: _g, shared: _s, rekey: _r, ...rest } = head
  // A version 1 head's arrays: each entry this app reads becomes a record (with its own fields, a long name whole);
  // each entry it cannot read stays in the head as it is (YAZ-5191: never dropped).
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)) : [])
  const rawOf = (key: 'friends' | 'groups' | 'shared', mine: string) => arr(head[key]).find((x) => x.mine === mine)
  const id = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{1,64}$/i.test(v)
  const readable = { friends: (x: Record<string, unknown>) => id(x.mine) && id(x.theirs), groups: (x: Record<string, unknown>) => id(x.mine) && id(x.group), shared: (x: Record<string, unknown>) => id(x.mine) && typeof x.at === 'string' && x.at.length <= 40 }
  const keepUnread = (key: 'friends' | 'groups' | 'shared', _live: readonly { mine: string }[]) => {
    // Only what this app cannot read stays (an entry a tombstone ended is gone for good, so it is not kept).
    const list = Array.isArray(head[key]) ? (head[key] as unknown[]) : []
    const left = list.filter((x) => !(typeof x === 'object' && x !== null && !Array.isArray(x) && readable[key](x as Record<string, unknown>)))
    return left.length > 0 ? { [key]: left } : {}
  }
  // An entry the reader took (by its pointer) becomes a record; one it did not take stays in the head.
  const out: Record<string, string> = {
    [INDEX_FILE]: JSON.stringify({ ...rest, ...keepUnread('friends', h.index.friends), ...keepUnread('groups', h.index.groups), ...keepUnread('shared', h.index.shared ?? []), v: LIST_VERSION }),
  }
  for (const [name, text] of Object.entries(files)) if (name !== INDEX_FILE && isListFile(name) && !/\.[fgs]\./.test(name)) out[name] = text
  const entry = (name: string, fromHead: Record<string, unknown> | undefined, known: Record<string, unknown>) => {
    let raw: Record<string, unknown> = {}
    try {
      const o = files[name] === undefined ? undefined : (JSON.parse(files[name]) as unknown)
      if (typeof o === 'object' && o !== null && !Array.isArray(o)) raw = o as Record<string, unknown>
    } catch {
      /* the known fields */
    }
    if (files[name] === undefined && fromHead !== undefined) raw = { ...fromHead }
    delete raw.mine
    // A name cut for the screens keeps the file's own (long) name.
    const named = typeof known.name === 'string' && typeof raw.name === 'string' && raw.name.slice(0, 200) === known.name ? { name: raw.name } : {}
    const clean = Object.fromEntries(Object.entries({ ...raw, v: 1, ...known, ...named }).filter(([, v]) => v !== undefined))
    out[name] = JSON.stringify(clean)
  }
  for (const f of h.index.friends) entry(listFile.friend(f.mine), rawOf('friends', f.mine), { name: f.name, theirs: f.theirs, paired: f.paired, login: f.login })
  for (const g of h.index.groups) entry(listFile.group(g.mine), rawOf('groups', g.mine), { name: g.name, group: g.group, admin: g.admin, joined: g.joined, asked: g.asked })
  for (const x of h.index.shared ?? []) entry(listFile.shared(x.mine), rawOf('shared', x.mine), { at: x.at })
  // The tombstones that only the head knew (a version 1 remove that waits).
  const renamed = new Map<string, string>()
  for (const t of h.state?.tombs ?? []) {
    if (!t.id.endsWith('-legacy') && t.id !== 'rekey-legacy') continue
    const id = t.id === 'rekey-legacy' ? `${PARKED}-legacy` : t.id
    renamed.set(t.id, id)
    out[listFile.tomb(id.split('-')[0], 'legacy')] = JSON.stringify({ v: 1, at: t.at, kinds: t.kinds, rekey: true })
  }
  if (renamed.size > 0)
    for (const [name, text] of Object.entries(out)) {
      if (!/\.n\./.test(name)) continue
      const g = JSON.parse(text) as { covers?: string[] }
      if (Array.isArray(g.covers)) out[name] = JSON.stringify({ ...g, covers: g.covers.map((c) => renamed.get(c) ?? c) })
    }
  // A list with no numbers gist at all (an old stop): generation 0 now.
  if (h.index.stats === null) {
    const now = opts.now ?? Date.now
    const made = await api.create(opts.describe('numbers'), { [NUMBERS_FILE]: JSON.stringify(emptyNumbers(now())) })
    out[listFile.gen(0, made.id)] = JSON.stringify({ v: 1, stats: made.id, covers: [] })
    out[listFile.done(made.id)] = '{"v":1}'
  }
  return out
}

/**
 * The old list's files leave the gist once the note is there (the note names only the vault; the entries, names and
 * pointer IDs are in the vault now). Best effort: a refused write (GitHub's 409, a file deleted meanwhile, the hourly
 * limit) leaves them for the next open; the note alone already makes every app read the vault.
 */
async function gistNow(api: GistsApi, id: string): Promise<GistDoc | null> {
  try {
    const g = await api.read(id)
    return g === 'unchanged' || g.truncated === true ? null : g
  } catch (err) {
    if (gistErrorCode(err) === null) throw err
    return null
  }
}

async function tidyOldGist(api: GistsApi, read: GistDoc): Promise<void> {
  try {
    // The files of THIS read that the gist still has (a `null` for a file that is gone would refuse the whole write).
    const names = Object.keys(read.files).filter((n) => n !== INDEX_FILE && isListFile(n))
    if (names.length === 0) return
    const now = await api.read(read.id)
    if (now === 'unchanged') return
    const still = names.filter((n) => n in now.files)
    if (still.length > 0) await api.update(read.id, Object.fromEntries(still.map((n) => [n, null])))
  } catch (err) {
    if (gistErrorCode(err) === null && !(err instanceof ListError)) throw err
  }
}

/**
 * The change from `handle` (as read) to `next`, written as ONE operation on the newest list: the DIFF is applied (each
 * entry, tombstone and generation that changed, record by record), never `next` as a whole, so another device's change
 * at the same moment stays. `extra` adds records of the caller.
 */
export async function writeFriendsIndex(_api: GistsApi, handle: IndexHandle, next: FriendsIndex, extra: Record<string, string | null> = {}, opts: Pick<WriteOptions, 'sleep'> = { sleep: async () => {} }): Promise<IndexHandle> {
  const diff = { ...listPatch(handle, next), ...extra }
  if (Object.keys(diff).length === 0) return handle
  return writeList(handle, () => diff, opts)
}

// ---------------------------------------------------------------------------------------------------------------------
// YAZ-5399: the way out when the home vault is gone.

export type RestartResult =
  | { kind: 'ok'; handle: IndexHandle; deleted: { pointers: number; numbers: number; notes: number } }
  /** The home vault answers again (or there is no note): nothing is changed. */
  | { kind: 'home-is-there' }
  /**
   * `target` is not one of this device's vaults on the friends account, or it is the gone home itself (YAZ-5444: a home
   * vault that answers but lost its list FILE may be the target).
   */
  | { kind: 'bad-target' }
  /** The target vault holds a list file of a newer app: nothing is written to it. */
  | { kind: 'newer' }

/**
 * "Start the friends list again in <vault>" (YAZ-5399, the decision on the issue). Only when the note's home vault is
 * GONE (GitHub answers 404 for it: deleted, or this token has no access at all), or its list FILE is gone past the stale
 * window (YAZ-5444: deleted by hand, or the vault made again under the same name; then the home itself may be the
 * target, and only while the file there is still missing), or the oldest list gist is an old list that GitHub CUT at 300
 * files (YAZ-5400), so a list that can be read is never replaced.
 * The old list cannot be read, so no single friend can be removed. This ends ALL sharing instead, then starts again:
 *
 * 1. EVERY pointer gist of mine (exactly our one file, in our format) is deleted: each friend, each group I am in, each
 *    shared link. No friend or group member has a way to my numbers any more.
 * 2. EVERY numbers gist of mine (exactly our one file, in our format) is deleted: an ID that someone kept reads nothing.
 * 3. A NEW numbers gist (a new ID that no one has), and a new list in `target` with no friend (compare-and-swap: a list
 *    file already there is written over, its records are dead: their pointers are gone).
 * 4. Each list gist of mine (the note, a twin, an old list: they name the old vault, and an old one names friends and
 *    pointer IDs in its revisions) is deleted; then ONE new note names `target`.
 * Each step can run again: a stop before step 4 leaves the old note, so the app offers the same way out again, and the
 * run deletes the numbers gist of the stopped run too (no pointer names it). Group files that I run are left to the
 * clean-up of gists that no list names (`sweepOrphans`, an hour later), as for any other.
 */
export async function restartList(api: GistsApi, target: string, seed: ListSeed, opts: WriteOptions): Promise<RestartResult> {
  const guard = guardOf(opts)
  const ports = await portsOf(api)
  const gists = await listGists(api)
  const first = gists[0]
  // YAZ-5400: an old list that GitHub cut at 300 files cannot be read either: the same way out.
  if (first === undefined || (first.read.kind !== 'note' && !first.cut)) return { kind: 'home-is-there' }
  const home = first.read.kind === 'note' ? first.read.home : null
  const port = ports.find((p) => p.repo === target.toLowerCase())
  if (port === undefined) return { kind: 'bad-target' }
  // Never over a list that is still there: the home (or its list file, YAZ-5444) must be gone NOW.
  let fileGone = false
  if (!first.cut) {
    const at = await atHome(api, ports, home!, first.id, first.owner, guard, false, first.gist.updatedAt)
    if (at.kind !== 'home-gone') return { kind: 'home-is-there' }
    fileGone = at.fileGone === true
  }
  if (port.repo === home && !fileGone) return { kind: 'bad-target' }
  const deleted = { pointers: 0, numbers: 0, notes: 0 }
  // 1 and 2: every pointer, then every numbers gist, that is provably ours.
  const mine = await api.list()
  for (const kind of ['pointer', 'numbers'] as const) {
    const file = kind === 'pointer' ? POINTER_FILE : NUMBERS_FILE
    for (const item of mine.filter((g) => g.files.length === 1 && g.files[0] === file)) {
      let gist: GistDoc | 'unchanged'
      try {
        gist = await api.read(item.id)
      } catch (err) {
        if (gistErrorCode(err) === 'NOT_FOUND') continue
        throw err
      }
      if (gist === 'unchanged' || Object.keys(gist.files).length !== 1) continue
      const ours = kind === 'pointer' ? readPointerFile(fileText(gist, POINTER_FILE)).kind === 'ok' : readStatsFile(fileText(gist, NUMBERS_FILE)).kind === 'ok'
      if (!ours) continue
      await removeQuietly(api, item.id)
      deleted[kind === 'pointer' ? 'pointers' : 'numbers']++
    }
  }
  // 3. A new numbers gist and the new list.
  const now = opts.now ?? Date.now
  const numbers = await api.create(opts.describe('numbers'), { [NUMBERS_FILE]: JSON.stringify(seed.numbers ?? emptyNumbers(now())) })
  await opts.sleep(1000)
  const files = newListFiles(seed, numbers.id)
  const made = await replaceRepoList(port, files, guard, opts.sleep, port.repo === home)
  if (made === 'newer' || made === 'there') {
    await removeQuietly(api, numbers.id)
    return { kind: made === 'newer' ? 'newer' : 'home-is-there' }
  }
  // 4. The old list gists go (the note names a vault that is gone; an old one holds friends' pointer IDs), then the note.
  for (const g of gists) {
    if (g.read.kind !== 'note' && g.read.kind !== 'legacy' && g.read.kind !== 'unreadable' && !g.cut) continue
    await removeQuietly(api, g.id)
    deleted.notes++
  }
  const found = await withNote(api, handleOf({ port, note: null, guard }, made, null), ports, opts)
  if (found.kind !== 'ok') throw new BrokenList()
  return { kind: 'ok', handle: found.handle, deleted }
}

/**
 * Writes `files` as THE list of `port`, over any list file there (compare-and-swap; a newer app's file is not touched).
 * `onlyIfMissing` (YAZ-5444, the home vault that lost its list file): a list file that is there again is never replaced
 * (`'there'`). The new `rev` is above any this device remembers for the repo, so no device that read the old list takes
 * the new one for a stale read.
 */
async function replaceRepoList(port: RepoPort, files: Record<string, string>, guard: ReadGuard | undefined, sleep: (ms: number) => Promise<void>, onlyIfMissing = false): Promise<RepoListSnapshot | 'newer' | 'there'> {
  const remembered = guard?.memory?.floor(repoKey(port))?.rev ?? 0
  for (let attempt = 0; ; attempt++) {
    const r = await readGuarded(port, guard)
    if (r.kind === 'unchanged') throw new Error('a head read with no ETag cannot be unchanged')
    if (r.stale) throw staleReadError()
    const read = r.read
    if (read.kind === 'newer') return 'newer'
    if (onlyIfMissing && read.kind !== 'missing') return 'there'
    // An unreadable file has no snapshot: the branch head now (a stale one is refused by the compare-and-swap below).
    const head = read.kind === 'ok' ? read.snap.sha : read.kind === 'missing' ? read.sha : await port.head()
    if (head === 'unchanged') throw new Error('a head read with no ETag cannot be unchanged')
    const sha = typeof head === 'string' ? head : head.sha
    const rev = Math.max(read.kind === 'ok' ? read.snap.rev : 0, remembered) + 1
    let made: string
    try {
      made = await port.commit(sha, LIST_PATH, listFileText(files, {}, rev), LIST_COMMIT)
    } catch (err) {
      if (listErrorCode(err) === 'STALE_HEAD') {
        if (attempt >= MAX_STALE_WRITES) throw Object.assign(new Error('The friends list kept changing on GitHub'), { code: 'GITHUB_DOWN' })
        await sleep(backoff(attempt))
        continue
      }
      throw err
    }
    guard?.memory?.saw(repoKey(port), rev, guard.now())
    const parsed = readListFiles(files)
    if (parsed.kind !== 'ok') throw new Error('A new list reads as a list')
    return { sha: made, etag: null, read: parsed, extra: {}, rev }
  }
}

export type EnsureResult = { kind: 'ok'; handle: IndexHandle } | { kind: 'newer' } | { kind: 'broken' } | { kind: 'elsewhere'; home: string } | { kind: 'no-vault' }

/** Make or find the person's list (and numbers gist): `openFriendsList` with a seed. */
export async function ensureFriendsFiles(api: GistsApi, seed: ListSeed, opts: WriteOptions): Promise<EnsureResult> {
  const found = await openFriendsList(api, opts, seed)
  switch (found.kind) {
    case 'ok':
      return found.handle.store === undefined ? { kind: 'broken' } : { kind: 'ok', handle: found.handle }
    case 'newer':
      return { kind: 'newer' }
    case 'elsewhere':
      return found
    case 'no-vault':
      return found
    default:
      return { kind: 'broken' }
  }
}

/** Whether a find result is a list in a vault (a handle that writes). */
export const inVault = (h: IndexHandle): boolean => h.store !== undefined && h.sha !== undefined

export { BrokenList, NewerList, ListError, listErrorCode, MAX_STALE_WRITES }
