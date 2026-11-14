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
  /** ONE commit on `parent` that writes `path` (`null` deletes it), then the ref `PATCH` with `force: false`. */
  commit(parent: string, path: string, text: string | null, message: string): Promise<string>
}

export type ListErrorCode = 'STALE_HEAD' | 'NO_LIST_ACCESS'
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
  return code === 'STALE_HEAD' || code === 'NO_LIST_ACCESS' ? code : null
}

/** The list was written by a newer app: this app writes nothing to it. */
export class NewerList extends Error {}
/** The list cannot be read (YAZ-5191): the app writes nothing to it ("needs repair"). */
export class BrokenList extends Error {}

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

export type ListFileRead = { kind: 'ok'; files: Record<string, string>; extra: Record<string, unknown> } | { kind: 'newer' } | { kind: 'unreadable'; why: string }

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
  const { v: _v, about: _about, head: _head, records: _records, ...extra } = o
  return { kind: 'ok', files, extra }
}

/** The list file's text from version 2 files: one record on each line, keys in order. */
export function listFileText(files: Record<string, string>, extra: Record<string, unknown> = {}): string {
  const head = files[INDEX_FILE]
  if (head === undefined) throw new Error('A list has a head')
  const keys = Object.keys(files)
    .map((f) => [recordKey(f), f] as const)
    .filter((x): x is readonly [string, string] => x[0] !== null && x[0] !== 'head')
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const one = (text: string) => JSON.stringify(JSON.parse(text) as unknown)
  const lines = keys.map(([key, file]) => `    ${JSON.stringify(key)}: ${one(files[file])}`)
  const extras = Object.entries(extra).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join('')
  return `{\n  "v": ${LIST_FILE_VERSION},\n  "about": ${JSON.stringify(ABOUT)},\n${extras}  "head": ${one(head)},\n  "records": {${lines.length === 0 ? '' : `\n${lines.join(',\n')}\n  `}}\n}\n`
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
}

export type RepoListRead = { kind: 'ok'; snap: RepoListSnapshot } | { kind: 'missing'; sha: string; etag: string | null } | { kind: 'newer' } | { kind: 'unreadable'; why: string }

/** The list at the branch head (a fresh read). */
export async function readRepoList(port: RepoPort): Promise<RepoListRead> {
  const head = await port.head()
  if (head === 'unchanged') throw new Error('a head read with no ETag cannot be unchanged')
  return readAt(port, head.sha, head.etag)
}

export async function readAt(port: RepoPort, sha: string, etag: string | null): Promise<RepoListRead> {
  const text = await port.read(sha, LIST_PATH)
  if (text === null) return { kind: 'missing', sha, etag }
  const file = parseListFile(text)
  if (file.kind !== 'ok') return file
  const read = readListFiles(file.files)
  if (read.kind !== 'ok') return read
  return { kind: 'ok', snap: { sha, etag, read, extra: file.extra } }
}

/**
 * Makes the list file when the branch does not have it yet. Never writes over one that is there (another device made
 * it a moment ago): then that one is read and kept. Returns the list as it is on GitHub after the call.
 */
export async function createRepoList(port: RepoPort, files: Record<string, string>, message: string, sleep: (ms: number) => Promise<void>): Promise<RepoListRead> {
  for (let attempt = 0; ; attempt++) {
    const now = await readRepoList(port)
    if (now.kind !== 'missing') return now
    try {
      await port.commit(now.sha, LIST_PATH, listFileText(files), message)
    } catch (err) {
      if (listErrorCode(err) === 'STALE_HEAD' && attempt < MAX_STALE_WRITES) {
        await sleep(backoff(attempt))
        continue
      }
      throw err
    }
  }
}

/** The wait before a write tries again after `STALE_HEAD`: short, then longer (another writer is at work). */
export const backoff = (attempt: number): number => Math.min(8000, 250 * 2 ** attempt)
