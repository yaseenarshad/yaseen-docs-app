import { INDEX_FILE, LIST_VERSION, isListFile, readListFiles, type ListRead } from './friendGists'

/**
 * THE FRIENDS LIST IN THE VAULT REPO (YAZ-5083, "Decision (Yaseen): the friends list moves into the vault repo").
 *
 * The person's OWN list (the entries, the tombstones, the numbers generations, the home time zone) is ONE file in ONE of
 * their vault repos: `.yaseendocs/friends.json`. The numbers gist and the pointer gists stay gists (decision 14 as
 * changed in round 16): friends never need the repo, and no friend's file names the repo or the list.
 *
 * A write is a git commit, made as the answer list makes one (`GithubRemote.commit` on the phone): blobs, a tree with
 * `base_tree`, a commit, then `PATCH` of the branch ref with `force: false`. A branch that moved after the read gives
 * 422 "Update is not a fast forward" (`STALE_HEAD`). Then the writer reads the newest list and applies its change AGAIN,
 * as an OPERATION on that copy, never as a whole-file overwrite (`ListStore.update`). This is the compare-and-swap that
 * a gist does not have: two devices of one person can no longer write over each other (I7).
 *
 * The file's shape (one JSON file; a list of a few hundred friends is a few tens of KB, far below GitHub's limits, and
 * one file is one blob, so no 300-file cut as in a gist, YAZ-5350):
 *
 *   { "v": 1, "about": "…", "head": { v: 2, nickname, vaults, zone? }, "records": { "<key>": { … }, … } }
 *
 * Each record is one entry of the list, keyed as the version 2 gist named its files (`f.<mine>` a friend, `g.<mine>` a
 * group, `s.<mine>` a shared link, `x.<mine>-<tag>` a tombstone of a remove, `n.<k>-<numbers id>` a numbers generation,
 * `d.<numbers id>` a generation that is done, `i.<k>` the intent of a generation that a device makes now). The app reads
 * the records with the same reader as the version 2 gist (`readListFiles`), so every rule of the list stays one rule.
 * One record on each line, keys in order: a diff of two commits shows only the records that changed.
 *
 * Where the list is (several vaults): the gist `notecards-friends.json` of the person (decision 15's list gist, found
 * by its file name in `GET /gists`) becomes a small NOTE: `{ v: 3, home: "owner/name" }`. It holds only the repo name.
 * A device that has that vault reads the list there; a device that does not says so plainly and writes nothing.
 */

/** The list's path in the home vault. A hidden folder: the phone and the Mac never index it as a page or a card. */
export const LIST_PATH = '.yaseendocs/friends.json'
/** The version of the file's own shape (not of the head inside it). */
export const LIST_FILE_VERSION = 1
/** The version of the note in the list gist: above 2, so an older app reads "a newer list" and writes nothing. */
export const NOTE_VERSION = 3
/** A list file over this size is not read (a hand edit gone wrong): the app writes nothing to it (YAZ-5191). */
export const MAX_LIST_BYTES = 4 * 1024 * 1024
/** A write reads again and repeats at most this often when the branch keeps moving (then it waits for the next run). */
export const MAX_STALE_WRITES = 8

const ABOUT = 'Notecard: your friends list. The app writes this file. Do not change it by hand.'
const PREFIX = 'notecards-friends.'

/**
 * The repo calls of the list, on one vault repo and branch. The phone builds it on 3B's `githubRemote` (the commit code
 * of the answer list); the Mac builds it on its own HTTP calls in the main process. Every failure throws an error with a
 * `code`: `STALE_HEAD` for a moved branch, `NO_LIST_ACCESS` when the token cannot read or write the repo, and the codes
 * of `GistErrorCode` (`OFFLINE`, `RATE_LIMITED`, …) for the rest.
 */
export interface RepoPort {
  /** `owner/name`, lower case. */
  readonly repo: string
  readonly branch: string
  /** The branch head; with `etag`, an unchanged branch is `'unchanged'` (a free 304). */
  head(etag?: string | null): Promise<{ sha: string; etag: string | null } | 'unchanged'>
  /** The text of `path` at `commit`, or null when the file is not there. */
  read(commit: string, path: string): Promise<string | null>
  /**
   * ONE commit on `parent` that writes `path`, then the ref `PATCH` with `force: false`. It never deletes a path: GitHub
   * refuses `sha: null` for a path that the base tree does not have (422 "GitRPC::BadObjectState"), and the list app
   * never needs a delete (a list is never taken out of the vault).
   */
  commit(parent: string, path: string, text: string, message: string): Promise<string>
  /**
   * YAZ-5399: the repo's name as GitHub gives it now (`full_name`, lower case). A renamed or transferred repo answers its
   * old name with a redirect, which the read follows; this says the new name. Optional (a port without it: unknown).
   */
  canonical?(): Promise<string>
}

/**
 * `STALE_HEAD`: the branch moved (the ref `PATCH` was refused). `NO_LIST_ACCESS`: the token cannot read or write the
 * repo. `STALE_READ` (YAZ-5398): GitHub answered with an object older than one this device already wrote or read (a read
 * replica that lags for a moment, for example `contents` at a commit that it does not have yet).
 */
export type ListErrorCode = 'STALE_HEAD' | 'NO_LIST_ACCESS' | 'STALE_READ'
/** A failure of the repo calls that is not a gist failure. */
export class ListError extends Error {
  constructor(
    readonly code: ListErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ListError'
  }
}
export const listErrorCode = (err: unknown): ListErrorCode | null => {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  return code === 'STALE_HEAD' || code === 'NO_LIST_ACCESS' || code === 'STALE_READ' ? code : null
}

/** The list was written by a newer app: this app writes nothing to it. */
export class NewerList extends Error {}
/**
 * The list cannot be read (YAZ-5191): the app writes nothing to it ("needs repair"). `missing` (YAZ-5444): the list
 * FILE is not at the branch head at all (a read that the stale rule took); the phone then opens the list again by its
 * note, which tells a file gone for good (`home-gone` with `fileGone`: the way out) from one that is not.
 */
export class BrokenList extends Error {
  constructor(readonly missing = false) {
    super(missing ? 'The friends list file is not in its vault' : 'The friends list cannot be read')
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The file: records ↔ the version 2 file names that `readListFiles` reads.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The record key of a version 2 file name (`notecards-friends.f.<mine>.json` → `f.<mine>`), or `head`. */
export function recordKey(file: string): string | null {
  if (file === INDEX_FILE) return 'head'
  if (!isListFile(file)) return null
  return file.slice(PREFIX.length, -'.json'.length)
}
export const recordFile = (key: string): string => (key === 'head' ? INDEX_FILE : `${PREFIX}${key}.json`)

export type ListFileRead = { kind: 'ok'; files: Record<string, string>; extra: Record<string, unknown>; rev: number } | { kind: 'newer' } | { kind: 'unreadable'; why: string }

/** YAZ-5398: the list's write count (`rev`): each write of the list adds 1. A file with no count (an older build) is 0. */
const revOf = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0)

/** The list file's text as version 2 files (`readListFiles` reads them). Never throws. */
export function parseListFile(text: string): ListFileRead {
  if (text.length > MAX_LIST_BYTES) return { kind: 'unreadable', why: 'the file is too large' }
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return { kind: 'unreadable', why: 'the file is not JSON' }
  }
  if (!isObject(o)) return { kind: 'unreadable', why: 'the file is not an object' }
  if (typeof o.v === 'number' && Number.isInteger(o.v) && o.v > LIST_FILE_VERSION) return { kind: 'newer' }
  if (o.v !== LIST_FILE_VERSION) return { kind: 'unreadable', why: 'the file has another version' }
  if (!isObject(o.head)) return { kind: 'unreadable', why: 'the head is missing' }
  if (!isObject(o.records)) return { kind: 'unreadable', why: 'the records are missing' }
  const files: Record<string, string> = { [INDEX_FILE]: JSON.stringify(o.head) }
  for (const [key, value] of Object.entries(o.records)) {
    const file = recordFile(key)
    if (key === 'head' || !isListFile(file)) return { kind: 'unreadable', why: `the record ${key.slice(0, 40)} has an unknown name` }
    if (!isObject(value)) return { kind: 'unreadable', why: `the record ${key.slice(0, 40)} is not an object` }
    files[file] = JSON.stringify(value)
  }
  const { v: _v, about: _about, rev, head: _head, records: _records, ...extra } = o
  return { kind: 'ok', files, extra, rev: revOf(rev) }
}

/**
 * The list file's text from version 2 files: one record on each line, keys in order. `rev` (YAZ-5398) is the write
 * count of this version of the file: the writer gives the count it read plus 1.
 */
export function listFileText(files: Record<string, string>, extra: Record<string, unknown> = {}, rev = 0): string {
  const head = files[INDEX_FILE]
  if (head === undefined) throw new Error('A list has a head')
  const keys = Object.keys(files)
    .map((f) => [recordKey(f), f] as const)
    .filter((x): x is readonly [string, string] => x[0] !== null && x[0] !== 'head')
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const one = (text: string) => JSON.stringify(JSON.parse(text) as unknown)
  const lines = keys.map(([key, file]) => `    ${JSON.stringify(key)}: ${one(files[file])}`)
  const extras = Object.entries(extra).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join('')
  return `{\n  "v": ${LIST_FILE_VERSION},\n  "about": ${JSON.stringify(ABOUT)},\n  "rev": ${revOf(rev)},\n${extras}  "head": ${one(head)},\n  "records": {${lines.length === 0 ? '' : `\n${lines.join(',\n')}\n  `}}\n}\n`
}

/** Applies a patch of version 2 files (`null` deletes one; a missing one is no error, unlike a gist, YAZ-5351). */
export function applyPatch(files: Record<string, string>, patch: Record<string, string | null>): Record<string, string> {
  const out = { ...files }
  for (const [name, text] of Object.entries(patch)) {
    if (text === null) delete out[name]
    else out[name] = text
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// The note in the list gist: where the list is.

export type NoteRead = { kind: 'note'; home: string } | { kind: 'legacy' } | { kind: 'newer' } | { kind: 'unreadable' }

/** The note's text. It holds ONLY the repo name (no list, no friend, no pointer, no numbers ID). */
export const noteText = (home: string): string =>
  JSON.stringify({ v: NOTE_VERSION, home: home.toLowerCase(), about: 'Notecard keeps your friends list in this vault, in .yaseendocs/friends.json. This gist only says where.' })

const REPO_RE = /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/i

/** What the head file of the list gist is: the note (v 3), an old list (v 1 or 2), a newer one, or unreadable. */
export function readNote(text: string | null | undefined): NoteRead {
  if (typeof text !== 'string') return { kind: 'unreadable' }
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return { kind: 'unreadable' }
  }
  if (!isObject(o)) return { kind: 'unreadable' }
  if (o.v === 1 || o.v === LIST_VERSION) return { kind: 'legacy' }
  if (typeof o.v === 'number' && Number.isInteger(o.v) && o.v > NOTE_VERSION) return { kind: 'newer' }
  if (o.v === NOTE_VERSION && typeof o.home === 'string' && REPO_RE.test(o.home)) return { kind: 'note', home: o.home.toLowerCase() }
  return { kind: 'unreadable' }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading and writing the list file with compare-and-swap.

export interface RepoListSnapshot {
  sha: string
  etag: string | null
  read: ListRead & { kind: 'ok' }
  extra: Record<string, unknown>
  /** YAZ-5398: the list's write count at this commit. */
  rev: number
}

export type RepoListRead = { kind: 'ok'; snap: RepoListSnapshot } | { kind: 'missing'; sha: string; etag: string | null } | { kind: 'newer' } | { kind: 'unreadable'; why: string }

/**
 * YAZ-5398: ONE RULE FOR EVERY READ OF THE LIST. GitHub does not promise read-after-write for the ref API: for a short
 * time after a ref move, a read may give the head BEFORE the move (a read replica that lags). So a device could see its
 * own tombstone vanish, and answer "done" for a remove that still waits.
 *
 * The rule: a read is trusted only when it is at or after the newest list that THIS device wrote or read in that repo.
 * Each write of the list adds 1 to the file's `rev` (the CAS writer is its only writer, and every write is a fast
 * forward, so `rev` never goes down along the branch). A device keeps the highest `rev` it wrote or read, per repo
 * (`ListMemory`; the phone keeps it in its own state, so a restart keeps it too). A read with a LOWER `rev` is a stale
 * read: the device reads again after a short wait, at most `MAX_STALE_READS` times, and then stops with `GITHUB_DOWN`
 * (quiet; the next run tries again). A "done" or a "prove" step therefore never comes from a stale read.
 *
 * A lag is seconds. A `rev` that is still lower after `STALE_WINDOW_MS` is a real change on GitHub (a person restored an
 * older file by hand): it is taken, and the device's memory goes down to it. So a device never stops for good.
 */
export interface ListMemory {
  /** The highest `rev` this device wrote or read in `key` (`owner/name@branch`), and when (ms), or null. */
  floor(key: string): { rev: number; at: number } | null
  /** Records a `rev` this device wrote or read now; with `lower`, also a lower one (a real change, see above). */
  saw(key: string, rev: number, at: number, lower?: boolean): void
}

/** What a read of the list needs besides the port: this device's memory, its clock, and its wait. */
export interface ReadGuard {
  memory?: ListMemory | undefined
  now: () => number
  sleep: (ms: number) => Promise<void>
}

/** How long a lower `rev` counts as a stale read (a replica lag); after it, a lower `rev` is a real change. */
export const STALE_WINDOW_MS = 10 * 60_000
/** A stale read is tried again at most this often (the waits add up to about 8 seconds), then `GITHUB_DOWN`. */
export const MAX_STALE_READS = 6

/** A memory in a plain object (the phone stores `dump()` in its state, and gives it back at the next start). */
export function listMemory(saved: unknown = null): ListMemory & { dump(): Record<string, { rev: number; at: number }> } {
  const map = new Map<string, { rev: number; at: number }>()
  if (isObject(saved))
    for (const [k, v] of Object.entries(saved)) {
      if (!isObject(v) || typeof v.at !== 'number' || !Number.isFinite(v.at)) continue
      map.set(k, { rev: revOf(v.rev), at: v.at })
    }
  return {
    floor: (key) => map.get(key) ?? null,
    saw(key, rev, at, lower = false) {
      const was = map.get(key)
      if (was === undefined || rev > was.rev || (lower && rev < was.rev)) map.set(key, { rev, at })
      else if (rev === was.rev) map.set(key, { rev, at: Math.max(at, was.at) })
    },
    dump: () => Object.fromEntries(map),
  }
}

export const repoKey = (port: RepoPort): string => `${port.repo}@${port.branch}`

const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
const defaultGuard = (): ReadGuard => ({ now: Date.now, sleep: realSleep })

/** The error of a read that stayed stale: quiet (`GITHUB_DOWN`), as a server error; never a "done". */
export const staleReadError = (): Error => Object.assign(new Error('GitHub kept giving an older friends list'), { code: 'GITHUB_DOWN' })

/** The `rev` that `read` has, for the rule: a missing file is 0; a newer or unreadable file has none (no rule). */
const readRev = (read: RepoListRead): number | null => (read.kind === 'ok' ? read.snap.rev : read.kind === 'missing' ? 0 : null)

/**
 * A guarded read of the branch head and the list there (YAZ-5398). `min`: a `rev` that the caller already holds (its
 * handle, read at `minAt`). `etag` and `known`: the caller's copy; an unchanged branch (a 304, or the same commit) is
 * `'unchanged'`. `stale: true`: every try gave an older list (the last read is given; the caller decides).
 */
export async function readGuarded(
  port: RepoPort,
  guard: ReadGuard | undefined,
  have: { etag?: string | null; known?: string; min?: number; minAt?: number } = {},
): Promise<{ kind: 'unchanged'; etag: string | null } | { kind: 'read'; read: RepoListRead; stale: boolean }> {
  const g = guard ?? defaultGuard()
  const key = repoKey(port)
  let last: RepoListRead | null = null
  for (let attempt = 0; ; attempt++) {
    const head = await port.head(have.etag ?? null)
    if (head === 'unchanged') return { kind: 'unchanged', etag: have.etag ?? null }
    if (have.known !== undefined && head.sha === have.known) return { kind: 'unchanged', etag: head.etag }
    let read: RepoListRead | null = null
    try {
      read = await readAt(port, head.sha, head.etag)
    } catch (err) {
      if (listErrorCode(err) !== 'STALE_READ') throw err
    }
    const now = g.now()
    const rev = read === null ? null : readRev(read)
    const floor = g.memory?.floor(key) ?? null
    const fresh = (at: number | undefined) => at === undefined || Math.abs(now - at) < STALE_WINDOW_MS
    const need = Math.max(have.min !== undefined && fresh(have.minAt) ? have.min : 0, floor !== null && fresh(floor.at) ? floor.rev : 0)
    if (read !== null && (rev === null || rev >= need)) {
      // YAZ-5444: a missing file is no list: it leaves the memory as it is (a list that starts again in this repo then
      // gets a rev above the old one, so no device takes it for a stale read).
      if (rev !== null && read.kind !== 'missing') g.memory?.saw(key, rev, now, floor !== null && rev < floor.rev)
      return { kind: 'read', read, stale: false }
    }
    if (read !== null) last = read
    if (attempt + 1 >= MAX_STALE_READS) {
      if (last === null) throw staleReadError()
      return { kind: 'read', read: last, stale: true }
    }
    await g.sleep(backoff(attempt))
  }
}

/** The list at the branch head (a fresh read, guarded: never older than what this device wrote or read). */
export async function readRepoList(port: RepoPort, guard?: ReadGuard): Promise<RepoListRead> {
  const r = await readGuarded(port, guard)
  if (r.kind === 'unchanged') throw new Error('a head read with no ETag cannot be unchanged')
  if (r.stale) throw staleReadError()
  return r.read
}

export async function readAt(port: RepoPort, sha: string, etag: string | null): Promise<RepoListRead> {
  const text = await port.read(sha, LIST_PATH)
  if (text === null) return { kind: 'missing', sha, etag }
  const file = parseListFile(text)
  if (file.kind !== 'ok') return file
  const read = readListFiles(file.files)
  if (read.kind !== 'ok') return read
  return { kind: 'ok', snap: { sha, etag, read, extra: file.extra, rev: file.rev } }
}

/**
 * Makes the list file when the branch does not have it yet. Never writes over one that is there (another device made
 * it a moment ago): then that one is read and kept. Returns the list as it is on GitHub after the call: after its own
 * commit, the list AT that commit (a read of the head right after could be stale, YAZ-5398). A branch that keeps
 * moving ends in `GITHUB_DOWN` (quiet), never the raw `STALE_HEAD` (round 5, nit 1).
 */
export async function createRepoList(port: RepoPort, files: Record<string, string>, message: string, sleep: (ms: number) => Promise<void>, guard?: ReadGuard): Promise<RepoListRead> {
  const g: ReadGuard = guard ?? { now: Date.now, sleep }
  for (let attempt = 0; ; attempt++) {
    const now = await readRepoList(port, g)
    if (now.kind !== 'missing') return now
    let sha: string
    try {
      sha = await port.commit(now.sha, LIST_PATH, listFileText(files, {}, 1), message)
    } catch (err) {
      if (listErrorCode(err) === 'STALE_HEAD') {
        if (attempt >= MAX_STALE_WRITES) throw Object.assign(new Error('The friends list kept changing on GitHub'), { code: 'GITHUB_DOWN' })
        await sleep(backoff(attempt))
        continue
      }
      throw err
    }
    g.memory?.saw(repoKey(port), 1, g.now())
    const read = readListFiles(files)
    if (read.kind !== 'ok') throw new Error('A new list reads as a list')
    return { kind: 'ok', snap: { sha, etag: null, read, extra: {}, rev: 1 } }
  }
}

/** The wait before a write tries again after `STALE_HEAD`: short, then longer (another writer is at work). */
export const backoff = (attempt: number): number => Math.min(8000, 250 * 2 ** attempt)
