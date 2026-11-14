import { parseFriendPointer, parseFriendStats, type FriendPointer, type FriendStats } from './friendStats'

/**
 * THE FRIENDS GISTS (YAZ-5082, 4E1; decisions 14 as changed in round 16, 15, 16 and 17 on YAZ-5057). Pure logic that the
 * phone (4E1) and the Mac (4E5) share: the HTTP calls are behind `GistsApi`, so no Node, Electron or DOM import is here.
 *
 * The files of one person, each in a SECRET gist of their own account:
 * - ONE numbers gist (`notecards-stats.json`, `FriendStats`). A send is one update of it, for any number of friends.
 * - ONE pointer gist for each friend and each group (`notecards-pointer.json`, `FriendPointer`). The friend's link is its
 *   ID. It holds the ID of the numbers gist (`stats`), and `reads` and `mark` for that one friend.
 * - ONE friends list (`notecards-friends.json`, `FriendsIndex`). Each device FINDS it by its file name in the person's
 *   own gists (proof 1C: `GET /gists` lists secret gists, with file names), so a reinstall or a second device makes no
 *   second one. The list names the numbers gist (`stats`), so the numbers gist is found through it.
 *
 * Two devices that start at the same time (both find nothing, both make one): each device that made a file looks again
 * after `SETTLE_MS`. When two lists are there, every device keeps the SAME one, the oldest (`created_at`, then the ID),
 * joins the friends of the other into it, and deletes the other with its numbers gist. GitHub has no conditional write
 * for a gist, so this is the rule; a device that still holds a deleted list's ID gets 404 and finds the list again.
 */

export const NUMBERS_FILE = 'notecards-stats.json'
export const INDEX_FILE = 'notecards-friends.json'
export const POINTER_FILE = 'notecards-pointer.json'

/** GitHub advises 1 second between writes (YAZ-5081, "Facts"). */
export const WRITE_GAP_MS = 1000
/** After a device made a file, it looks again this much later for a twin that another device made at the same time. */
export const SETTLE_MS = 5000

/**
 * The failure codes, the same names as the phone client's `GithubErrorCode` (`mobile/src/github/client.ts`), so the
 * phone's `GithubError` passes through as is. The Mac's adapter (4E5) throws `GistError` with these codes.
 * - `READ_ONLY`: a write got 403: the token has no Gists permission (the caller calls `recordGistsRefused`, 3E).
 * - `RATE_LIMITED`: `resetAt` says when to try again. `OFFLINE`, `GITHUB_DOWN`: quiet, try again later.
 */
export type GistErrorCode = 'UNAUTHORIZED' | 'NO_ACCESS' | 'READ_ONLY' | 'NOT_FOUND' | 'RATE_LIMITED' | 'OFFLINE' | 'GITHUB_DOWN' | 'UNEXPECTED'

/** GitHub's `gist_update` count from a `PATCH /gists/{id}` answer (proof 1C: 100 an hour for the account). */
export interface GistRate {
  remaining: number | null
  limit: number | null
  /** ms since 1970. */
  resetAt: number | null
}

export class GistError extends Error {
  constructor(
    readonly code: GistErrorCode,
    message: string,
    readonly resetAt: number | null = null,
    readonly rate: GistRate | null = null,
  ) {
    super(message)
    this.name = 'GistError'
  }
}

export interface GistFile {
  /** Null when GitHub gave no text (a list item). */
  content: string | null
  /** GitHub cuts a file over about 1 MB in this answer. A friends file is never that big: a cut file is unreadable. */
  truncated: boolean
}

export interface GistDoc {
  id: string
  description: string
  files: Record<string, GistFile>
  /** GitHub's ISO times (GitHub's clock, not the sender's). */
  createdAt: string
  updatedAt: string
  etag: string | null
}

export interface GistListItem {
  id: string
  description: string
  /** The file names; a list holds no file text (proof 1C). */
  files: string[]
  createdAt: string
  updatedAt: string
}

/**
 * The gist calls, with the user's own token. The phone builds it on 3E's client (`mobile/src/friends/gistsApi.ts`);
 * the Mac (4E5) builds its own in the main process. Every failure throws an error with a `code` of `GistErrorCode`.
 */
export interface GistsApi {
  /** All of the user's own gists (secret too), every page. */
  list(): Promise<GistListItem[]>
  /** One gist by its ID; with `etag`, an unchanged gist is `'unchanged'` (a free 304 with a token). */
  read(id: string, etag?: string | null): Promise<GistDoc | 'unchanged'>
  /** A new SECRET gist. */
  create(description: string, files: Record<string, string>): Promise<GistDoc>
  /** Changes these files. Counts 1 on `gist_update`; `rate` is GitHub's count after it. */
  update(id: string, files: Record<string, string>): Promise<{ gist: GistDoc | null; rate: GistRate | null }>
  remove(id: string): Promise<void>
}

/** The code of a failed call, or null when `err` is not a gist failure (a bug: the caller lets it throw). */
export function gistErrorCode(err: unknown): GistErrorCode | null {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  const known: readonly string[] = ['UNAUTHORIZED', 'NO_ACCESS', 'READ_ONLY', 'NOT_FOUND', 'RATE_LIMITED', 'OFFLINE', 'GITHUB_DOWN', 'UNEXPECTED']
  return typeof code === 'string' && known.includes(code) ? (code as GistErrorCode) : null
}
/** `resetAt` of a rate-limit failure (ms), or null. */
export const gistErrorResetAt = (err: unknown): number | null => {
  const at = typeof err === 'object' && err !== null ? (err as { resetAt?: unknown }).resetAt : null
  return typeof at === 'number' && Number.isFinite(at) ? at : null
}
/** GitHub's `gist_update` count on a failure, if the error holds it (the phone's `rateLimit`, the Mac's `rate`). */
export function gistErrorRate(err: unknown): GistRate | null {
  if (typeof err !== 'object' || err === null) return null
  const e = err as { rate?: GistRate | null; rateLimit?: { resource: string | null; remaining: number | null; limit: number | null; resetAt: number | null } | null }
  if (e.rate) return e.rate
  if (e.rateLimit && e.rateLimit.resource === 'gist_update') return { remaining: e.rateLimit.remaining, limit: e.rateLimit.limit, resetAt: e.rateLimit.resetAt }
  return null
}

/** A gist ID as GitHub gives it: hex. A friend's pointer is untrusted, so each ID is checked before a call. */
export const GIST_ID_RE = /^[0-9a-f]{1,64}$/i
export const isGistId = (id: unknown): id is string => typeof id === 'string' && GIST_ID_RE.test(id)

// ---------------------------------------------------------------------------------------------------------------------
// Reading a file that a newer app may have written (round 10, item 17: the `v` field and unknown fields are kept).

/** A friends file as read: the known fields (`value`) and the whole object (`raw`, to keep unknown fields on a write). */
export type FileState<T> = { kind: 'ok'; value: T; raw: Record<string, unknown> } | { kind: 'newer' } | { kind: 'unreadable'; why: string }

/** `text` with a `v` above 1 (a newer app wrote it): `newer`. Else the file's own reader. Never throws. */
function versioned<T>(text: string | null | undefined, read: (text: string) => { ok: true; value: T } | { ok: false; why: string }): FileState<T> {
  if (typeof text !== 'string') return { kind: 'unreadable', why: 'the file is missing' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'unreadable', why: 'the file is not JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'unreadable', why: 'the file is not an object' }
  const v = (raw as { v?: unknown }).v
  if (typeof v === 'number' && Number.isInteger(v) && v > 1) return { kind: 'newer' }
  const r = read(text)
  return r.ok ? { kind: 'ok', value: r.value, raw: raw as Record<string, unknown> } : { kind: 'unreadable', why: r.why }
}

export const readStatsFile = (text: string | null | undefined): FileState<FriendStats> => versioned(text, parseFriendStats)
export const readPointerFile = (text: string | null | undefined): FileState<FriendPointer> => versioned(text, parseFriendPointer)

/** The one text of `file` in a gist, or null when it is missing or cut short. */
const fileText = (gist: GistDoc, file: string): string | null => {
  const f = gist.files[file]
  return f === undefined || f.truncated || typeof f.content !== 'string' ? null : f.content
}

// ---------------------------------------------------------------------------------------------------------------------
// The friends list (decision 15; round 16).

/**
 * The person's own list, in ONE secret gist (`notecards-friends.json`). 4E2 (friends) and 4E3 (groups) change it.
 * - `vaults`: the vaults that count (round 12, item 3), as `owner/name` in lower case (a vault is the whole repo,
 *   round 16), so the phone and the Mac name a vault the same way.
 * - `stats`: the ID of the numbers gist (round 16). Null only before the first numbers gist is made.
 * - `mine`: the pointer gist that this person writes for that friend or group. `theirs`: the friend's pointer.
 */
export interface FriendsIndex {
  v: 1
  nickname: string | null
  vaults: string[]
  stats: string | null
  friends: { name: string; theirs: string; mine: string }[]
  groups: { name: string; group: string; mine: string; admin: boolean }[]
}

const MAX_ENTRIES = 1000
const MAX_NAME = 200

function parseIndex(text: string): { ok: true; value: FriendsIndex } | { ok: false; why: string } {
  if (text.length > 256 * 1024) return { ok: false, why: 'the file is too large' }
  const o = JSON.parse(text) as Record<string, unknown>
  if (o.v !== 1) return { ok: false, why: 'the file has another version' }
  const name = (v: unknown) => typeof v === 'string' && v.length <= MAX_NAME
  if (!(o.nickname === null || o.nickname === undefined || name(o.nickname))) return { ok: false, why: 'nickname is not a text' }
  if (!Array.isArray(o.vaults) || o.vaults.length > MAX_ENTRIES || !o.vaults.every(name)) return { ok: false, why: 'vaults is not a list of names' }
  if (!(o.stats === null || o.stats === undefined || isGistId(o.stats))) return { ok: false, why: 'stats is not a gist ID' }
  const friends = o.friends ?? []
  const groups = o.groups ?? []
  if (!Array.isArray(friends) || friends.length > MAX_ENTRIES) return { ok: false, why: 'friends is not a list' }
  if (!Array.isArray(groups) || groups.length > MAX_ENTRIES) return { ok: false, why: 'groups is not a list' }
  const entry = (e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e)
  for (const f of friends) if (!entry(f) || !name(f.name) || !isGistId(f.theirs) || !isGistId(f.mine)) return { ok: false, why: 'a friend is not readable' }
  for (const g of groups) if (!entry(g) || !name(g.name) || !isGistId(g.group) || !isGistId(g.mine) || typeof g.admin !== 'boolean') return { ok: false, why: 'a group is not readable' }
  return {
    ok: true,
    value: {
      v: 1,
      nickname: (o.nickname as string | null | undefined) ?? null,
      vaults: (o.vaults as string[]).map((v) => v.toLowerCase()),
      stats: (o.stats as string | null | undefined) ?? null,
      friends: (friends as Record<string, unknown>[]).map((f) => ({ name: f.name as string, theirs: f.theirs as string, mine: f.mine as string })),
      groups: (groups as Record<string, unknown>[]).map((g) => ({ name: g.name as string, group: g.group as string, mine: g.mine as string, admin: g.admin as boolean })),
    },
  }
}

/** The friends list from its text: known fields, plus the whole object to keep what a newer app added. Never throws. */
export function parseFriendsIndex(text: string | null | undefined): FileState<FriendsIndex> {
  return versioned(text, (t) => {
    try {
      return parseIndex(t)
    } catch {
      return { ok: false, why: 'the file cannot be read' }
    }
  })
}

/** The pointers that this person writes: one for each friend and each group. */
export const pointersOf = (index: FriendsIndex): string[] => [...index.friends.map((f) => f.mine), ...index.groups.map((g) => g.mine)]

/** The text of a list to write: the known fields over the fields this app does not know; each entry keeps its own. */
export function indexText(index: FriendsIndex, raw: Record<string, unknown> = {}): string {
  const rawEntries = (key: 'friends' | 'groups') => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []).filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
  const keep = <E extends { mine: string }>(key: 'friends' | 'groups', entries: E[]) => entries.map((e) => ({ ...(rawEntries(key).find((r) => r.mine === e.mine) ?? {}), ...e }))
  return JSON.stringify({ ...raw, ...index, friends: keep('friends', index.friends), groups: keep('groups', index.groups) })
}

/** A list found or made: its gist, its known fields, the whole object, and the ETag of the read. */
export interface IndexHandle {
  id: string
  index: FriendsIndex
  raw: Record<string, unknown>
  etag: string | null
  createdAt: string
}

export type IndexFind = { kind: 'none' } | { kind: 'newer'; id: string } | { kind: 'ok'; handle: IndexHandle }

/** How a write is labelled and spaced. `describe` gives the gist's description (the live test starts it "notecards-test"). */
export interface WriteOptions {
  describe: (kind: 'numbers' | 'index' | 'pointer') => string
  sleep: (ms: number) => Promise<void>
  now?: () => number
}

/** Default descriptions: what a person sees in their own gist list on GitHub. */
export const DESCRIPTIONS: Record<'numbers' | 'index' | 'pointer', string> = {
  numbers: 'Notecards: my review numbers for friends (no card text)',
  index: 'Notecards: my friends list',
  pointer: 'Notecards: a friend link',
}

/** Spaces the writes of one task about 1 second apart (`WRITE_GAP_MS`). */
function writer(opts: WriteOptions) {
  let wrote = false
  return async <T>(write: () => Promise<T>): Promise<T> => {
    if (wrote) await opts.sleep(WRITE_GAP_MS)
    wrote = true
    return write()
  }
}

const older = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Deletes a gist; a gist already gone is fine (another device deleted it first). */
async function removeQuietly(api: GistsApi, id: string): Promise<void> {
  try {
    await api.remove(id)
  } catch (err) {
    if (gistErrorCode(err) !== 'NOT_FOUND') throw err
  }
}

async function readIndex(api: GistsApi, id: string, createdAt: string): Promise<IndexFind | null> {
  let gist: GistDoc | 'unchanged'
  try {
    gist = await api.read(id)
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return null
    throw err
  }
  if (gist === 'unchanged') throw new Error('a read with no ETag cannot be unchanged')
  const state = parseFriendsIndex(fileText(gist, INDEX_FILE))
  if (state.kind === 'newer') return { kind: 'newer', id }
  // A broken list is read as an empty one, and its unknown fields stay; the next write repairs it.
  const index: FriendsIndex = state.kind === 'ok' ? state.value : { v: 1, nickname: null, vaults: [], stats: null, friends: [], groups: [] }
  return { kind: 'ok', handle: { id, index, raw: state.kind === 'ok' ? state.raw : {}, etag: gist.etag, createdAt } }
}

/** Joins `other` into `keep`: the friends and groups of both (by pointer), the vaults of both, a name and stats if missing. */
function joinIndex(keep: FriendsIndex, other: FriendsIndex): FriendsIndex {
  return {
    ...keep,
    nickname: keep.nickname ?? other.nickname,
    vaults: [...new Set([...keep.vaults, ...other.vaults])],
    stats: keep.stats ?? other.stats,
    friends: [...keep.friends, ...other.friends.filter((f) => !keep.friends.some((k) => k.mine === f.mine))],
    groups: [...keep.groups, ...other.groups.filter((g) => !keep.groups.some((k) => k.mine === g.mine))],
  }
}

/**
 * Finds the list by its file name in the person's own gists. When there are two or more (two devices made one at the
 * same time, or an old stop halfway), it keeps the oldest, joins the others into it, points their friends' pointers at
 * the kept numbers gist, and deletes the others and their numbers gists. `none`: the person has no list (no friend yet).
 */
export async function findFriendsIndex(api: GistsApi, opts: WriteOptions): Promise<IndexFind> {
  const all = (await api.list()).filter((g) => g.files.includes(INDEX_FILE)).sort(older)
  if (all.length === 0) return { kind: 'none' }
  const write = writer(opts)
  const [first, ...others] = all
  const kept = await readIndex(api, first.id, first.createdAt)
  if (kept === null) return findFriendsIndex(api, opts) // deleted by another device just now
  if (kept.kind !== 'ok') return kept
  let handle = kept.handle
  for (const other of others) {
    const read = await readIndex(api, other.id, other.createdAt)
    if (read === null) continue
    if (read.kind === 'newer') return { kind: 'newer', id: other.id }
    if (read.kind !== 'ok') continue
    const joined = joinIndex(handle.index, read.handle.index)
    if (indexText(joined, handle.raw) !== indexText(handle.index, handle.raw)) handle = await write(() => writeFriendsIndex(api, handle, joined))
    const lostStats = read.handle.index.stats
    if (lostStats !== null && lostStats !== handle.index.stats) {
      // The other list's friends read the other numbers gist: point them at the kept one, then delete it.
      if (handle.index.stats !== null) await relinkPointers(api, pointersOf(read.handle.index), handle.index.stats, opts)
      await write(() => removeQuietly(api, lostStats))
    }
    await write(() => removeQuietly(api, other.id))
  }
  return { kind: 'ok', handle }
}

/** Writes the list (the known fields over the unknown ones). GitHub has no conditional write: read it just before. */
export async function writeFriendsIndex(api: GistsApi, handle: IndexHandle, next: FriendsIndex): Promise<IndexHandle> {
  const { gist } = await api.update(handle.id, { [INDEX_FILE]: indexText(next, handle.raw) })
  return { ...handle, index: next, raw: JSON.parse(indexText(next, handle.raw)) as Record<string, unknown>, etag: gist?.etag ?? null }
}

/** An empty but valid numbers file: a friend who reads it before the first send sees zeros, not an error. */
export function emptyNumbers(now: number): FriendStats {
  const zero = { cards: 0, inReview: 0, newLeft: 0, mature: 0, dueLeft: 0, addedThisWeek: 0, streak: 0, bestStreak: 0, bestDay: 0, bestWeek: 0 }
  return { v: 1, login: '', name: '', avatar: '', days: [], totals: zero, at: new Date(now).toISOString() }
}

export type EnsureResult = { kind: 'ok'; handle: IndexHandle } | { kind: 'newer' }

/**
 * Make or find the person's friends files: ONE list and ONE numbers gist (round 16). 4E2 calls it before the first
 * friend is added; the sender only finds (it never makes files for a person with no friend, decision 22).
 * `seed` fills a NEW list only; a found list keeps its own vaults and nickname.
 */
export async function ensureFriendsFiles(api: GistsApi, seed: { vaults: string[]; nickname: string | null; numbers?: FriendStats }, opts: WriteOptions): Promise<EnsureResult> {
  const now = opts.now ?? Date.now
  const write = writer(opts)
  const numbersText = JSON.stringify(seed.numbers ?? emptyNumbers(now()))
  let found = await findFriendsIndex(api, opts)
  if (found.kind === 'newer') return { kind: 'newer' }
  if (found.kind === 'none') {
    // Numbers first, then the list that names it: the list is never without its numbers gist.
    const numbers = await write(() => api.create(opts.describe('numbers'), { [NUMBERS_FILE]: numbersText }))
    const index: FriendsIndex = { v: 1, nickname: seed.nickname, vaults: seed.vaults.map((v) => v.toLowerCase()), stats: numbers.id, friends: [], groups: [] }
    const made = await write(() => api.create(opts.describe('index'), { [INDEX_FILE]: indexText(index) }))
    // Look again after a while: another device may have made its own at the same time. Both keep the oldest.
    await opts.sleep(SETTLE_MS)
    found = await findFriendsIndex(api, opts)
    if (found.kind === 'newer') return { kind: 'newer' }
    if (found.kind === 'none') throw new Error('the friends list was deleted while it was made')
    if (found.handle.id !== made.id && found.handle.index.stats !== numbers.id) await write(() => removeQuietly(api, numbers.id))
  }
  let handle = found.handle
  if (handle.index.stats === null) handle = await ensureNumbersGist(api, handle, numbersText, opts)
  return { kind: 'ok', handle }
}

/**
 * A list with no numbers gist (an older list, or a stop halfway): finds a numbers gist by its file name (the oldest),
 * or makes one, and writes its ID into the list. Other numbers gists that no list names are left alone: 4E2 owns them.
 */
async function ensureNumbersGist(api: GistsApi, handle: IndexHandle, numbersText: string, opts: WriteOptions): Promise<IndexHandle> {
  const write = writer(opts)
  const existing = (await api.list()).filter((g) => g.files.includes(NUMBERS_FILE)).sort(older)[0]
  const id = existing?.id ?? (await write(() => api.create(opts.describe('numbers'), { [NUMBERS_FILE]: numbersText }))).id
  const fresh = await readIndex(api, handle.id, handle.createdAt)
  const base = fresh?.kind === 'ok' ? fresh.handle : handle
  if (base.index.stats !== null) return base
  return write(() => writeFriendsIndex(api, base, { ...base.index, stats: id }))
}

/** A new pointer gist for a friend or a group (4E2, 4E3): `{ v: 1, stats, reads? }`. Returns its ID, the link. */
export async function makePointer(api: GistsApi, stats: string, opts: WriteOptions, more: { reads?: string } = {}): Promise<string> {
  const pointer: FriendPointer = { v: 1, stats, ...(more.reads !== undefined && { reads: more.reads }) }
  return (await api.create(opts.describe('pointer'), { [POINTER_FILE]: JSON.stringify(pointer) })).id
}

/**
 * Writes `stats` into each pointer that names another numbers gist. Each pointer keeps `reads`, `mark` and the fields
 * this app does not know. A pointer that is gone (404) is skipped and named in `gone`; a newer pointer is left alone.
 */
export async function relinkPointers(api: GistsApi, pointers: readonly string[], stats: string, opts: WriteOptions): Promise<{ updated: string[]; gone: string[] }> {
  const write = writer(opts)
  const updated: string[] = []
  const gone: string[] = []
  for (const id of pointers) {
    let gist: GistDoc | 'unchanged'
    try {
      gist = await api.read(id)
    } catch (err) {
      if (gistErrorCode(err) === 'NOT_FOUND') {
        gone.push(id)
        continue
      }
      throw err
    }
    if (gist === 'unchanged') continue
    const state = readPointerFile(fileText(gist, POINTER_FILE))
    if (state.kind === 'newer') continue
    if (state.kind === 'ok' && state.value.stats === stats) continue
    const raw = state.kind === 'ok' ? state.raw : { v: 1 }
    await write(() => api.update(id, { [POINTER_FILE]: JSON.stringify({ ...raw, v: 1, stats }) }))
    updated.push(id)
  }
  return { updated, gone }
}

/**
 * A NEW numbers gist (round 16): when the old one was deleted on GitHub, and for a remove (4E2: delete that friend's
 * pointer and take it out of the list first, then call this). In this order, so a stop halfway loses nothing:
 * 1. make the new numbers gist with `numbersText`; 2. write its ID into every pointer of the list; 3. write it into the
 * list; 4. delete the old numbers gist. It costs one `gist_update` for each pointer and one for the list.
 */
export async function replaceNumbersGist(api: GistsApi, handle: IndexHandle, numbersText: string, opts: WriteOptions): Promise<{ handle: IndexHandle; pointers: { updated: string[]; gone: string[] }; old: string | null }> {
  const write = writer(opts)
  const old = handle.index.stats
  const made = await write(() => api.create(opts.describe('numbers'), { [NUMBERS_FILE]: numbersText }))
  await opts.sleep(WRITE_GAP_MS)
  const pointers = await relinkPointers(api, pointersOf(handle.index), made.id, opts)
  await opts.sleep(WRITE_GAP_MS)
  const next = await writeFriendsIndex(api, handle, { ...handle.index, stats: made.id })
  if (old !== null) await write(() => removeQuietly(api, old))
  return { handle: next, pointers, old }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a friend (4E2 builds the list on it; 4E4 shows it).

/**
 * A friend's numbers as read through the friend's pointer, with the reader's own token (proof 1C: then a 304 is free).
 * - `ok`: `updatedAt` is GitHub's time of the last change of the numbers gist (ms), not the friend's clock.
 *   `stale` is set when this read failed and the numbers are the last ones read.
 * - `gone`: the pointer is deleted: the friend removed you (round 12, item 6: "No longer shares with you").
 * - `no-numbers`: the pointer names a numbers gist that is gone (the friend is between two numbers gists).
 * - `newer-app`: a file has a `v` this app does not know: "needs a newer app".
 * - `unreadable`: a broken file, or a link that is not a gist ID.
 * - `offline`, `rate-limited`: no answer and nothing read before.
 */
export type FriendRead =
  | { kind: 'ok'; stats: FriendStats; pointer: FriendPointer; updatedAt: number | null; stale?: 'offline' | 'rate-limited' }
  | { kind: 'gone' }
  | { kind: 'no-numbers' }
  | { kind: 'newer-app' }
  | { kind: 'unreadable'; why: string }
  | { kind: 'offline' }
  | { kind: 'rate-limited'; retryAt: number | null }

/** What the reader keeps between reads: each gist's last answer by ID (for the ETag), and each friend's last result. */
export type FriendReadCache = Map<string, { etag: string | null; gist: GistDoc } | { result: FriendRead }>

async function readCached(api: GistsApi, id: string, cache: FriendReadCache): Promise<GistDoc> {
  const before = cache.get(id)
  const kept = before !== undefined && 'gist' in before ? before : undefined
  const answer = await api.read(id, kept?.etag ?? null)
  if (answer === 'unchanged') {
    if (kept === undefined) throw new Error('unchanged with no copy')
    return kept.gist
  }
  cache.set(id, { etag: answer.etag, gist: answer })
  return answer
}

/** Reads a friend: the pointer, then the numbers. Never throws for GitHub's answers or the files' content. */
export async function readFriend(api: GistsApi, pointerId: string, cache: FriendReadCache): Promise<FriendRead> {
  const resultKey = `friend:${pointerId}`
  const last = cache.get(resultKey)
  const lastOk = last !== undefined && 'result' in last && last.result.kind === 'ok' ? last.result : null
  const done = (result: FriendRead): FriendRead => {
    cache.set(resultKey, { result })
    return result
  }
  if (!isGistId(pointerId)) return { kind: 'unreadable', why: 'the link is not a gist ID' }
  try {
    let pointerGist: GistDoc
    try {
      pointerGist = await readCached(api, pointerId, cache)
    } catch (err) {
      if (gistErrorCode(err) === 'NOT_FOUND') return done({ kind: 'gone' })
      throw err
    }
    const pointer = readPointerFile(fileText(pointerGist, POINTER_FILE))
    if (pointer.kind === 'newer') return done({ kind: 'newer-app' })
    if (pointer.kind === 'unreadable') return done({ kind: 'unreadable', why: `pointer: ${pointer.why}` })
    let statsGist: GistDoc
    try {
      statsGist = await readCached(api, pointer.value.stats, cache)
    } catch (err) {
      if (gistErrorCode(err) === 'NOT_FOUND') return done({ kind: 'no-numbers' })
      throw err
    }
    const stats = readStatsFile(fileText(statsGist, NUMBERS_FILE))
    if (stats.kind === 'newer') return done({ kind: 'newer-app' })
    if (stats.kind === 'unreadable') return done({ kind: 'unreadable', why: `numbers: ${stats.why}` })
    const updated = Date.parse(statsGist.updatedAt)
    return done({ kind: 'ok', stats: stats.value, pointer: pointer.value, updatedAt: Number.isFinite(updated) ? updated : Date.parse(stats.value.at) })
  } catch (err) {
    const code = gistErrorCode(err)
    if (code === null) throw err
    const quiet = code === 'RATE_LIMITED' ? 'rate-limited' : 'offline'
    if (lastOk !== null) return { ...lastOk, stale: quiet }
    return code === 'RATE_LIMITED' ? { kind: 'rate-limited', retryAt: gistErrorResetAt(err) } : { kind: 'offline' }
  }
}

/** How long ago the numbers changed (ms), never below 0: a reader clock that is behind GitHub's shows "now". */
export function updatedAgo(updatedAt: number | null, now: number): number | null {
  if (updatedAt === null || !Number.isFinite(updatedAt)) return null
  return Math.max(0, now - updatedAt)
}

/** "now", "5m ago", "2h ago", "3d ago", or "no update yet" (round 10, item 12). The look is 4E4's. */
export function agoLabel(ago: number | null): string {
  if (ago === null) return 'no update yet'
  const minutes = Math.floor(ago / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
