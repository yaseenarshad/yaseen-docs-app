import {
  INDEX_FILE,
  LIST_VERSION,
  NUMBERS_FILE,
  POINTER_FILE,
  readPointerFile,
  readStatsFile,
  SETTLE_MS,
  emptyNumbers,
  gistErrorCode,
  isListFile,
  listFile,
  listPatch,
  readListFiles,
  type GistDoc,
  type GistListItem,
  type FriendsIndex,
  type GistsApi,
  type IndexFind,
  type IndexHandle,
  type WriteOptions,
} from './friendGists'
import { isTimeZone, type FriendStats } from './friendStatsFormat'
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
 *   has that vault reads the list there. A gist list of version 1 or 2 (a format that never shipped) is `broken`: it is
 *   not read, and nothing is written to it (YAZ-5191).
 * - `openFriendsList` (the phone): the same, and it makes a new list when asked (the first share, paste or group).
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
  if (r.kind === 'unchanged') {
    // YAZ-5444: the list is still there as this copy has it: this device saw it NOW (a later missing file within the
    // stale window may be a lag, never a file gone for good).
    if (handle.rev !== undefined) store.guard?.memory?.saw(repoKey(store.port), handle.rev, store.guard.now())
    return r.etag === handle.etag ? handle : { ...handle, etag: r.etag }
  }
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
async function listGists(api: GistsApi, all = false, listed?: readonly GistListItem[]): Promise<NoteGist[]> {
  // YAZ-5464 (nit): the way out sees EVERY gist (`all`), so no old list gist is left that names friends' pointers.
  const items = (listed ?? (await (all ? everyGist(api) : api.list()))).filter((g) => g.files.some(isListFile)).sort(older)
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
  if (read.kind === 'missing' && r.stale && note !== null && fileGoneForGood(api, port, guard, noteAt)) return { kind: 'home-gone', home, fileGone: true }
  // The note names this vault and the file is gone (deleted by hand) or broken: nothing is written (YAZ-5191).
  return { kind: 'broken', id: note ?? '' }
}

/**
 * YAZ-5444: a list file that is missing at the home is GONE (not a lag) only when nothing in the stale window can
 * explain it: this device saw no list there in the last `STALE_WINDOW_MS` (its memory, YAZ-5398), and the note was last
 * written more than `STALE_WINDOW_MS` ago (the note is always written AFTER its list file, so a lagging replica of a
 * list that another device made a moment ago is never taken for a gone file). A lag is seconds; the window is minutes.
 *
 * YAZ-5463: the note's age is measured on GITHUB's clock only: its `updated_at` against GitHub's time of the same
 * answers (`api.serverTime()`, as the clean-up sweep does), never the phone's clock (a phone 12 minutes fast took a list
 * made 1 minute ago for one gone 13 minutes). No GitHub time known: not gone (the person tries again later).
 * The memory part uses the phone's clock for both ends (when it saw the list, and now), so a jump of that clock can only
 * make it older or newer than it is: a jump that makes it look old just leaves the decision to the note's age on
 * GitHub's clock (the condition that proves the file was there long enough); a jump the other way only waits longer.
 * Neither can make a lag look like a file gone for good on its own.
 */
function fileGoneForGood(api: GistsApi, port: RepoPort, guard: ReadGuard | undefined, noteAt: string | null): boolean {
  const now = (guard?.now ?? Date.now)()
  const floor = guard?.memory?.floor(repoKey(port)) ?? null
  // A list (rev 1 or more) seen inside the window: a missing file may be a lag. (A missing file that the stale rule
  // already took is remembered as rev 0: that is no sign of a lag.)
  if (floor !== null && floor.rev > 0 && Math.abs(now - floor.at) < STALE_WINDOW_MS) return false
  const at = noteAt === null ? NaN : Date.parse(noteAt)
  const github = api.serverTime?.() ?? null
  return Number.isFinite(at) && github !== null && Number.isFinite(github) && github - at >= STALE_WINDOW_MS
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
 * Finds the list, and writes NOTHING (the Mac's sender). An old gist list (version 1 or 2) is `broken`. `elsewhere`: the
 * list is in a vault this device does not have.
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
    case 'newer':
      return { kind: 'newer', id: first.id }
    default:
      return { kind: 'broken', id: first.id }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Opening the list on the phone: make a new one.

export interface ListSeed {
  vaults: string[]
  nickname: string | null
  numbers?: FriendStats
  zone?: string | null
}

/** The home vault for a new list: the first vault that counts that this device has, else its first vault. */
export function chooseHome(ports: readonly RepoPort[], preferred: readonly string[]): RepoPort | null {
  for (const repo of preferred) {
    const port = ports.find((p) => p.repo === repo.toLowerCase())
    if (port !== undefined) return port
  }
  return ports[0] ?? null
}

/**
 * The list for a device that may write (the phone). An old gist list (version 1 or 2) is `broken`: nothing is written
 * to it. With `seed`, a person with no list gets one (the first share, paste or group); without it, `none`. Never makes
 * a second list: a list file that a vault of this device already holds is used.
 */
export async function openFriendsList(api: GistsApi, opts: WriteOptions, seed: ListSeed | null = null): Promise<IndexFind> {
  const guard = guardOf(opts)
  const ports = await portsOf(api)
  const gists = await listGists(api)
  const first = gists[0]
  if (first !== undefined) {
    // YAZ-5400: an old list that GitHub cut at 300 files is not read, and never replaced by a new list.
    if (first.cut) return { kind: 'broken', id: first.id, cut: true }
    if (first.read.kind === 'note') {
      const found = await atHome(api, ports, first.read.home, first.id, first.owner, guard, true, first.gist.updatedAt)
      // YAZ-5462: a way out that stopped after its new list: its deletes are finished here, then its mark goes.
      const handle = found.kind === 'ok' && wayOutOf(found.handle) !== null ? await finishWayOut(api, found.handle, opts) : found.kind === 'ok' ? found.handle : null
      // YAZ-5492: a marked list in another of my vaults is a way out that lost (another phone's note won): its mark goes.
      if (handle !== null && wayOutOf(handle) === null) await clearStaleMarks(ports, handle, opts)
      return handle === null ? found : { kind: 'ok', handle }
    }
    if (first.read.kind === 'newer') return { kind: 'newer', id: first.id }
    return { kind: 'broken', id: first.id }
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
  // A twin note of mine goes; the oldest stays. YAZ-5492: also a note that names ANOTHER vault (two phones' way outs
  // into two vaults at the same moment each wrote one): every app reads the oldest, and a second note would only name
  // a list that lost (it read as a second home in the checker's model).
  if (first.read.kind === 'note') for (const g of gists.slice(1)) if (g.read.kind === 'note' && g.owner === first.owner) await removeQuietly(api, g.id).catch(() => undefined)
  if (first.read.kind === 'note') {
    if (first.read.home === home) return { kind: 'ok', handle: { ...handle, id: first.id, owner: first.owner, store: { port: handle.store!.port, note: first.id, guard: guardOf(opts) } } }
    // The oldest note names another vault: that list is the one (a new list that lost the race is left empty).
    return atHome(api, ports, first.read.home, first.id, first.owner, guardOf(opts), true, first.gist.updatedAt)
  }
  return first.read.kind === 'newer' ? { kind: 'newer', id: first.id } : { kind: 'broken', id: first.id }
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
   * YAZ-5464 (nit): GitHub would not list EVERY gist of mine (more than `MAX_GIST_PAGES` pages), so a pointer could be
   * missed: nothing is changed (never a way out that silently leaves a friend's pointer).
   */
  | { kind: 'too-many-gists' }

/**
 * YAZ-5462: the list file's mark of a way out that is not finished: the ID of the way out's new numbers gist. While a
 * list carries it, its old pointers and numbers gists may still be there; whoever opens the list by its note finishes
 * the deletes (`finishWayOut`) and then takes the mark away. So a stop between the new list and the deletes never
 * leaves a friend's pointer for good, although the list reads as fine (no way out is offered over it any more).
 */
export const WAY_OUT = 'wayOut'

/** The way-out mark of a list (YAZ-5462), or null. */
export const wayOutOf = (h: IndexHandle): string | null => {
  const v = h.extra?.[WAY_OUT]
  return typeof v === 'string' && /^[0-9a-f]{1,64}$/i.test(v) ? v : null
}

/**
 * "Start the friends list again in <vault>" (YAZ-5399, the decision on the issue). Only when the note's home vault is
 * GONE (GitHub answers 404 for it: deleted, or this token has no access at all), or its list FILE is gone past the stale
 * window (YAZ-5444: deleted by hand, or the vault made again under the same name, with no commit at all too, YAZ-5464;
 * then the home itself may be the target, and only while the file there is still missing), or the oldest list gist is
 * an old list that GitHub CUT at 300 files (YAZ-5400), so a list that can be read is never replaced.
 * The old list cannot be read, so no single friend can be removed. This ends ALL sharing instead, then starts again.
 *
 * YAZ-5462: the NEW LIST FIRST, the deletes after it (it was the other way round: a list file that came back between
 * the check and the new list found every pointer already deleted). I9 (a way out over a list that can be read deletes
 * nothing) holds in every order:
 *
 * 0. EVERY gist of mine is listed (YAZ-5464 nit: all pages; more than GitHub lists is `too-many-gists`, nothing done).
 * 1. A NEW numbers gist (a new ID that no one has).
 * 2. The new list with no friend, marked `wayOut` (compare-and-swap). In the HOME vault the write is allowed only while
 *    the file there is still missing: the CAS is the check, at the same commit as the write, so a file that came back
 *    (a push, a restore) refuses it, and nothing at all is deleted (`home-is-there`; the new numbers gist goes). In
 *    ANOTHER vault (any list file there is written over: its records are dead), the home is checked AGAIN right after
 *    the write and right before the deletes; a home that answers with its list now gets nothing deleted either (the
 *    target's mark goes, so no one acts on it).
 * 3. EVERY pointer gist of mine (exactly our one file, in our format) that names another numbers gist than the new list
 *    names, and EVERY such numbers gist, is deleted: each friend, each group I am in, each shared link. No friend or
 *    group member has a way to my numbers any more. (A pointer that names the new numbers gist is new: it stays.)
 *    YAZ-5492: only the gists that were there when step 0 listed them (the sharing it ends). A newer gist is another
 *    phone's way out at the same moment (into another vault), or its new list's generation or friend: it stays, and so
 *    does an older numbers gist that a MARKED list in my vaults names (another way out's own).
 * 4. Each list gist of mine (the note, a twin, an old list: they name the old vault, and an old one names friends and
 *    pointer IDs in its revisions) is deleted; then ONE new note names `target` (YAZ-5492: the oldest note wins; a
 *    newer one, of another phone's way out into another vault, goes; that phone's list then lost: its mark and its
 *    numbers gist go).
 * 5. The `wayOut` mark leaves the list (YAZ-5492: chosen from the list proved newest, `finishWayOut`).
 * YAZ-5492: if the new list's write fails, its numbers gist goes at once. A list whose numbers gist is gone after all
 * (what a phone could not see of another phone's way out) heals: the phone gives it a new generation (`healNumbers`).
 * Each step can run again: a stop before 2 leaves the old note and no list (the same way out is offered again, and its
 * run deletes the numbers gist of the stopped run, as no list names it); a stop after 2 leaves the mark, and the next
 * open of the list by its note finishes 3 to 5 (`openFriendsList`); in another vault, a stop before 4 leaves the old
 * note, so the way out is offered again. Group files that I run are left to the clean-up of gists that no list names
 * (`sweepOrphans`, an hour later), as for any other.
 */
export async function restartList(api: GistsApi, target: string, seed: ListSeed, opts: WriteOptions): Promise<RestartResult> {
  const guard = guardOf(opts)
  const ports = await portsOf(api)
  // 0. Every gist of mine can be seen (a pointer that the way out cannot see is never left behind silently).
  let gists: NoteGist[]
  let every: GistListItem[]
  try {
    every = await everyGist(api)
    gists = await listGists(api, true, every)
  } catch (err) {
    if (tooManyGists(err)) return { kind: 'too-many-gists' }
    throw err
  }
  // YAZ-5492: the gists that exist as this way out starts: the sharing it ends (every pointer and numbers gist of them
  // goes, also one that an old list names: an old list that came back still names the old numbers gist, which a removed
  // friend can read by its ID). A gist made later is new (another phone's way out, its new generation, a friend added
  // on its list, at the same moment): it is never deleted here.
  const before = new Set(every.map((g) => g.id.toLowerCase()))
  const first = gists[0]
  // YAZ-5400: an old list that GitHub cut at 300 files cannot be read either: the same way out.
  if (first === undefined || (first.read.kind !== 'note' && !first.cut)) return { kind: 'home-is-there' }
  const home = first.read.kind === 'note' ? first.read.home : null
  const port = ports.find((p) => p.repo === target.toLowerCase())
  if (port === undefined) return { kind: 'bad-target' }
  // Never over a list that is still there: the home (or its list file, YAZ-5444) must be gone NOW.
  const homeGone = async (): Promise<IndexFind> => atHome(api, ports, home!, first.id, first.owner, guard, false, first.gist.updatedAt)
  let fileGone = false
  if (!first.cut) {
    const at = await homeGone()
    if (at.kind !== 'home-gone') return { kind: 'home-is-there' }
    fileGone = at.fileGone === true
  }
  const inHome = port.repo === home
  if (inHome && !fileGone) return { kind: 'bad-target' }
  // 1 and 2. A new numbers gist, and the new list (in the home: only while its file is still missing).
  const now = opts.now ?? Date.now
  const numbers = await api.create(opts.describe('numbers'), { [NUMBERS_FILE]: JSON.stringify(seed.numbers ?? emptyNumbers(now())) })
  await opts.sleep(1000)
  const step = { committed: false }
  let made: Awaited<ReturnType<typeof replaceRepoList>>
  try {
    made = await replaceRepoList(port, newListFiles(seed, numbers.id), guard, opts.sleep, inHome, { [WAY_OUT]: numbers.id }, step)
  } catch (err) {
    // YAZ-5492 (nit): the new list was not written: its numbers gist goes at once (no stray gist). A commit that may
    // have landed (no answer) is read back first: a list that names the gist keeps it.
    await dropUnlisted(api, port, numbers.id, step.committed, guard)
    throw err
  }
  if (made === 'newer' || made === 'there') {
    await removeQuietly(api, numbers.id)
    return { kind: made === 'newer' ? 'newer' : 'home-is-there' }
  }
  let handle = handleOf({ port, note: null, guard }, made, null)
  // Another vault: the home is checked AGAIN, right before the deletes.
  if (!inHome && !first.cut && (await homeGone()).kind !== 'home-gone') {
    await clearWayOut(handle, opts).catch(() => undefined)
    await removeQuietly(api, numbers.id)
    return { kind: 'home-is-there' }
  }
  // 3. Every old pointer, then every old numbers gist, that is provably ours (YAZ-5492: never a numbers gist of another
  // phone's way out into another vault at the same moment).
  const deleted = { ...(await deleteOld(api, new Set([numbers.id.toLowerCase()]), ports, (g) => before.has(g.id.toLowerCase()))), notes: 0 }
  // 4. The old list gists go (the note names a vault that is gone; an old one holds friends' pointer IDs), then the note.
  for (const g of gists) {
    if (g.read.kind !== 'note' && g.read.kind !== 'legacy' && g.read.kind !== 'unreadable' && !g.cut) continue
    await removeQuietly(api, g.id)
    deleted.notes++
  }
  const found = await withNote(api, handle, ports, opts)
  if (found.kind !== 'ok') throw new BrokenList()
  // YAZ-5492: another phone's way out into another vault won (its note is older): my new list is no list any more.
  // Its mark goes (its deletes ran above; no one may act on it later), only while it is still my own mark.
  if (found.handle.store?.port.repo !== port.repo) {
    // YAZ-5492: another phone's way out into another vault won (its note is older): my new list is no list any more.
    // Its mark goes (its deletes ran above; no one may act on it later), only while it is still my own mark; then its
    // numbers gist goes too (no pointer names it: no friend was ever added to that list).
    const cleared = await clearMark(handle, numbers.id, opts).catch(() => null)
    if (cleared !== null && wayOutOf(cleared) === null && !numbersOf({ value: found.handle.index, list: found.handle.state }, found.handle.extra).includes(numbers.id.toLowerCase())) await removeQuietly(api, numbers.id).catch(() => undefined)
  }
  handle = found.handle
  // 5. The mark goes (the list that the note names now: another device's way out at the same moment may have won).
  if (wayOutOf(handle) !== null) handle = await finishWayOut(api, handle, opts)
  return { kind: 'ok', handle, deleted }
}

/** YAZ-5464 (nit): the most pages of `GET /gists` a way out reads (100 a page); more is `TOO_MANY_GISTS`. */
export const MAX_GIST_PAGES = 30
const tooManyGists = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === 'TOO_MANY_GISTS'

/** EVERY gist of mine (all pages), or `TOO_MANY_GISTS` (an adapter with no `listAll` lists them all in `list`). */
async function everyGist(api: GistsApi) {
  return api.listAll === undefined ? api.list() : api.listAll(MAX_GIST_PAGES)
}

/**
 * YAZ-5492: every numbers gist that a list in one of my vaults names (each generation, the old v2 numbers, the mark),
 * of the lists that carry a `wayOut` mark: the new lists of other way outs at the same moment (another phone's, into a
 * vault this device may not have). The vaults: this device's own (on the friends account), and each vault that a note
 * gist of mine names. A vault this token cannot see is skipped; any other failure throws (nothing is deleted on a
 * guess). An UNMARKED list does not count here: an old list that came back (a push, a restore) names the old numbers
 * gist, which a removed friend can still read by its ID; the way out deletes that one (I1).
 */
async function wayOutNumbers(api: GistsApi, ports: readonly RepoPort[]): Promise<Set<string>> {
  const out = new Set<string>()
  const vaults = new Map<string, RepoPort | null>(ports.map((p) => [p.repo, p]))
  for (const g of await listGists(api)) if (g.read.kind === 'note' && !vaults.has(g.read.home)) vaults.set(g.read.home, null)
  for (const [name, known] of vaults) {
    try {
      const port = known ?? (api.repo === undefined ? null : await api.repo(name))
      if (port === null) continue
      // No read guard: an older list than this device saw (an old list that came back over the way out's new one) is
      // read as it is, never taken for a stale read that stops the deletes.
      const read = await readRepoList(port)
      if (read.kind !== 'ok' || typeof read.snap.extra[WAY_OUT] !== 'string') continue
      for (const id of numbersOf(read.snap.read, read.snap.extra)) out.add(id)
    } catch (err) {
      if (listErrorCode(err) === 'NO_LIST_ACCESS') continue
      throw err
    }
  }
  return out
}

/** The numbers gists one list names (lower case). */
function numbersOf(read: { value: FriendsIndex; list?: { gens: readonly { stats: string }[]; legacyStats: string | null } }, extra: Record<string, unknown> | undefined): string[] {
  const mark = extra?.[WAY_OUT]
  return [read.value.stats, ...(read.list?.gens ?? []).map((g) => g.stats), read.list?.legacyStats ?? null, typeof mark === 'string' ? mark : null].filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase())
}

/**
 * YAZ-5462: deletes every pointer gist of mine that does not name a numbers gist in `keep`, and every numbers gist of
 * mine not in `keep` (each exactly our one file, in our format, read fresh). Every gist is listed (all pages).
 * YAZ-5492: only the gists that the way out ENDS (`old`: they were there when it started). A newer gist is never
 * deleted here: another phone's way out into another vault at the same moment, its new generation, a friend added on
 * its new list. And an old numbers gist that a marked list in my vaults names (another way out's, that started a moment
 * before) stays, with each pointer that names it (`wayOutNumbers`, read again right before the numbers go). What one
 * phone could still not see (another phone's list in a vault it does not have, before that phone's note) heals: a list
 * whose numbers gist is gone gets a new generation (`healNumbers`).
 */
async function deleteOld(api: GistsApi, keep: ReadonlySet<string>, ports: readonly RepoPort[], old: (g: GistListItem) => boolean): Promise<{ pointers: number; numbers: number }> {
  const deleted = { pointers: 0, numbers: 0 }
  const mine = await everyGist(api)
  let named = await wayOutNumbers(api, ports)
  for (const kind of ['pointer', 'numbers'] as const) {
    const file = kind === 'pointer' ? POINTER_FILE : NUMBERS_FILE
    if (kind === 'numbers') named = await wayOutNumbers(api, ports)
    for (const item of mine.filter((g) => g.files.length === 1 && g.files[0] === file && !keep.has(g.id.toLowerCase()) && old(g))) {
      if (kind === 'numbers' && named.has(item.id.toLowerCase())) continue
      let gist: GistDoc | 'unchanged'
      try {
        gist = await api.read(item.id)
      } catch (err) {
        if (gistErrorCode(err) === 'NOT_FOUND') continue
        throw err
      }
      if (gist === 'unchanged' || Object.keys(gist.files).length !== 1) continue
      if (kind === 'pointer') {
        const p = readPointerFile(fileText(gist, POINTER_FILE))
        if (p.kind !== 'ok') continue
        const stats = p.value.stats.toLowerCase()
        if (keep.has(stats) || named.has(stats)) continue
      } else if (readStatsFile(fileText(gist, NUMBERS_FILE)).kind !== 'ok') continue
      await removeQuietly(api, item.id)
      deleted[kind === 'pointer' ? 'pointers' : 'numbers']++
    }
  }
  return deleted
}

/**
 * YAZ-5462: finishes a way out that stopped after its new list (the list carries the `wayOut` mark): the deletes of
 * step 3, then the mark goes. Kept: every numbers gist that the list names now (each generation, and the mark's), and
 * (YAZ-5492) every numbers gist that any list in my vaults names.
 * YAZ-5492 (R8-6): what to keep is chosen from the list PROVED to be the newest: a compare-and-swap write of it (the
 * same list, its write count one up) lands only on the branch head. A stale read (a lagging replica gave an older,
 * marked list after the way out ended and a remove made a new generation) is refused there and read again; then the
 * newest list (no mark) deletes nothing.
 */
export async function finishWayOut(api: GistsApi, handle: IndexHandle, opts: Pick<WriteOptions, 'sleep'>): Promise<IndexHandle> {
  if (wayOutOf(handle) === null) return handle
  const proved = await rewriteExtra(handle, (base) => (wayOutOf(base) === null ? null : (base.extra ?? {})), opts)
  const mark = wayOutOf(proved)
  if (mark === null) return proved
  const keep = new Set([mark.toLowerCase(), ...(proved.index.stats === null ? [] : [proved.index.stats.toLowerCase()]), ...(proved.state?.gens ?? []).map((g) => g.stats.toLowerCase())])
  // YAZ-5492: the gists the way out ends are those made BEFORE its numbers gist (GitHub's `created_at` of both, whole
  // seconds: the same second counts as new). With the mark's gist gone, every gist counts as old (as before).
  const every = await everyGist(api)
  const born = every.find((g) => g.id.toLowerCase() === mark.toLowerCase())?.createdAt
  await deleteOld(api, keep, await portsOf(api), (g) => born === undefined || g.createdAt < born)
  return clearWayOut(proved, opts)
}

/** The `wayOut` mark leaves the list (compare-and-swap; on a moved branch, from the newest list). */
function clearWayOut(handle: IndexHandle, opts: Pick<WriteOptions, 'sleep'>): Promise<IndexHandle> {
  return rewriteExtra(handle, (base) => (wayOutOf(base) === null ? null : withoutMark(base)), opts)
}

/**
 * YAZ-5492: a list with a `wayOut` mark in one of my vaults that the note does NOT name is a way out that lost (two
 * phones' way outs into two vaults at the same moment: the older note won). Its mark goes, and nothing is deleted for
 * it: the list the note names has no mark, so its own way out already ended all the sharing from before both (each
 * deletes every gist older than its own numbers gist). A list read with no mark, or one that cannot be read, is left.
 * Only the list's extra fields change (compare-and-swap), so a later open never acts on the dead list's mark.
 */
async function clearStaleMarks(ports: readonly RepoPort[], live: IndexHandle, opts: WriteOptions): Promise<void> {
  const home = live.store?.port.repo
  if (home === undefined) return
  const guard = guardOf(opts)
  for (const port of ports) {
    if (port.repo === home) continue
    try {
      const read = await readRepoList(port, guard)
      if (read.kind !== 'ok' || typeof read.snap.extra[WAY_OUT] !== 'string') continue
      const h = handleOf({ port, note: null, guard }, read.snap, null)
      const mark = wayOutOf(h)
      if (mark !== null) await clearMark(h, mark, opts)
    } catch (err) {
      if (listErrorCode(err) === 'NO_LIST_ACCESS' || gistErrorCode(err) !== null) continue
      throw err
    }
  }
}

/** YAZ-5492: the mark leaves the list only while it is `mine` (the mark of this way out, not of a later one). */
function clearMark(handle: IndexHandle, mine: string, opts: Pick<WriteOptions, 'sleep'>): Promise<IndexHandle> {
  return rewriteExtra(handle, (base) => (wayOutOf(base)?.toLowerCase() !== mine.toLowerCase() ? null : withoutMark(base)), opts)
}

const withoutMark = (base: IndexHandle): Record<string, unknown> => {
  const { [WAY_OUT]: _mark, ...extra } = base.extra ?? {}
  return extra
}

/**
 * Writes the list again with the extra fields `next` gives (null: no write), its write count one up (compare-and-swap;
 * on a moved branch, `next` runs again on the newest list). The handle that comes back is the list at the new commit.
 */
async function rewriteExtra(handle: IndexHandle, next: (base: IndexHandle) => Record<string, unknown> | null, opts: Pick<WriteOptions, 'sleep'>): Promise<IndexHandle> {
  const store = handle.store
  if (store === undefined || handle.sha === undefined) return handle
  let base = handle
  for (let attempt = 0; ; attempt++) {
    const extra = next(base)
    if (extra === null) return base
    const rev = (base.rev ?? 0) + 1
    let sha: string
    try {
      sha = await store.port.commit(base.sha!, LIST_PATH, listFileText(base.files ?? {}, extra, rev), LIST_COMMIT)
    } catch (err) {
      if (listErrorCode(err) !== 'STALE_HEAD') throw err
      if (attempt >= MAX_STALE_WRITES) throw Object.assign(new Error('The friends list kept changing on GitHub'), { code: 'GITHUB_DOWN' })
      await opts.sleep(backoff(attempt))
      base = await latestList(base)
      continue
    }
    const seenAt = (store.guard?.now ?? Date.now)()
    store.guard?.memory?.saw(repoKey(store.port), rev, seenAt)
    return { ...base, sha, etag: null, rev, seenAt, extra }
  }
}

/**
 * YAZ-5492 (nit): the numbers gist of a way out whose new list was not written goes at once. When the commit may have
 * landed (it got no answer), the list is read back first: one that names the gist keeps it. A read that fails leaves it
 * (no list names it, so the next way out deletes it).
 */
async function dropUnlisted(api: GistsApi, port: RepoPort, numbers: string, committed: boolean, guard: ReadGuard | undefined): Promise<void> {
  try {
    if (committed) {
      const read = await readRepoList(port, guard)
      if (read.kind === 'ok' && numbersOf(read.snap.read, read.snap.extra).includes(numbers.toLowerCase())) return
    }
    await removeQuietly(api, numbers)
  } catch {
    /* left for the next way out */
  }
}

/**
 * Writes `files` as THE list of `port`, over any list file there (compare-and-swap; a newer app's file is not touched).
 * `onlyIfMissing` (YAZ-5444, the home vault that lost its list file): a list file that is there again is never replaced
 * (`'there'`): the read and the CAS commit on the read's head make the check and the write one step (YAZ-5462). The
 * new `rev` is above any this device remembers for the repo, so no device that read the old list takes the new one for
 * a stale read. YAZ-5464: an empty repo (no commit) gets its first commit (`commit(null, …)`).
 */
async function replaceRepoList(
  port: RepoPort,
  files: Record<string, string>,
  guard: ReadGuard | undefined,
  sleep: (ms: number) => Promise<void>,
  onlyIfMissing = false,
  extra: Record<string, unknown> = {},
  /** YAZ-5492: set once a commit was sent that got no clear answer (it may have landed). */
  step: { committed: boolean } = { committed: false },
): Promise<RepoListSnapshot | 'newer' | 'there'> {
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
    const sha = head === null || typeof head === 'string' ? head : head.sha
    const rev = Math.max(read.kind === 'ok' ? read.snap.rev : 0, remembered) + 1
    let made: string
    try {
      step.committed = true
      made = await port.commit(sha, LIST_PATH, listFileText(files, extra, rev), LIST_COMMIT)
    } catch (err) {
      if (listErrorCode(err) === 'STALE_HEAD') {
        step.committed = false
        if (attempt >= MAX_STALE_WRITES) throw Object.assign(new Error('The friends list kept changing on GitHub'), { code: 'GITHUB_DOWN' })
        await sleep(backoff(attempt))
        continue
      }
      throw err
    }
    guard?.memory?.saw(repoKey(port), rev, guard.now())
    const parsed = readListFiles(files)
    if (parsed.kind !== 'ok') throw new Error('A new list reads as a list')
    return { sha: made, etag: null, read: parsed, extra, rev }
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
