import { isTimeZone, parseFriendPointer, parseFriendStats, type FriendPointer, type FriendStats } from './friendStatsFormat'
import type { ListStore } from './friendListHome'
import type { ListMemory, RepoPort } from './friendListStore'

/**
 * THE FRIENDS GISTS (YAZ-5082, 4E1; decisions 14 as changed in round 16, 15, 16 and 17 on YAZ-5057). Pure logic that the
 * phone (4E1) and the Mac (4E5) share: the HTTP calls are behind `GistsApi`, so no Node, Electron or DOM import is here.
 *
 * The files of one person, each in a SECRET gist of their own account:
 * - ONE numbers gist (`notecards-stats.json`, `FriendStats`). A send is one update of it, for any number of friends.
 * - ONE pointer gist for each friend and each group (`notecards-pointer.json`, `FriendPointer`). The friend's link is its
 *   ID. It holds the ID of the numbers gist (`stats`), and `reads` and `mark` for that one friend.
 * - YAZ-5083: the person's own friends LIST is in one of their vault repos (`.yaseendocs/friends.json`, written with
 *   compare-and-swap: `friendListStore.ts`, `friendListHome.ts`). The gist `notecards-friends.json` of decision 15 is
 *   now a small note that names that vault. An old list (version 1 or 2, in that gist; never shipped) is `broken`:
 *   it is not read, and nothing is written to it.
 * Two devices that make a note at the same time each look again after `SETTLE_MS`: every device keeps the oldest.
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
  /**
   * YAZ-5239: the login of the gist's owner, as GitHub gives it (`owner.login`): the only login the app trusts for a
   * person. Optional: undefined when the adapter does not give it.
   */
  owner?: string | null
  /**
   * YAZ-5350: GitHub's `truncated` of the GIST: it gave only the first 300 files. A list read from such an answer is
   * never read as whole ("needs repair").
   */
  truncated?: boolean
}

export interface GistListItem {
  id: string
  description: string
  /** The file names; a list holds no file text (proof 1C). */
  files: string[]
  createdAt: string
  updatedAt: string
}

/** A gist as GitHub's JSON gives it (`GET /gists`, `GET /gists/{id}`, a write's answer). */
interface RawGist {
  id: string
  owner?: { login?: unknown } | null
  description: string | null
  created_at: string
  updated_at: string
  files: Record<string, { content?: unknown; truncated?: unknown } | null>
  truncated?: unknown
}

/** One gist of GitHub's answer, as the shared logic reads it: the phone's and the Mac's gist calls both read it so. */
export function gistDoc(data: unknown, etag: string | null): GistDoc {
  const g = data as RawGist
  return {
    id: g.id,
    // YAZ-5239: GitHub's own owner of the gist; the only login the groups trust.
    owner: typeof g.owner?.login === 'string' ? g.owner.login : null,
    description: g.description ?? '',
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    etag,
    // YAZ-5350: GitHub's own `truncated` of the gist (it gave only its first 300 files).
    ...(g.truncated === true && { truncated: true }),
    files: Object.fromEntries(
      Object.entries(g.files ?? {}).map(([name, f]) => [name, { content: f !== null && typeof f.content === 'string' ? f.content : null, truncated: f?.truncated === true }]),
    ),
  }
}

/** The gists of one page of `GET /gists` (anything that is not a gist is skipped): names only, no text (proof 1C). */
export function gistListItems(data: unknown): GistListItem[] {
  const raw = Array.isArray(data) ? (data as RawGist[]).filter((g) => g !== null && typeof g === 'object' && typeof g.id === 'string') : []
  return raw.map((g) => ({ id: g.id, description: g.description ?? '', files: Object.keys(g.files ?? {}), createdAt: g.created_at, updatedAt: g.updated_at }))
}

/** A write's files: a file's new text, or `null`: GitHub deletes that one file (YAZ-5312). */
export const gistFilesBody = (files: Record<string, string | null>) => Object.fromEntries(Object.entries(files).map(([name, content]) => [name, content === null ? null : { content }]))

/**
 * The gist calls, with the user's own token. The phone builds it on 3E's client (`mobile/src/friends/gistsApi.ts`);
 * the Mac (4E5) builds its own in the main process. Every failure throws an error with a `code` of `GistErrorCode`.
 */
/**
 * YAZ-5516 (N9-1): a write that GitHub refused with 409 (another write of the gist at that moment) is never sent again
 * as it was: that other write may be newer. An adapter that sends it again reads the gist again first and asks this for
 * the change worked out again on what is there now; `null`: nothing to write any more (`superseded`).
 */
export type GistRedo = (fresh: GistDoc) => Record<string, string | null> | null

export interface GistsApi {
  /** All of the user's own gists (secret too), every page. */
  list(): Promise<GistListItem[]>
  /**
   * YAZ-5464 (nit): EVERY gist of mine, page by page, up to `maxPages` pages of 100 (`list` reads the newest 1,000 only).
   * More than that throws an error with the code `TOO_MANY_GISTS`: a caller that must see each gist (the way out) then
   * changes nothing. Optional: an adapter without it gives every gist in `list`.
   */
  listAll?(maxPages: number): Promise<GistListItem[]>
  /** One gist by its ID; with `etag`, an unchanged gist is `'unchanged'` (a free 304 with a token). */
  read(id: string, etag?: string | null): Promise<GistDoc | 'unchanged'>
  /** A new SECRET gist. */
  create(description: string, files: Record<string, string>): Promise<GistDoc>
  /**
   * Changes these files, and ONLY these files: GitHub keeps each file the call does not name (YAZ-5312; proved live).
   * `null` deletes that one file. Counts 1 on `gist_update`; `rate` is GitHub's count after it.
   */
  update(id: string, files: Record<string, string | null>, again?: GistRedo): Promise<{ gist: GistDoc | null; rate: GistRate | null; superseded?: true }>
  remove(id: string): Promise<void>
  /**
   * YAZ-5238: GitHub's time (ms) at its last answer, or null when it is not known: the `Date` header, or else a lower
   * bound from the exposed `x-ratelimit-reset` of the core count (the reset is at most one hour after "now"). Never
   * the device clock. Optional: an adapter without it makes the clean-up sweep delete nothing.
   */
  serverTime?(): number | null
  /**
   * YAZ-5083 (the list in the vault repo): the repos of this device's vaults on the friends account, in the order to
   * choose a home vault (the friends account's vault first). The list file lives in one of them. Absent or empty: this
   * device has no vault for the list.
   */
  repos?(): Promise<readonly RepoPort[]>
  /**
   * YAZ-5083: the port of any repo of the account by name (the vault the note names), also one this device has not
   * added: on its own vault's branch when it has it, else on the repo's default branch. A token with no access to it
   * fails the first call with `NO_LIST_ACCESS`.
   */
  repo?(full: string): Promise<RepoPort>
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

/**
 * YAZ-5516 (N9-1): a pointer write worked out again after a 409. `base` is the pointer as read before the write, `ours`
 * what the write wanted. Each field the write changes goes onto the pointer read NOW, but only where that field is still
 * as `base` had it: a field the other write changed stays (it may name a NEWER generation; the next settle or round looks
 * again with the list read again). `held` is a set: ours are added. `null`: nothing left to write.
 */
export function pointerRedo(base: Record<string, unknown>, ours: Record<string, unknown>): GistRedo {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  return (fresh) => {
    const now = readPointerFile(fileText(fresh, POINTER_FILE))
    if (now.kind !== 'ok') return null
    const next: Record<string, unknown> = { ...now.raw }
    for (const key of new Set([...Object.keys(base), ...Object.keys(ours)])) {
      if (same(ours[key], base[key])) continue
      if (key === 'held' && Array.isArray(ours.held)) next.held = [...new Set([...(Array.isArray(now.raw.held) ? now.raw.held : []), ...ours.held])]
      else if (same(now.raw[key], base[key])) {
        if (ours[key] === undefined) delete next[key]
        else next[key] = ours[key]
      }
    }
    return same(next, now.raw) ? null : { [POINTER_FILE]: JSON.stringify(next) }
  }
}

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
  /** `paired` (YAZ-5274): the friend has read my pointer for them at least once (both added each other). */
  friends: { name: string; theirs: string; mine: string; paired?: true; /** YAZ-5353: GitHub's owner of `theirs` when it was added (one entry for one friend). */ login?: string }[]
  /** `joined` (4E3): this person has seen their pointer in the group file at least once (so "not in it" now means removed). */
  groups: { name: string; group: string; mine: string; admin: boolean; joined?: true; /** YAZ-5240: when I asked to join (ISO). */ asked?: string }[]
  /**
   * 4E2 (YAZ-5083): the links this person shared that no friend has used yet ("Share my link" made a pointer; the
   * friend's link has not been pasted). Each is a pointer like `mine`, so a remove updates it too. Absent: none.
   */
  shared?: { mine: string; at: string }[]
  /**
   * YAZ-5251: the person's HOME time zone (IANA, `America/New_York`). Each device counts the days of the numbers in it,
   * so one answer is on one day. Absent: not set yet (the first device that sends writes its own zone).
   */
  zone?: string
}

const MAX_NAME = 200

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A name as the screens show it: a text, cut to MAX_NAME letters; a value that is not a text shows as "Friend". */
const shownName = (v: unknown): string => (typeof v === 'string' ? v.slice(0, MAX_NAME) : 'Friend')
const shownNickname = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, MAX_NAME) : null)

/** A friend entry this app can read: both pointer IDs are gist IDs. Else it stays in the file as it is (YAZ-5191). */
const friendOk = (e: unknown): e is Record<string, unknown> => isObject(e) && isGistId(e.theirs) && isGistId(e.mine)
const groupOk = (e: unknown): e is Record<string, unknown> => isObject(e) && isGistId(e.group) && isGistId(e.mine)
const sharedOk = (e: unknown): e is Record<string, unknown> => isObject(e) && isGistId(e.mine) && typeof e.at === 'string' && e.at.length <= 40
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * The list, read ENTRY BY ENTRY (YAZ-5191). One entry this app cannot read does not drop the others: it is left out of
 * `value` and stays in the file on each write (`indexText`). A name that is too long is cut for the screens, never a
 * reason to refuse the file; the file keeps its own name. Only a file that is not a JSON object with `v: 1` (or one
 * over 256 KB) is unreadable: then the app writes nothing to it ("your friends list needs a repair").
 */
function parseIndex(text: string): { ok: true; value: FriendsIndex } | { ok: false; why: string } {
  if (text.length > 256 * 1024) return { ok: false, why: 'the file is too large' }
  const o = JSON.parse(text) as unknown
  if (!isObject(o)) return { ok: false, why: 'the file is not an object' }
  if (o.v !== 1) return { ok: false, why: 'the file has another version' }
  // YAZ-5241: a field that is there with the wrong shape makes the whole file unreadable ("needs repair"). Reading it
  // as an empty value would let the next write save that empty value over the real one.
  for (const key of ['vaults', 'friends', 'groups', 'shared'] as const) if (key in o && !Array.isArray(o[key])) return { ok: false, why: `${key} is not a list` }
  if (o.stats !== undefined && o.stats !== null && !isGistId(o.stats)) return { ok: false, why: 'stats is not a gist ID' }
  if (o.nickname !== undefined && o.nickname !== null && typeof o.nickname !== 'string') return { ok: false, why: 'nickname is not a text' }
  return {
    ok: true,
    value: {
      v: 1,
      nickname: shownNickname(o.nickname),
      vaults: list(o.vaults)
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.toLowerCase()),
      stats: isGistId(o.stats) ? o.stats : null,
      friends: list(o.friends)
        .filter(friendOk)
        .map((f) => ({ name: shownName(f.name), theirs: f.theirs as string, mine: f.mine as string, ...(f.paired === true && { paired: true as const }) })),
      groups: list(o.groups)
        .filter(groupOk)
        .map((g) => ({ name: shownName(g.name), group: g.group as string, mine: g.mine as string, admin: g.admin === true, ...(g.joined === true && { joined: true as const }), ...(typeof g.asked === 'string' && g.asked.length <= 40 && { asked: g.asked }) })),
      ...(o.shared !== undefined && { shared: list(o.shared).filter(sharedOk).map((x) => ({ mine: x.mine as string, at: x.at as string })) }),
      // A zone this runtime does not know reads as none; the file keeps its own (the head is written with its raw fields).
      ...(isTimeZone(o.zone) && { zone: o.zone }),
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

/** The words for a list that cannot be read (YAZ-5191; round 13, item 4: say what is wrong and what to do). */
export const LIST_NEEDS_REPAIR = 'Your friends list on GitHub cannot be read, so the app changes nothing in it. Open the file .yaseendocs/friends.json in your vault on GitHub (or, from an older app, your gist notecards-friends.json) and fix it.'

/** The pointers that this person writes: one for each friend and each group, and each shared link not used yet (4E2). */
export const pointersOf = (index: FriendsIndex): string[] => [...index.friends.map((f) => f.mine), ...index.groups.map((g) => g.mine), ...(index.shared ?? []).map((x) => x.mine)]

// ---------------------------------------------------------------------------------------------------------------------
// The list gist, version 2 (YAZ-5312): one file for each entry, inside the SAME gist (decisions 14 and 15 stand).
//
// GitHub has no conditional write for a gist, and a `PATCH` changes only the files it names. So a write that sends
// the WHOLE list from a copy read a moment before can undo another device's change. Version 2 sends only what changed:
// - `notecards-friends.json` (the head): `{ v: 2, nickname, vaults }`. A version 1 head is read as before (its
//   `friends`, `groups`, `shared`, `stats` and `rekey` stay readable, and are kept as they are).
// - `notecards-friends.f.<mine>.json` a friend `{ name, theirs, paired? }`; `…g.<mine>.json` a group; `…s.<mine>.json`
//   a shared link `{ at }`.
// - `notecards-friends.x.<mine>.json` a TOMBSTONE `{ at, kinds, rekey, name?, drop? }`: the entry with that pointer is
//   gone for good. A stale write of the entry file cannot bring it back. `rekey: true`: a remove (a new numbers gist).
// - `notecards-friends.n.<k>.json` the numbers generation k `{ stats, covers }`: the current numbers gist is the one of
//   the highest k (then the highest ID); `covers` names each removed pointer that it was made after. `…d.<id>.json`: done
//   (each pointer moved to it, the older numbers gists deleted). A larger set of removes makes a NEW generation.

export const LIST_VERSION = 2
const LIST_PREFIX = 'notecards-friends.'
/** The names of the list's own files (inside the list gist). */
export const listFile = {
  friend: (mine: string) => `${LIST_PREFIX}f.${mine}.json`,
  group: (mine: string) => `${LIST_PREFIX}g.${mine}.json`,
  shared: (mine: string) => `${LIST_PREFIX}s.${mine}.json`,
  /** A tombstone of the pointer `mine`; `tag` makes the name unique, so no tombstone is ever written over another. */
  tomb: (mine: string, tag: string) => `${LIST_PREFIX}x.${mine}-${tag}.json`,
  /** Generation k with its numbers gist: a unique name, so two devices never write over each other's generation. */
  gen: (k: number, stats: string) => `${LIST_PREFIX}n.${k}-${stats}.json`,
  done: (stats: string) => `${LIST_PREFIX}d.${stats}.json`,
  /** YAZ-5083: the intent of generation k (a device makes its numbers gist now; the removes it covers are fixed). */
  intent: (k: number) => `${LIST_PREFIX}i.${k}.json`,
}
const LIST_FILE_RE = /^notecards-friends\.([fgsxndi])\.([0-9a-z-]{1,90})\.json$/
/** Is this a file of the list gist (the head, or an entry, tombstone or generation file)? */
export const isListFile = (name: string): boolean => name === INDEX_FILE || LIST_FILE_RE.test(name)

export type EntryKind = 'friend' | 'group' | 'shared'
const KINDS: readonly EntryKind[] = ['friend', 'group', 'shared']

/** A tombstone: the entry (of `kinds`) with the pointer `mine` is gone for good. */
export interface Tombstone {
  /** The tombstone's own ID (`<mine>-<tag>`): a generation's `covers` names tombstones, not pointers. */
  id: string
  mine: string
  kinds: EntryKind[]
  /** A remove: a new numbers gist must follow (round 16). False: the entry was only replaced (a heal, a shared link that became a friend). */
  rekey: boolean
  at: string
  name?: string
  /** More of my gists to delete with it (the group file of "Delete group"). */
  drop: string[]
}

/** YAZ-5083: a generation that a device makes now: the removes it covers are FIXED at its start (YAZ-5310). */
export interface Intent {
  k: number
  covers: string[]
  /** The device run that makes it; another run takes it over only after `INTENT_LEASE_MS`. */
  by: string
  at: string
}

/** A numbers generation. */
export interface Generation {
  k: number
  stats: string
  covers: string[]
  done: boolean
}

export interface ListState {
  tombs: Tombstone[]
  gens: Generation[]
  /** The numbers gist of a version 1 head (before any generation). */
  legacyStats: string | null
  /** Removes (tombstones with `rekey`) that no generation covers yet. */
  pending: Tombstone[]
  /** YAZ-5083: generations a device makes now (in the vault repo list only). */
  intents: Intent[]
}

export type ListRead = { kind: 'ok'; value: FriendsIndex; raw: Record<string, unknown>; files: Record<string, string>; list: ListState } | { kind: 'newer' } | { kind: 'unreadable'; why: string }

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * The list from its files (the head and each list file; other files are ignored). Never throws. The YAZ-5191 rule:
 * a head that is not a JSON object with `v` 1 or 2, a field of the wrong shape, a tombstone or a generation that cannot
 * be read: the whole list is `unreadable`, and nothing writes to it. An entry file that cannot be read is left out
 * and kept as it is. A `v` above 2 is `newer`.
 */
export function readListFiles(input: Record<string, string | null | undefined>): ListRead {
  const files: Record<string, string> = {}
  for (const [name, text] of Object.entries(input)) if (typeof text === 'string' && isListFile(name)) files[name] = text
  const headText = files[INDEX_FILE]
  if (headText === undefined) return { kind: 'unreadable', why: 'the head file is missing' }
  if (headText.length > 256 * 1024) return { kind: 'unreadable', why: 'the file is too large' }
  const head = parseJson(headText)
  if (!isObject(head)) return { kind: 'unreadable', why: 'the file is not an object' }
  if (typeof head.v === 'number' && Number.isInteger(head.v) && head.v > LIST_VERSION) return { kind: 'newer' }
  if (head.v !== 1 && head.v !== LIST_VERSION) return { kind: 'unreadable', why: 'the file has another version' }
  // The head's own fields (and a version 1 head's arrays) are read with the version 1 rules.
  let legacy: { ok: true; value: FriendsIndex } | { ok: false; why: string }
  try {
    legacy = parseIndex(JSON.stringify({ ...head, v: 1 }))
  } catch {
    legacy = { ok: false, why: 'the file cannot be read' }
  }
  if (!legacy.ok) return { kind: 'unreadable', why: legacy.why }
  const friends = new Map(legacy.value.friends.map((f) => [f.mine, f]))
  const groups = new Map(legacy.value.groups.map((g) => [g.mine, g]))
  const shared = new Map((legacy.value.shared ?? []).map((x) => [x.mine, x]))
  const tombs: Tombstone[] = []
  const gens: Generation[] = []
  const done = new Set<string>()
  const intents: Intent[] = []
  for (const [name, text] of Object.entries(files)) {
    const m = LIST_FILE_RE.exec(name)
    if (m === null) continue
    const [, kind, key] = m
    const o = parseJson(text)
    if (kind === 'f') {
      if (isGistId(key) && isObject(o) && isGistId(o.theirs))
        friends.set(key, { name: shownName(o.name), theirs: (o.theirs as string).toLowerCase(), mine: key, ...(o.paired === true && { paired: true as const }), ...(typeof o.login === 'string' && o.login !== '' && o.login.length <= 100 && { login: o.login }) })
    } else if (kind === 'g') {
      if (isGistId(key) && isObject(o) && isGistId(o.group))
        groups.set(key, {
          name: shownName(o.name),
          group: (o.group as string).toLowerCase(),
          mine: key,
          admin: o.admin === true,
          ...(o.joined === true && { joined: true as const }),
          ...(typeof o.asked === 'string' && o.asked.length <= 40 && { asked: o.asked }),
        })
    } else if (kind === 's') {
      if (isGistId(key) && isObject(o)) shared.set(key, { mine: key, at: typeof o.at === 'string' && o.at.length <= 40 ? o.at : '' })
    } else if (kind === 'x') {
      const kinds = isObject(o) && Array.isArray(o.kinds) ? o.kinds : KINDS
      const [mineKey, tag] = key.split('-')
      if (!isGistId(mineKey) || tag === undefined || !isObject(o) || typeof o.rekey !== 'boolean' || !kinds.every((k) => (KINDS as readonly unknown[]).includes(k)) || (o.drop !== undefined && !(Array.isArray(o.drop) && o.drop.every(isGistId))))
        return { kind: 'unreadable', why: `the tombstone ${key} cannot be read` }
      tombs.push({ id: key, mine: mineKey, kinds: kinds as EntryKind[], rekey: o.rekey, at: typeof o.at === 'string' ? o.at.slice(0, 40) : '', ...(typeof o.name === 'string' && { name: o.name.slice(0, MAX_NAME) }), drop: (o.drop as string[] | undefined) ?? [] })
    } else if (kind === 'n') {
      const [kText, statsKey] = key.split('-')
      const k = Number(kText)
      if (!Number.isInteger(k) || k < 0 || !isObject(o) || !isGistId(o.stats) || o.stats.toLowerCase() !== statsKey || !Array.isArray(o.covers) || !o.covers.every((c) => typeof c === 'string' && /^[0-9a-z-]{1,90}$/.test(c)))
        return { kind: 'unreadable', why: `the numbers generation ${key} cannot be read` }
      gens.push({ k, stats: (o.stats as string).toLowerCase(), covers: o.covers as string[], done: false })
    } else if (kind === 'd') {
      if (isGistId(key)) done.add(key)
    } else if (kind === 'i') {
      // A hint only (who makes generation k now): one that cannot be read is left out, never a reason to stop.
      const k = Number(key)
      if (Number.isInteger(k) && k >= 0 && isObject(o) && Array.isArray(o.covers) && o.covers.every((c) => typeof c === 'string' && /^[0-9a-z-]{1,90}$/.test(c)) && typeof o.by === 'string' && typeof o.at === 'string')
        intents.push({ k, covers: o.covers as string[], by: o.by.slice(0, 40), at: o.at.slice(0, 40) })
    }
  }
  gens.sort((a, b) => a.k - b.k || (a.stats < b.stats ? -1 : a.stats > b.stats ? 1 : 0))
  for (const g of gens) g.done = done.has(g.stats)
  const ended = (mine: string, kind: EntryKind) => tombs.some((t) => t.mine === mine && t.kinds.includes(kind))
  // A remove waits until the CURRENT generation covers it: a generation made from an older copy of the list (by a
  // device that read it before the remove) may be the newest, and the removed friend may have read it.
  const covered = new Set(gens.at(-1)?.covers ?? [])
  // A version 1 head's waiting remove (`rekey.drop`) reads as removes that no generation covers yet.
  const legacyRekey = isObject(head.rekey) && Array.isArray(head.rekey.drop) ? (head.rekey.drop as unknown[]).filter(isGistId) : []
  for (const mine of legacyRekey) if (!tombs.some((t) => t.mine === mine)) tombs.push({ id: `${mine}-legacy`, mine, kinds: [...KINDS], rekey: true, at: '', drop: [] })
  // A version 1 re-key whose pointers were already deleted (`drop` empty) still waits: one tombstone with no entry.
  if (isObject(head.rekey) && legacyRekey.length === 0) tombs.push({ id: 'rekey-legacy', mine: PARKED, kinds: [], rekey: true, at: '', drop: [] })
  const pending = tombs.filter((t) => t.rekey && !covered.has(t.id))
  const current = gens.at(-1)
  const legacyStats = legacy.value.stats
  const stats = current?.stats ?? legacyStats
  const value: FriendsIndex = {
    v: 1,
    nickname: legacy.value.nickname,
    vaults: legacy.value.vaults,
    ...(legacy.value.zone !== undefined && { zone: legacy.value.zone }),
    stats,
    friends: [...friends.values()].filter((f) => !ended(f.mine, 'friend')),
    groups: [...groups.values()].filter((g) => !ended(g.mine, 'group')),
    shared: [...shared.values()].filter((x) => !ended(x.mine, 'shared')),
  }
  const { rekey: _legacyRekey, ...headRest } = head
  const waiting = pending.length > 0 || (current !== undefined && !current.done)
  // The names of the removes that are not done: those no generation covers yet, and (YAZ-5083) those the current
  // generation covers while it is not done (its pointers still move): the rows say "Removing…" until the end.
  const unfinished = current !== undefined && !current.done ? tombs.filter((t) => t.rekey && (pending.includes(t) || current.covers.includes(t.id))) : pending
  const names: Record<string, string> = {}
  for (const t of unfinished) if (t.name !== undefined) names[t.mine] = t.name
  const previous = gens.length >= 2 ? gens[gens.length - 2].stats : legacyStats
  const raw: Record<string, unknown> = {
    ...headRest,
    ...(waiting && {
      rekey: {
        old: current !== undefined && !current.done ? previous : stats,
        drop: [...pending.map((t) => t.mine), ...pending.flatMap((t) => t.drop)],
        next: current !== undefined && !current.done ? current.stats : null,
        at: pending[0]?.at ?? '',
        names,
      },
    }),
  }
  return { kind: 'ok', value, raw, files, list: { tombs, gens, legacyStats, pending, intents } }
}

/** The text of an entry file: the known fields over the fields of the file as read (an older app's extra fields stay). */
function entryText(base: string | undefined, known: Record<string, unknown>): string {
  const o = base === undefined ? undefined : parseJson(base)
  const raw = isObject(o) ? o : {}
  const out: Record<string, unknown> = { ...raw, v: 1, ...known }
  if (typeof known.name === 'string' && typeof raw.name === 'string' && known.name === shownName(raw.name)) out.name = raw.name
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete out[k]
  return JSON.stringify(out)
}

/** The tag of a tombstone's file name: what it ends, a remove or not, and when (no two different tombstones share it). */
export const tombTag = (kinds: readonly EntryKind[], rekey: boolean, at = ''): string =>
  `${kinds.map((k) => k[0]).join('')}${rekey ? 'r' : 'e'}${(Date.parse(at) || 0).toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`

/** A tombstone file's text. */
export const tombText = (t: Omit<Tombstone, 'mine' | 'id'>): string => JSON.stringify({ v: 1, ...t, ...(t.drop.length === 0 && { drop: undefined }) })

/**
 * The files to write so that the list as read (`handle`) becomes `next`, and nothing more (YAZ-5312). An entry that
 * `next` no longer has gets a tombstone that only ends it (`rekey: false`): a remove writes its own tombstone first.
 */
export function listPatch(handle: IndexHandle, next: FriendsIndex): Record<string, string | null> {
  const base = handle.index
  const files = handle.files ?? {}
  const patch: Record<string, string | null> = {}
  const headObj = isObject(handle.raw) ? handle.raw : {}
  const { rekey: _synth, ...headRaw } = headObj
  const legacyHead = headRaw.v === 1 || handle.files === undefined
  // The head: only when the name or the vaults change, or to move a version 1 head to version 2 (its arrays stay).
  const vaultsChanged = JSON.stringify(next.vaults) !== JSON.stringify(base.vaults)
  if (legacyHead || next.nickname !== base.nickname || vaultsChanged || next.zone !== base.zone) {
    const headParsed = parseJson(files[INDEX_FILE] ?? '{}')
    const rawHead = isObject(headParsed) ? headParsed : headRaw
    const nickname = next.nickname === shownNickname(rawHead.nickname) && rawHead.nickname !== undefined ? rawHead.nickname : next.nickname
    const keptVaults = (Array.isArray(rawHead.vaults) ? rawHead.vaults : []).filter((v) => typeof v !== 'string')
    patch[INDEX_FILE] = JSON.stringify({ ...rawHead, v: LIST_VERSION, nickname, vaults: [...next.vaults, ...keptVaults], ...(next.zone !== undefined && next.zone !== base.zone && { zone: next.zone }) })
  }
  const endTomb = (mine: string, kinds: EntryKind[]) => {
    // YAZ-5083: in the vault repo each write is a compare-and-swap, so no stale write can bring an entry back: an entry
    // that goes loses its record. Only an entry of a version 1 head (no record of its own) needs a tombstone.
    if (handle.store !== undefined) {
      const name = kinds[0] === 'friend' ? listFile.friend(mine) : kinds[0] === 'group' ? listFile.group(mine) : listFile.shared(mine)
      if (files[name] !== undefined) {
        patch[name] = null
        return
      }
    }
    if ((handle.state?.tombs ?? []).some((t) => t.mine === mine && kinds.every((k) => t.kinds.includes(k)))) return
    patch[listFile.tomb(mine, tombTag(kinds, false))] = tombText({ kinds, rekey: false, at: '', drop: [] })
  }
  // Friends.
  const nextFriends = new Map(next.friends.map((f) => [f.mine, f]))
  for (const f of next.friends) {
    const name = listFile.friend(f.mine)
    const old = base.friends.find((x) => x.mine === f.mine)
    if (old !== undefined && files[name] !== undefined && old.name === f.name && old.theirs === f.theirs && (old.paired === true) === (f.paired === true) && old.login === f.login) continue
    const text = entryText(files[name], { name: f.name, theirs: f.theirs, paired: f.paired === true ? true : undefined, login: f.login })
    if (files[name] !== text) patch[name] = text
  }
  for (const f of base.friends) if (!nextFriends.has(f.mine)) endTomb(f.mine, ['friend'])
  // Groups.
  const nextGroups = new Map(next.groups.map((g) => [g.mine, g]))
  for (const g of next.groups) {
    const name = listFile.group(g.mine)
    const old = base.groups.find((x) => x.mine === g.mine)
    if (old !== undefined && files[name] !== undefined && JSON.stringify(old) === JSON.stringify(g)) continue
    const text = entryText(files[name], { name: g.name, group: g.group, admin: g.admin, joined: g.joined === true ? true : undefined, asked: g.asked })
    if (files[name] !== text) patch[name] = text
  }
  for (const g of base.groups) if (!nextGroups.has(g.mine)) endTomb(g.mine, ['group'])
  // Shared links: a new one is a file; one that goes loses its file (a version 1 one gets a tombstone for `shared`).
  const nextShared = new Set((next.shared ?? []).map((x) => x.mine))
  for (const x of next.shared ?? []) if (!(base.shared ?? []).some((y) => y.mine === x.mine)) patch[listFile.shared(x.mine)] = JSON.stringify({ v: 1, at: x.at })
  for (const x of base.shared ?? []) {
    if (nextShared.has(x.mine)) continue
    if (files[listFile.shared(x.mine)] !== undefined) patch[listFile.shared(x.mine)] = null
    else endTomb(x.mine, ['shared'])
  }
  // The numbers gist: a new generation, done at once (a re-key writes its own generations).
  if (next.stats !== null && next.stats !== base.stats) {
    const gens = handle.state?.gens ?? []
    const k = (gens.at(-1)?.k ?? -1) + 1
    const covers = [...new Set([...(gens.at(-1)?.covers ?? []), ...(handle.state?.pending ?? []).map((t) => t.id)])]
    patch[listFile.gen(k, next.stats)] = JSON.stringify({ v: 1, stats: next.stats, covers })
    patch[listFile.done(next.stats)] = '{"v":1}'
  }
  return patch
}

/** YAZ-5276: a numbers gist that is provably ours: exactly our one file, in our format. Never by a file name alone. */
export async function isOurNumbersGist(api: GistsApi, id: string): Promise<boolean> {
  let gist: GistDoc | 'unchanged'
  try {
    gist = await api.read(id)
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return false
    throw err
  }
  if (gist === 'unchanged') return false
  const names = Object.keys(gist.files)
  return names.length === 1 && names[0] === NUMBERS_FILE && readStatsFile(fileText(gist, NUMBERS_FILE)).kind === 'ok'
}

/** A list found or made: its gist, its known fields, the whole object, and the ETag of the read. */
export interface IndexHandle {
  id: string
  index: FriendsIndex
  /** The head file's object, with `rekey` worked out from the list's files when a remove waits (see `readListFiles`). */
  raw: Record<string, unknown>
  etag: string | null
  createdAt: string
  /** YAZ-5312: the text of each list file as read (the head and each entry file). A write sends only what differs. */
  files?: Record<string, string>
  /** YAZ-5312: the list's tombstones and numbers generations as read. */
  state?: ListState
  /** The GitHub login that owns the list gist (GitHub's answer): "my own link" and "the same friend" use owners. */
  owner?: string | null
  /** YAZ-5083: the commit of the vault repo that this copy of the list was read at (the parent of the next write). */
  sha?: string
  /** YAZ-5083: where the list lives (the home vault's repo). Absent: an old gist list, read only, not moved yet. */
  store?: ListStore
  /** YAZ-5083: the list file's fields that this app does not know (kept on each write). */
  extra?: Record<string, unknown>
  /** YAZ-5398: the list's write count at `sha`, and when (this device's clock) this copy was read or written. */
  rev?: number
  seenAt?: number
}

/**
 * `broken`: the list is not a JSON object with `v: 1` (YAZ-5191). The app writes NOTHING to it: `LIST_NEEDS_REPAIR`.
 * `elsewhere` (YAZ-5083): the list is in the vault `home`, which this device does not have: it says so, and writes
 * nothing. `no-vault`: this device has no vault on the friends account to hold a new list.
 */
export type IndexFind =
  | { kind: 'none' }
  | { kind: 'newer'; id: string }
  /** `cut` (YAZ-5400): an old gist list of more than 300 files; GitHub gives only 300 names, so it cannot be read whole. */
  | { kind: 'broken'; id: string; cut?: true }
  | { kind: 'ok'; handle: IndexHandle }
  | { kind: 'elsewhere'; home: string }
  | { kind: 'no-vault' }
  /**
   * YAZ-5399: GitHub answers 404 for the home vault repo (deleted, or no access at all). The way out: `restartList`.
   * YAZ-5444 `fileGone`: the vault answers, but the list FILE is gone from it (deleted by hand, or the vault was made
   * again under the same name), past the stale window. The same way out, also in the home vault itself.
   */
  | { kind: 'home-gone'; home: string; fileGone?: true }

/** How a write is labelled and spaced. `describe` gives the gist's description (the live test starts it "notecards-test"). */
export interface WriteOptions {
  describe: (kind: 'numbers' | 'index' | 'pointer') => string
  sleep: (ms: number) => Promise<void>
  now?: () => number
  /**
   * YAZ-5083: this device's own tag (stable across its restarts), so it knows its own step of a remove that it began
   * before a stop. Absent: one tag for this run of the app.
   */
  device?: string
  /**
   * YAZ-5398: the newest list this device wrote or read in each repo. A read older than it is a stale read of GitHub
   * and is never trusted (`readGuarded`). Absent: only the handle in hand counts.
   */
  memory?: ListMemory
}

/**
 * Default descriptions: what a person sees in their own gist list on GitHub. Only a NEW gist takes them (`create`); a
 * gist made before keeps its "Notecard: …" description (the app never renames one, and finds none by it).
 */
export const DESCRIPTIONS: Record<'numbers' | 'index' | 'pointer', string> = {
  numbers: 'Yaseen Docs: my review numbers for friends (no card text)',
  index: 'Yaseen Docs: my friends list',
  pointer: 'Yaseen Docs: a friend link',
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

/** An empty but valid numbers file: a friend who reads it before the first send sees zeros, not an error. */
export function emptyNumbers(now: number): FriendStats {
  const zero = { cards: 0, inReview: 0, newLeft: 0, mature: 0, dueLeft: 0, addedThisWeek: 0, streak: 0, bestStreak: 0, bestDay: 0, bestWeek: 0 }
  return { v: 1, login: '', name: '', avatar: '', days: [], totals: zero, at: new Date(now).toISOString() }
}

/**
 * YAZ-5312: a new pointer is born PARKED: it names this placeholder, not the numbers gist, until the list names the
 * pointer. A pointer left behind by a stop (or a refused list write) then leads nowhere (I3), and the sweep deletes it.
 */
export const PARKED = '0'.repeat(32)
export const makeParkedPointer = (api: GistsApi, opts: WriteOptions, more: { reads?: string } = {}): Promise<string> => makePointer(api, PARKED, opts, more)

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
    // YAZ-5241: a pointer this app cannot read (or a newer one) is never written over.
    if (state.kind !== 'ok') continue
    if (state.value.stats === stats) continue
    const raw = state.raw
    const ours = { ...raw, v: 1, stats }
    await write(() => api.update(id, { [POINTER_FILE]: JSON.stringify(ours) }, pointerRedo(raw, ours)))
    updated.push(id)
  }
  return { updated, gone }
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
