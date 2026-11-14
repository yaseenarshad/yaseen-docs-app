import {
  INDEX_FILE,
  NUMBERS_FILE,
  POINTER_FILE,
  findFriendsIndex,
  gistErrorCode,
  gistErrorResetAt,
  isGistId,
  makePointer,
  parseFriendsIndex,
  pointersOf,
  readFriend,
  readPointerFile,
  readStatsFile,
  writeFriendsIndex,
  type FileState,
  type FriendRead,
  type GistDoc,
  type GistsApi,
  type IndexHandle,
} from './friendGists'
import { pendingRemove, removeFriend, type ListCache, type ListOptions, type RemoveResult } from './friendsList'
import type { GistBudget } from './friendSend'
import type { FriendDay, FriendStats } from './friendStats'

/**
 * GROUPS RUN BY AN ADMIN (YAZ-5084, 4E3; decision 18; round 14: remove, leave, "Delete group"; round 16: one pointer
 * for each group; round 10, addition 13: the group streak). Pure logic on 4E1's `GistsApi`; the screens are 4E4's.
 *
 * - The group is ONE file (`notecards-group.json`, `GroupFile`) in a secret gist of its admin. Its link is that gist's ID
 *   (`/group#<id>`). Only the admin's app writes it. An admin can run many groups; each has its own file.
 * - Each member, the admin too, has ONE pointer gist for the group (`FriendPointer` with no `reads` and no `mark`). The
 *   member's entry in the file names that pointer. A reader reads the file, then each pointer, then each numbers gist,
 *   with its own token and ETags (an unchanged answer is a free 304).
 * - Join (decision 18: "the admin's app adds it"): the person pastes the group link. Their app makes their pointer and
 *   lists the group; they then send the admin a JOIN link (`/join#<group>-<pointer>`). The admin's app reads it
 *   (`readJoinRequest`: who asks) and adds it (`addMember`). Until then the person sees "Waiting for the admin to add you".
 * - Remove (round 14): the admin's app takes the entry out of the file. The removed person's app sees it is no longer
 *   in the file ("You're no longer in this group"), and leaves: it deletes its pointer, the group leaves its list, and
 *   (round 16) a new numbers gist cuts the others off, in 4E2's safe steps (`removeFriend`).
 * - Leave: the same safe steps. "Delete group" (the admin's "Leave"): the same, and the group file goes too. Members then
 *   see "This group is gone".
 * - A group file that cannot be read is NEVER written over (YAZ-5191): "needs-repair".
 * - The accepted limit (round 14): a removed person who reads the gists by hand can still see the numbers. And the admin's
 *   app must run for a join or a remove to show.
 */

export const GROUP_FILE = 'notecards-group.json'
export const GROUP_LINK_BASE = 'https://notecards.yaseenarshad.com/group'
export const JOIN_LINK_BASE = 'https://notecards.yaseenarshad.com/join'
/** The longest group name the admin can type (one line). */
export const GROUP_NAME_MAX = 60
/** A text read from a gist is cut to this for the screens (the file keeps it whole). */
const SHOWN_MAX = 100
/** A gist that no list names is deleted by `sweepOrphans` only when it is older than this: another device may be at work. */
export const ORPHAN_AGE_MS = 60 * 60_000

const SITE = 'notecards.yaseenarshad.com'
const LINK_ID = /^[0-9a-f]{20,40}$/i

export interface GroupMember {
  /** The member's GitHub login, from their numbers (`FriendStats.login`). A text: never drawn as HTML. */
  login: string
  /** The member's pointer gist for this group. */
  pointer: string
}

/** A group, in ONE secret gist of its admin (decision 18). Members read it; only the admin can change it. */
export interface GroupFile {
  v: 1
  name: string
  /** The admin's login. */
  admin: string
  members: GroupMember[]
}

export const groupLink = (group: string): string => `${GROUP_LINK_BASE}#${group.toLowerCase()}`
export const joinLink = (group: string, pointer: string): string => `${JOIN_LINK_BASE}#${group.toLowerCase()}-${pointer.toLowerCase()}`

/** A group name as the admin typed it: one line, trimmed, at most `GROUP_NAME_MAX` letters. Null: empty. */
export function cleanGroupName(text: string): string | null {
  const name = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GROUP_NAME_MAX)
    .trim()
  return name === '' ? null : name
}

export type AnyLink =
  | { kind: 'friend'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'join'; group: string; pointer: string }
  /** A bare ID or a gist address: what it is shows when the gist is read (a pointer, or a group file). */
  | { kind: 'id'; id: string }
  | { kind: 'empty' }
  | { kind: 'other-app' }
  | { kind: 'not-a-link' }

/** Any pasted text: a friend link, a group link, a join request, or a bare ID, in any shape. Never throws. */
export function parseAnyLink(text: string): AnyLink {
  const words = String(text ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/^[<("'[]+|[>)"'\].,;:!?]+$/g, '').replace(/\/+$/, ''))
    .filter((w) => w !== '')
  if (words.length === 0) return { kind: 'empty' }
  let otherApp = false
  let broken = false
  for (const word of words) {
    if (LINK_ID.test(word)) return { kind: 'id', id: word.toLowerCase() }
    if (!(word.includes('://') || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/#?]|$)/i.test(word))) continue
    let url: URL
    try {
      url = new URL(word.includes('://') ? word : `https://${word}`)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    if (host === SITE || host.endsWith(`.${SITE}`)) {
      const kind = parts[0]
      const raw = (url.hash.replace(/^#/, '') || url.searchParams.get('id') || parts[1] || '').replace(/\/+$/, '')
      if (kind === 'join') {
        const [group, pointer, extra] = raw.split('-')
        if (extra === undefined && LINK_ID.test(group ?? '') && LINK_ID.test(pointer ?? '')) return { kind: 'join', group: group.toLowerCase(), pointer: pointer.toLowerCase() }
      } else if ((kind === 'group' || kind === 'friend') && LINK_ID.test(raw)) return { kind, id: raw.toLowerCase() }
      broken = true
      continue
    }
    let id: string | null = null
    if (host === 'gist.github.com' || host === 'gist.githubusercontent.com') id = parts.find((p) => LINK_ID.test(p)) ?? null
    else if (host === 'api.github.com' && parts[0] === 'gists') id = parts[1] ?? null
    if (id !== null && LINK_ID.test(id)) return { kind: 'id', id: id.toLowerCase() }
    otherApp = true
  }
  if (broken) return { kind: 'not-a-link' }
  return otherApp ? { kind: 'other-app' } : { kind: 'not-a-link' }
}

// ---------------------------------------------------------------------------------------------------------------------
// The group file, read entry by entry (the YAZ-5191 rule).

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const shown = (v: unknown, fallback: string): string => (typeof v === 'string' ? v.slice(0, SHOWN_MAX) : fallback)
const memberOk = (e: unknown): e is Record<string, unknown> => isObject(e) && isGistId(e.pointer)

/**
 * The group file from its text. Each member is read alone: one this app cannot read is left out of `value` and kept in
 * the file on each write (`groupFileText`). Only a file that is not a JSON object with `v: 1` (or over 256 KB) is
 * `unreadable`: then nothing is written to it. A `v` above 1 is `newer`.
 */
export function parseGroupFile(text: string | null | undefined): FileState<GroupFile> {
  if (typeof text !== 'string') return { kind: 'unreadable', why: 'the file is missing' }
  if (text.length > 256 * 1024) return { kind: 'unreadable', why: 'the file is too large' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'unreadable', why: 'the file is not JSON' }
  }
  if (!isObject(raw)) return { kind: 'unreadable', why: 'the file is not an object' }
  if (typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v > 1) return { kind: 'newer' }
  if (raw.v !== 1) return { kind: 'unreadable', why: 'the file has another version' }
  // YAZ-5241: a field there with the wrong shape makes the file unreadable, never an empty value that a write saves.
  if ('members' in raw && !Array.isArray(raw.members)) return { kind: 'unreadable', why: 'members is not a list' }
  for (const key of ['name', 'admin'] as const) if (key in raw && typeof raw[key] !== 'string') return { kind: 'unreadable', why: `${key} is not a text` }
  const members = (Array.isArray(raw.members) ? raw.members : []).filter(memberOk).map((m) => ({ login: shown(m.login, ''), pointer: (m.pointer as string).toLowerCase() }))
  return { kind: 'ok', value: { v: 1, name: shown(raw.name, 'Group'), admin: shown(raw.admin, ''), members }, raw }
}

/** The text of a group file to write: the known fields over the unknown ones; each member keeps its own; bad ones stay. */
export function groupFileText(file: GroupFile, raw: Record<string, unknown> = {}): string {
  const rawMembers = Array.isArray(raw.members) ? (raw.members as unknown[]) : []
  const members = file.members.map((m) => {
    const r = rawMembers.find((x) => memberOk(x) && (x.pointer as string).toLowerCase() === m.pointer) as Record<string, unknown> | undefined
    if (r === undefined) return m
    return { ...r, ...m, login: m.login === shown(r.login, '') ? r.login : m.login, pointer: r.pointer }
  })
  const name = file.name === shown(raw.name, 'Group') && raw.name !== undefined ? raw.name : file.name
  const admin = file.admin === shown(raw.admin, '') && raw.admin !== undefined ? raw.admin : file.admin
  return JSON.stringify({ ...raw, ...file, name, admin, members: [...members, ...rawMembers.filter((x) => !memberOk(x))] })
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers.

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

class Stop extends Error {
  constructor(readonly kind: 'needs-repair' | 'newer-app' | 'not-found') {
    super(kind)
  }
}

/** My friends list as it is on GitHub now. A list that cannot be read stops the action (YAZ-5191). */
async function freshList(api: GistsApi, handle: IndexHandle, opts: ListOptions): Promise<IndexHandle> {
  let gist: GistDoc | 'unchanged'
  try {
    gist = await api.read(handle.id)
  } catch (err) {
    if (gistErrorCode(err) !== 'NOT_FOUND') throw err
    const found = await findFriendsIndex(api, opts)
    if (found.kind === 'ok') return found.handle
    throw new Stop(found.kind === 'newer' ? 'newer-app' : found.kind === 'broken' ? 'needs-repair' : 'not-found')
  }
  if (gist === 'unchanged') return handle
  const read = parseFriendsIndex(fileText(gist, INDEX_FILE))
  if (read.kind === 'newer') throw new Stop('newer-app')
  if (read.kind === 'unreadable') throw new Stop('needs-repair')
  return { ...handle, index: read.value, raw: read.raw, etag: gist.etag }
}

type Failure = { kind: 'offline' } | { kind: 'rate-limited'; retryAt: number | null } | { kind: 'refused' } | { kind: 'unauthorized' } | { kind: 'failed' }

function failure(err: unknown): Failure | { kind: 'needs-repair' } | { kind: 'newer-app' } | { kind: 'not-found' } {
  if (err instanceof Stop) return { kind: err.kind }
  switch (gistErrorCode(err)) {
    case 'OFFLINE':
    case 'GITHUB_DOWN':
      return { kind: 'offline' }
    case 'RATE_LIMITED':
      return { kind: 'rate-limited', retryAt: gistErrorResetAt(err) }
    case 'READ_ONLY':
      return { kind: 'refused' }
    case 'UNAUTHORIZED':
      return { kind: 'unauthorized' }
    case null:
      throw err
    default:
      return { kind: 'failed' }
  }
}

/** Reads a group gist: its file, or why not. A 404 is `not-found`. */
async function readGroupGist(api: GistsApi, group: string, etag: string | null = null): Promise<{ kind: 'ok'; gist: GistDoc | 'unchanged' } | { kind: 'not-found' }> {
  try {
    return { kind: 'ok', gist: await api.read(group, etag) }
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return { kind: 'not-found' }
    throw err
  }
}

/** The login and the name behind a pointer (from the numbers it names), or null when it is not a pointer. */
async function whoIs(api: GistsApi, pointer: string): Promise<{ login: string; name: string } | 'not-found' | 'not-a-pointer' | 'newer-app'> {
  let gist: GistDoc | 'unchanged'
  try {
    gist = await api.read(pointer)
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return 'not-found'
    throw err
  }
  if (gist === 'unchanged') return 'not-a-pointer'
  const p = readPointerFile(fileText(gist, POINTER_FILE))
  if (p.kind === 'newer') return 'newer-app'
  if (p.kind !== 'ok') return 'not-a-pointer'
  try {
    const numbers = await api.read(p.value.stats)
    if (numbers === 'unchanged') return { login: '', name: 'Friend' }
    const s = readStatsFile(fileText(numbers, NUMBERS_FILE))
    if (s.kind !== 'ok') return { login: '', name: 'Friend' }
    return { login: s.value.login, name: s.value.name.trim() || s.value.login || 'Friend' }
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return { login: '', name: 'Friend' }
    throw err
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Create and join.

export type CreateResult = { kind: 'ok'; handle: IndexHandle; group: string; link: string } | { kind: 'bad-name' } | { kind: 'needs-repair' } | { kind: 'newer-app' } | { kind: 'not-found' } | Failure

/**
 * "New group" (in "+ Add"): my pointer for the group, the group file (me as its admin and first member), then the group
 * in my list. A stop between the steps leaves gists that no list names; `sweepOrphans` deletes them an hour later.
 */
export async function createGroup(api: GistsApi, handle: IndexHandle, name: string, login: string, opts: ListOptions): Promise<CreateResult> {
  const clean = cleanGroupName(name)
  if (clean === null) return { kind: 'bad-name' }
  try {
    let base = await freshList(api, handle, opts)
    if (base.index.stats === null) return { kind: 'failed' }
    const pointer = await makePointer(api, base.index.stats, opts)
    await opts.sleep(1000)
    const file: GroupFile = { v: 1, name: clean, admin: login, members: [{ login, pointer }] }
    const made = await api.create(opts.describe('index').replace(/index|friends list/gi, 'group'), { [GROUP_FILE]: groupFileText(file) })
    await opts.sleep(1000)
    base = await freshList(api, base, opts)
    const next = await writeFriendsIndex(api, base, { ...base.index, groups: [...base.index.groups, { name: clean, group: made.id, mine: pointer, admin: true, joined: true }] })
    return { kind: 'ok', handle: next, group: made.id, link: groupLink(made.id) }
  } catch (err) {
    return failure(err)
  }
}

export type JoinResult =
  /** Now send `sendToAdmin` to the admin: their app adds me. */
  | { kind: 'joined'; name: string; group: string; sendToAdmin: string; handle: IndexHandle }
  | { kind: 'already'; name: string; sendToAdmin: string | null }
  | { kind: 'own-group'; name: string }
  | { kind: 'is-friend-link' }
  | { kind: 'is-join-request' }
  | { kind: 'not-found' }
  | { kind: 'not-a-group-link' }
  | { kind: 'needs-repair' }
  | { kind: 'newer-app' }
  | { kind: 'empty' }
  | { kind: 'other-app' }
  | { kind: 'not-a-link' }
  | Failure

/** Join a group with its link: my pointer for it, and the group in my list. The admin adds me (`addMember`). */
export async function joinGroup(api: GistsApi, handle: IndexHandle, text: string, opts: ListOptions): Promise<JoinResult> {
  const link = parseAnyLink(text)
  if (link.kind === 'friend') return { kind: 'is-friend-link' }
  if (link.kind === 'join') return { kind: 'is-join-request' }
  if (link.kind !== 'group' && link.kind !== 'id') return link
  const group = link.id
  try {
    let base = await freshList(api, handle, opts)
    const known = base.index.groups.find((g) => g.group === group)
    if (known !== undefined) return known.admin ? { kind: 'own-group', name: known.name } : { kind: 'already', name: known.name, sendToAdmin: known.joined ? null : joinLink(group, known.mine) }
    const read = await readGroupGist(api, group)
    if (read.kind === 'not-found') return { kind: 'not-found' }
    if (read.gist === 'unchanged') return { kind: 'failed' }
    if (fileText(read.gist, GROUP_FILE) === null) return read.gist.files[POINTER_FILE] !== undefined ? { kind: 'is-friend-link' } : { kind: 'not-a-group-link' }
    const file = parseGroupFile(fileText(read.gist, GROUP_FILE))
    if (file.kind === 'newer') return { kind: 'newer-app' }
    if (file.kind === 'unreadable') return { kind: 'needs-repair' }
    if (base.index.stats === null) return { kind: 'failed' }
    const pointer = await makePointer(api, base.index.stats, opts)
    await opts.sleep(1000)
    base = await freshList(api, base, opts)
    const next = await writeFriendsIndex(api, base, { ...base.index, groups: [...base.index.groups, { name: file.value.name, group, mine: pointer, admin: false }] })
    return { kind: 'joined', name: file.value.name, group, sendToAdmin: joinLink(group, pointer), handle: next }
  } catch (err) {
    return failure(err)
  }
}

/** Plain words for a join result (4E4 shows them). */
export function joinMessage(result: JoinResult): string {
  switch (result.kind) {
    case 'joined':
      return `You asked to join ${result.name}. Send your join link to the group's admin: their app adds you.`
    case 'already':
      return result.sendToAdmin === null ? `You are already in ${result.name}.` : `You asked to join ${result.name}. Send your join link to the group's admin.`
    case 'own-group':
      return `You run ${result.name}. Send its link to the people you want in it.`
    case 'is-friend-link':
      return "That is a friend's link, not a group link. Paste it in Paste a friend's link."
    case 'is-join-request':
      return 'That is a request to join one of your groups. Open the group and tap Add member.'
    case 'not-found':
      return 'That group is gone, or the link is wrong. Ask the admin for the link again.'
    case 'not-a-group-link':
    case 'not-a-link':
      return 'That is not a Notecards group link. Ask the admin to send it again.'
    case 'other-app':
      return "That link is from another app. Paste the link from the admin's Notecards."
    case 'empty':
      return 'Paste the group link that the admin sent you.'
    case 'needs-repair':
      return "That group's file cannot be read. Ask the admin to fix it."
    case 'newer-app':
      return 'The admin has a newer Notecards. Update this app, then paste the link again.'
    case 'offline':
      return 'No connection. Try again when you are online.'
    case 'rate-limited':
      return 'GitHub asks the app to wait. Try again in a few minutes.'
    case 'refused':
      return 'Friends needs the Gists permission on your token.'
    case 'unauthorized':
      return 'Sign in again, then paste the link.'
    default:
      return 'Something went wrong. Try again.'
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The admin: who asks to join, add, remove.

export type JoinRequest =
  | { kind: 'request'; group: string; groupName: string; pointer: string; login: string; name: string }
  | { kind: 'already-member'; name: string }
  | { kind: 'not-your-group' }
  | { kind: 'not-a-join-link' }
  | { kind: 'not-found' }
  | { kind: 'needs-repair' }
  | { kind: 'newer-app' }
  | Failure

/** Reads a join link that a person sent the admin: who asks, for which of my groups (the admin's view before Add). */
export async function readJoinRequest(api: GistsApi, handle: IndexHandle, text: string): Promise<JoinRequest> {
  const link = parseAnyLink(text)
  if (link.kind !== 'join') return { kind: 'not-a-join-link' }
  try {
    const mine = handle.index.groups.find((g) => g.group === link.group && g.admin)
    if (mine === undefined) return { kind: 'not-your-group' }
    const read = await readGroupGist(api, link.group)
    if (read.kind === 'not-found' || read.gist === 'unchanged') return { kind: 'not-found' }
    const file = parseGroupFile(fileText(read.gist, GROUP_FILE))
    if (file.kind === 'newer') return { kind: 'newer-app' }
    if (file.kind === 'unreadable') return { kind: 'needs-repair' }
    const who = await whoIs(api, link.pointer)
    if (who === 'not-found') return { kind: 'not-found' }
    if (who === 'newer-app') return { kind: 'newer-app' }
    if (who === 'not-a-pointer') return { kind: 'not-a-join-link' }
    if (file.value.members.some((m) => m.pointer === link.pointer)) return { kind: 'already-member', name: who.name }
    return { kind: 'request', group: link.group, groupName: file.value.name, pointer: link.pointer, login: who.login, name: who.name }
  } catch (err) {
    const f = failure(err)
    return f.kind === 'not-found' ? { kind: 'not-found' } : f
  }
}

export type GroupChange =
  | { kind: 'done'; file: GroupFile }
  | { kind: 'not-admin' }
  | { kind: 'not-found' }
  | { kind: 'not-a-member' }
  | { kind: 'not-a-join-link' }
  | { kind: 'needs-repair' }
  | { kind: 'newer-app' }
  | Failure

/** Reads my group file for a change, as its admin; a file that cannot be read stops the change (never written over). */
async function adminFile(api: GistsApi, handle: IndexHandle, group: string): Promise<{ file: GroupFile; raw: Record<string, unknown> } | GroupChange> {
  if (!handle.index.groups.some((g) => g.group === group && g.admin)) return { kind: 'not-admin' }
  const read = await readGroupGist(api, group)
  if (read.kind === 'not-found' || read.gist === 'unchanged') return { kind: 'not-found' }
  const state = parseGroupFile(fileText(read.gist, GROUP_FILE))
  if (state.kind === 'newer') return { kind: 'newer-app' }
  if (state.kind === 'unreadable') return { kind: 'needs-repair' }
  return { file: state.value, raw: state.raw }
}

/** The admin adds the person of a join link (decision 18). A person who joins again with a new pointer replaces the old one. */
export async function addMember(api: GistsApi, handle: IndexHandle, group: string, joinText: string, opts: ListOptions): Promise<GroupChange> {
  try {
    if (!handle.index.groups.some((g) => g.group === group && g.admin)) return { kind: 'not-admin' }
    const link = parseAnyLink(joinText)
    if (link.kind !== 'join' || link.group !== group) return { kind: 'not-a-join-link' }
    const who = await whoIs(api, link.pointer)
    if (who === 'not-found') return { kind: 'not-found' }
    if (who === 'newer-app') return { kind: 'newer-app' }
    if (who === 'not-a-pointer') return { kind: 'not-a-join-link' }
    const current = await adminFile(api, handle, group)
    if ('kind' in current) return current
    const others = current.file.members.filter((m) => m.pointer !== link.pointer && (who.login === '' || m.login !== who.login))
    const file: GroupFile = { ...current.file, members: [...others, { login: who.login, pointer: link.pointer }] }
    await api.update(group, { [GROUP_FILE]: groupFileText(file, current.raw) })
    void opts
    return { kind: 'done', file }
  } catch (err) {
    return failure(err)
  }
}

/** The admin removes a member (round 14), by the member's pointer. The member's app then leaves by itself. */
export async function removeMember(api: GistsApi, handle: IndexHandle, group: string, pointer: string, opts: ListOptions): Promise<GroupChange> {
  try {
    const current = await adminFile(api, handle, group)
    if ('kind' in current) return current
    const mine = handle.index.groups.find((g) => g.group === group)?.mine
    if (pointer === mine) return { kind: 'not-admin' } // the admin's way out is "Delete group"
    if (!current.file.members.some((m) => m.pointer === pointer)) return { kind: 'not-a-member' }
    const file: GroupFile = { ...current.file, members: current.file.members.filter((m) => m.pointer !== pointer) }
    await api.update(group, { [GROUP_FILE]: groupFileText(file, current.raw) })
    void opts
    return { kind: 'done', file }
  } catch (err) {
    return failure(err)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Leave, delete.

export type LeaveResult = RemoveResult | { kind: 'admin-cannot-leave' } | { kind: 'not-found' }

/**
 * "Leave group", and what the app does after "removed" or "gone": my pointer goes, the group leaves my list, and a new
 * numbers gist cuts the others off (4E2's safe steps; the next start finishes a stop). The admin cannot leave.
 */
export async function leaveGroup(api: GistsApi, handle: IndexHandle, group: string, budget: GistBudget, opts: ListOptions): Promise<LeaveResult> {
  const entry = handle.index.groups.find((g) => g.group === group)
  if (entry === undefined) return { kind: 'not-found' }
  if (entry.admin) return { kind: 'admin-cannot-leave' }
  return removeFriend(api, handle, entry.mine, budget, opts)
}

/** "Delete group" (the admin's "Leave"): the same safe steps, and the group file is deleted with my pointer. */
export async function deleteGroup(api: GistsApi, handle: IndexHandle, group: string, budget: GistBudget, opts: ListOptions): Promise<LeaveResult> {
  const entry = handle.index.groups.find((g) => g.group === group && g.admin)
  if (entry === undefined) return { kind: 'not-found' }
  return removeFriend(api, handle, entry.mine, budget, opts, { drop: [group] })
}

/**
 * Deletes my gists that no list names (a stop between the steps of create, join or paste). YAZ-5238: only what is
 * PROVABLY an orphan, and nothing at all when in doubt:
 * (a) it is ours: the file name AND a content that reads as our exact format (a look-alike stays);
 * (b) no list names it: the friends list and each group file of mine (any of my gists that holds one) are read FRESH,
 *     right before the deletes; a group file with a member other than its admin is in use and stays (a lost write of
 *     the list can leave a group that people joined);
 * (c) GitHub's clock says it is older than `minAge`: its `created_at` against GitHub's time of the same answers
 *     (`api.serverTime()`), never the device clock (`_deviceNow` is not used);
 * (d) any read that fails, a list that needs repair, a remove that waits, or no GitHub time: delete NOTHING.
 * Returns the deleted IDs.
 */
export async function sweepOrphans(api: GistsApi, handle: IndexHandle, _deviceNow?: number, minAge = ORPHAN_AGE_MS): Promise<string[]> {
  const out: string[] = []
  try {
    const items = await api.list()
    const serverNow = api.serverTime?.() ?? null
    if (serverNow === null || !Number.isFinite(serverNow)) return []
    const listNow = async (): Promise<IndexHandle | null> => {
      const gist = await api.read(handle.id)
      if (gist === 'unchanged') return null
      const read = parseFriendsIndex(fileText(gist, INDEX_FILE))
      if (read.kind !== 'ok') return null
      const h = { ...handle, index: read.value, raw: read.raw, etag: gist.etag }
      return pendingRemove(h) === null ? h : null
    }
    const list = await listNow()
    if (list === null) return []
    const named = new Set<string>([handle.id, ...(list.index.stats ? [list.index.stats] : []), ...pointersOf(list.index), ...list.index.groups.map((g) => g.group)])
    // Each of my gists with one of our files, read fresh.
    const files = new Map<string, GistDoc>()
    for (const g of items.filter((x) => x.files.some((f) => f === POINTER_FILE || f === GROUP_FILE || f === NUMBERS_FILE))) {
      const gist = await api.read(g.id)
      if (gist === 'unchanged') return []
      files.set(g.id, gist)
    }
    const old = (gist: GistDoc) => {
      const made = Date.parse(gist.createdAt)
      return Number.isFinite(made) && serverNow - made >= minAge
    }
    // A group file that stays (the list names it, it is in use, it is new, or it is not provably ours) names its members'
    // pointers too. A group file that is itself an orphan does not keep its own pointer.
    for (const [id, gist] of files) {
      if (fileText(gist, GROUP_FILE) === null) continue
      const goes = !named.has(id) && old(gist) && isOurs(gist)
      if (goes) continue
      const file = parseGroupFile(fileText(gist, GROUP_FILE))
      if (file.kind === 'ok') for (const m of file.value.members) named.add(m.pointer)
    }
    const orphans: string[] = []
    for (const [id, gist] of files) if (!named.has(id) && old(gist) && isOurs(gist)) orphans.push(id)
    if (orphans.length === 0) return []
    // Right before the deletes: the list once more, fresh. A change, a failed read or a waiting remove: nothing goes.
    const again = await listNow()
    if (again === null) return []
    const stillNamed = new Set([...pointersOf(again.index), ...(again.index.stats ? [again.index.stats] : []), ...again.index.groups.map((g) => g.group)])
    for (const id of orphans) {
      if (stillNamed.has(id)) continue
      await removeQuietly(api, id)
      out.push(id)
    }
    return out
  } catch (err) {
    if (gistErrorCode(err) === null) throw err
    return out
  }
}

/** The gist holds exactly one of our files, and it reads as our format; a group file only with its admin (not in use). */
function isOurs(gist: GistDoc): boolean {
  const names = Object.keys(gist.files)
  if (names.length !== 1) return false
  const [name] = names
  const text = fileText(gist, name)
  if (name === POINTER_FILE) return readPointerFile(text).kind === 'ok'
  if (name === NUMBERS_FILE) return readStatsFile(text).kind === 'ok'
  if (name === GROUP_FILE) {
    const file = parseGroupFile(text)
    return file.kind === 'ok' && file.value.members.every((m) => m.login === file.value.admin)
  }
  return false
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a group, the daily mark, the group streak.

export type DailyMark = 'not-started' | 'started' | 'done'

/** Decision 25 for one person and the reader's day: ✓ done, ◐ started, ○ not started; null when the numbers have no such day. */
export function dailyMark(stats: Pick<FriendStats, 'days' | 'totals'>, today: string): DailyMark | null {
  const d = stats.days.find((x) => x.day === today)
  if (d === undefined) return null
  if (d.done) return 'done'
  return d.cards > 0 ? 'started' : 'not-started'
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The reader's local day, `2026-11-14` (decision 9: each device's own day). */
export const localDay = (now: number): string => {
  const d = new Date(now)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dayBefore = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d - 1))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/**
 * The group streak (round 10, addition 13): the days in a row, up to the reader's `today`, that EVERY member finished
 * their due cards. Each member's days are their own local days (decision 9), so a day is matched by its date:
 * - The two newest days (today and yesterday) may wait: a member who has not finished their own today, or who has not
 *   reached the date yet (another time zone), does not stop the streak there; that day just does not count yet.
 * - Any other day stops the streak unless every member has it and finished it. A member who stopped sending stops it.
 * Pure. Nobody, or a member with no day at all: 0.
 */
export function groupStreak(members: readonly { days: readonly FriendDay[] }[], today: string): number {
  if (members.length === 0) return 0
  let streak = 0
  let date = today
  for (let walked = 0; walked < 90; walked++, date = dayBefore(date)) {
    let all = true
    let wait = false
    for (const m of members) {
      const newest = m.days[0]?.day
      if (newest === undefined) return 0
      const entry = m.days.find((d) => d.day === date)
      if (entry?.done) continue
      all = false
      const pending = (entry !== undefined && date === newest) || (entry === undefined && date > newest)
      if (walked < 2 && pending) wait = true
      else return streak
    }
    if (all) streak++
    else if (!wait) return streak
  }
  return streak
}

/**
 * One member as 4E4 shows it. `left`: their pointer is gone (they left): no numbers; the admin's label is
 * "Left the group" (the admin can then remove the row). `me`: my own row. `admin`: the group's admin.
 */
export interface GroupMemberRow {
  login: string
  name: string
  pointer: string
  me: boolean
  admin: boolean
  state: 'ok' | 'left' | 'no-numbers' | 'newer-app' | 'unreadable' | 'offline'
  read: FriendRead | null
  label: string | null
  mark: DailyMark | null
}

/**
 * A group as I see it:
 * - `ok`: I am in it; each member's row, and the group streak (of the members whose numbers could be read).
 * - `waiting`: I joined, and the admin has not added me yet: send `sendToAdmin` to the admin.
 * - `removed`: the admin removed me ("You're no longer in this group"): the app leaves (`leaveGroup`).
 * - `gone`: the group file is deleted ("This group is gone"): the app leaves.
 * - `needs-repair`: the file cannot be read; nothing is written. `newer-app`: a newer app wrote it.
 * - `offline`: no answer, and nothing read before.
 */
export type GroupView =
  /** `firstSeen`: I see myself in the file for the first time: call `markJoined` (then "not in it" later means removed). */
  | { kind: 'ok'; group: string; name: string; admin: string; iAmAdmin: boolean; members: GroupMemberRow[]; streak: number; firstSeen: boolean }
  | { kind: 'waiting'; group: string; name: string; sendToAdmin: string }
  | { kind: 'removed'; group: string; name: string }
  | { kind: 'gone'; group: string; name: string }
  | { kind: 'needs-repair'; group: string; name: string }
  | { kind: 'newer-app'; group: string; name: string }
  | { kind: 'offline'; group: string; name: string }
  /** YAZ-5236: my leave (or "Delete group") of this group waits; it finishes by itself. "Removing…" */
  | { kind: 'removing'; group: string; name: string }
  | { kind: 'not-found' }

/** Plain words for a group view that is not `ok` (round 14), or null. */
export function groupViewMessage(view: GroupView): string | null {
  switch (view.kind) {
    case 'waiting':
      return 'Waiting for the admin to add you. Send them your join link.'
    case 'removed':
      return "You're no longer in this group."
    case 'gone':
      return 'This group is gone.'
    case 'needs-repair':
      return "This group's file cannot be read. Ask the admin to fix it."
    case 'newer-app':
      return 'This group needs a newer app. Update Notecards.'
    case 'offline':
      return 'No connection.'
    case 'removing':
      return 'Removing…'
    default:
      return null
  }
}

/** Reads one of my groups: the file (ETag), then each member through their pointer (ETags). Never throws for GitHub's answers. */
export async function readGroup(api: GistsApi, handle: IndexHandle, group: string, cache: ListCache, now: number): Promise<GroupView> {
  const entry = handle.index.groups.find((g) => g.group === group)
  if (entry === undefined) return { kind: 'not-found' }
  const base = { group, name: entry.name }
  let gist: GistDoc
  try {
    const kept = cache.reads.get(group)
    const copy = kept !== undefined && 'gist' in kept ? kept : undefined
    const read = await readGroupGist(api, group, copy?.etag ?? null)
    if (read.kind === 'not-found') return { kind: 'gone', ...base }
    if (read.gist === 'unchanged') {
      if (copy === undefined) return { kind: 'offline', ...base }
      gist = copy.gist
    } else {
      gist = read.gist
      cache.reads.set(group, { etag: gist.etag, gist })
    }
  } catch (err) {
    if (gistErrorCode(err) === null) throw err
    return { kind: 'offline', ...base }
  }
  const state = parseGroupFile(fileText(gist, GROUP_FILE))
  if (state.kind === 'newer') return { kind: 'newer-app', ...base }
  if (state.kind === 'unreadable') return { kind: 'needs-repair', ...base }
  const file = state.value
  if (!file.members.some((m) => m.pointer === entry.mine)) {
    if (entry.admin || entry.joined) return { kind: 'removed', ...base }
    return { kind: 'waiting', ...base, sendToAdmin: joinLink(group, entry.mine) }
  }
  const today = localDay(now)
  const rows: GroupMemberRow[] = []
  for (const m of file.members) {
    const read = await readFriend(api, m.pointer, cache.reads)
    const row: GroupMemberRow = { login: m.login, name: m.login || 'Friend', pointer: m.pointer, me: m.pointer === entry.mine, admin: m.login !== '' && m.login === file.admin, state: 'offline', read, label: null, mark: null }
    switch (read.kind) {
      case 'ok':
        row.state = 'ok'
        row.name = read.stats.name.trim() || m.login || 'Friend'
        row.mark = dailyMark(read.stats, today)
        break
      case 'gone':
        row.state = 'left'
        row.label = entry.admin ? 'Left the group' : null
        break
      case 'no-numbers':
        row.state = 'no-numbers'
        row.label = 'no update yet'
        break
      case 'newer-app':
        row.state = 'newer-app'
        row.label = 'Needs a newer app'
        break
      case 'unreadable':
        row.state = 'unreadable'
        row.label = "Can't read their numbers"
        break
      default:
        row.state = 'offline'
    }
    rows.push(row)
  }
  const numbers = rows.flatMap((r) => (r.read?.kind === 'ok' ? [r.read.stats] : []))
  return { kind: 'ok', ...base, name: file.name, admin: file.admin, iAmAdmin: entry.admin, members: rows, streak: groupStreak(numbers, today), firstSeen: !entry.admin && entry.joined !== true }
}

/** Writes in my list that I am in the group (`joined`), after `readGroup` said `firstSeen`. One `gist_update`. */
export async function markJoined(api: GistsApi, handle: IndexHandle, group: string, opts: ListOptions): Promise<IndexHandle | Failure | { kind: 'needs-repair' } | { kind: 'newer-app' } | { kind: 'not-found' }> {
  try {
    const base = await freshList(api, handle, opts)
    if (!base.index.groups.some((g) => g.group === group && g.joined !== true)) return base
    return await writeFriendsIndex(api, base, { ...base.index, groups: base.index.groups.map((g) => (g.group === group ? { ...g, joined: true as const } : g)) })
  } catch (err) {
    return failure(err)
  }
}
