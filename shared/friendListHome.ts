import {
  INDEX_FILE,
  LIST_VERSION,
  NUMBERS_FILE,
  PARKED,
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
  readAt,
  readNote,
  readRepoList,
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
}

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
  return { id: store.note ?? '', index: read.value, raw: read.raw, etag: snap.etag, createdAt: '', files: read.files, state: read.list, owner, sha: snap.sha, store, extra: snap.extra }
}

/** The repo ports of the device (its vaults on the friends account), or none. */
async function portsOf(api: GistsApi): Promise<readonly RepoPort[]> {
  return (await api.repos?.()) ?? []
}

/**
 * The list as it is on GitHub now (an ETag read of the branch: free when nothing changed). A list that is gone or cannot
 * be read throws (`BrokenList`: nothing is written to it, YAZ-5191); a newer one throws `NewerList`.
 */
export async function latestList(handle: IndexHandle): Promise<IndexHandle> {
  const store = handle.store
  if (store === undefined || handle.sha === undefined) throw new Error('This list is not in a vault yet')
  const head = await store.port.head(handle.etag)
  if (head === 'unchanged' || head.sha === handle.sha) return head === 'unchanged' ? handle : { ...handle, etag: head.etag }
  return fromRead(store, await readAt(store.port, head.sha, head.etag), handle.owner ?? null)
}

function fromRead(store: ListStore, read: RepoListRead, owner: string | null): IndexHandle {
  if (read.kind === 'ok') return handleOf(store, read.snap, owner)
  if (read.kind === 'newer') throw new NewerList()
  throw new BrokenList()
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
    let sha: string
    try {
      sha = await store.port.commit(base.sha!, LIST_PATH, listFileText(files, base.extra ?? {}), opts.message ?? LIST_COMMIT)
    } catch (err) {
      if (listErrorCode(err) === 'STALE_HEAD') {
        if (attempt >= MAX_STALE_WRITES) throw Object.assign(new Error('The friends list kept changing on GitHub'), { code: 'GITHUB_DOWN' })
        await opts.sleep(backoff(attempt))
        base = await latestList(base)
        continue
      }
      throw err
    }
    const read = readListFiles(files)
    return { handle: read.kind !== 'ok' ? { ...base, sha, etag: null } : { ...base, sha, etag: null, index: read.value, raw: read.raw, files: read.files, state: read.list }, result }
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
}

/** The person's list gists (by the head's file name), oldest first, each read. A gist deleted meanwhile is skipped. */
async function listGists(api: GistsApi): Promise<NoteGist[]> {
  const items = (await api.list()).filter((g) => g.files.includes(INDEX_FILE)).sort(older)
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
    out.push({ id: item.id, createdAt: item.createdAt, owner: gist.owner ?? null, read: readNote(fileText(gist, INDEX_FILE)), gist })
  }
  return out
}

/** An old list (a gist list, version 1 or 2) as a read-only handle (YAZ-5350: a list GitHub cut short is not read). */
function legacyHandle(g: NoteGist): IndexFind {
  if (g.gist.truncated === true) return { kind: 'broken', id: g.id }
  const read = readListGist(g.gist)
  if (read.kind === 'newer') return { kind: 'newer', id: g.id }
  if (read.kind !== 'ok') return { kind: 'broken', id: g.id }
  return { kind: 'ok', handle: { id: g.id, index: read.value, raw: read.raw, etag: g.gist.etag, createdAt: g.createdAt, files: read.files, state: read.list, owner: g.owner } }
}

/** The list in the vault the note names, if this device has it. */
async function atHome(api: GistsApi, ports: readonly RepoPort[], home: string, note: string | null, owner: string | null): Promise<IndexFind> {
  // A vault of this device, or (with the same token) the repo the note names, also one this device has not added.
  const port = ports.find((p) => p.repo === home) ?? (api.repo === undefined ? undefined : await api.repo(home))
  if (port === undefined) return { kind: 'elsewhere', home }
  const read = await readRepoList(port)
  if (read.kind === 'ok') return { kind: 'ok', handle: handleOf({ port, note }, read.snap, owner) }
  if (read.kind === 'newer') return { kind: 'newer', id: note ?? '' }
  // The note names this vault and the file is gone (deleted by hand) or broken: nothing is written (YAZ-5191).
  return { kind: 'broken', id: note ?? '' }
}

/** A list file in one of the device's vaults with no note (the note was deleted, or a stop before it was written). */
async function findOrphanList(ports: readonly RepoPort[], owner: string | null): Promise<IndexFind | null> {
  for (const port of ports) {
    let read: RepoListRead
    try {
      read = await readRepoList(port)
    } catch (err) {
      if (listErrorCode(err) === 'NO_LIST_ACCESS') continue
      throw err
    }
    if (read.kind === 'missing') continue
    if (read.kind === 'ok') return { kind: 'ok', handle: handleOf({ port, note: null }, read.snap, owner) }
    return read.kind === 'newer' ? { kind: 'newer', id: '' } : { kind: 'broken', id: '' }
  }
  return null
}

/**
 * Finds the list, and writes NOTHING (the Mac's sender). An old gist list that is not moved yet comes back as a handle
 * with no `store` (read only). `elsewhere`: the list is in a vault this device does not have.
 */
export async function findFriendsIndex(api: GistsApi, _opts?: WriteOptions): Promise<IndexFind> {
  const ports = await portsOf(api)
  const gists = await listGists(api)
  const first = gists[0]
  if (first === undefined) return (await findOrphanList(ports, null)) ?? { kind: 'none' }
  switch (first.read.kind) {
    case 'note':
      return atHome(api, ports, first.read.home, first.id, first.owner)
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
  const ports = await portsOf(api)
  const gists = await listGists(api)
  const first = gists[0]
  if (first !== undefined) {
    if (first.read.kind === 'note') {
      const found = await atHome(api, ports, first.read.home, first.id, first.owner)
      if (found.kind === 'ok') await tidyOldGist(api, first.gist)
      return found
    }
    if (first.read.kind === 'newer') return { kind: 'newer', id: first.id }
    if (first.read.kind !== 'legacy') return { kind: 'broken', id: first.id }
    return moveOldList(api, ports, first, opts, gists.slice(1))
  }
  // No note: a list file already in one of my vaults (adopted), or a new list.
  const orphan = await findOrphanList(ports, null)
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
  const made = await createRepoList(home, newListFiles(seed, numbers.id), LIST_COMMIT, opts.sleep)
  if (made.kind !== 'ok') {
    await removeQuietly(api, numbers.id)
    return made.kind === 'newer' ? { kind: 'newer', id: '' } : { kind: 'broken', id: '' }
  }
  // Another device made the list at the same moment: its numbers gist is the one; mine goes.
  if (made.snap.read.value.stats !== numbers.id) await removeQuietly(api, numbers.id)
  return withNote(api, handleOf({ port: home, note: null }, made.snap, null), ports, opts)
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
    if (first.read.home === home) return { kind: 'ok', handle: { ...handle, id: first.id, owner: first.owner, store: { port: handle.store!.port, note: first.id } } }
    // The oldest note names another vault: that list is the one (a new list that lost the race is left empty).
    return atHome(api, ports, first.read.home, first.id, first.owner)
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
  let target = await findOrphanList(ports, old.owner)
  if (target === null) {
    const home = chooseHome(ports, h.index.vaults)
    if (home === null) return { kind: 'no-vault' }
    const files = await movedFiles(api, h, opts)
    const made = await createRepoList(home, files, LIST_COMMIT, opts.sleep)
    target = made.kind === 'ok' ? { kind: 'ok', handle: handleOf({ port: home, note: old.id }, made.snap, old.owner) } : made.kind === 'newer' ? { kind: 'newer', id: '' } : { kind: 'broken', id: '' }
  }
  if (target.kind !== 'ok') return target
  const port = target.handle.store!.port
  await api.update(old.id, { [INDEX_FILE]: noteText(port.repo) })
  let handle: IndexHandle = { ...target.handle, id: old.id, owner: old.owner, store: { port, note: old.id } }
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
