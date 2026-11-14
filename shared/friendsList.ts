import {
  INDEX_FILE,
  LIST_NEEDS_REPAIR,
  NUMBERS_FILE,
  POINTER_FILE,
  emptyNumbers,
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
  relinkPointers,
  writeFriendsIndex,
  type FriendRead,
  type FriendReadCache,
  type FriendsIndex,
  type GistDoc,
  type GistsApi,
  type IndexHandle,
  type WriteOptions,
} from './friendGists'
import { mayUpdate, recordUpdate, sendGap, type GistBudget } from './friendSend'

/**
 * THE FRIENDS LIST (YAZ-5083, 4E2; decisions 14 as changed in round 16, 15, 20 and 22; round 12, items 5 and 6). Pure
 * logic on `GistsApi` (4E1), so the Mac can use it later. The screens are 4E4's.
 *
 * Add a friend is two-sided: each person shares a link and pastes the other's. A link is the ID of one POINTER gist
 * that the sharer made for that one friend. The pointer's `reads` names the pointer that its owner reads from the
 * friend. That is how the two sides pair with no question (round 12, item 5):
 * - Ali taps "Share my link": a new pointer `pA` goes in Ali's list under `shared` (no friend yet).
 * - Bea pastes `pA`. `pA` has no `reads`, so Bea makes her pointer `pB` with `reads: pA` and lists Ali with
 *   `{ theirs: pA, mine: pB }`. Bea already sees Ali's numbers; her row says "Waiting for Ali to add you" and offers
 *   her own link (`sendBack`).
 * - Ali pastes `pB`. Its `reads` is `pA`, one of Ali's shared links, so Ali lists Bea with `{ theirs: pB, mine: pA }`
 *   and writes `reads: pB` into `pA`. Both sides now show "ok".
 * If both shared first and both pasted the other's FIRST link, neither pointer says `reads` (nothing is guessed: a
 * guess could give one friend's cheers to another). Both rows say "Waiting…" with a link to send back. When either
 * side pastes that second link, the app sees the same friend (the same numbers gist), takes the pointer the friend
 * reads, and deletes the extra one. Then both sides are "ok".
 *
 * Remove (round 16): the list loses the entry, my pointer for them goes, a NEW numbers gist gets the numbers, each
 * other pointer moves to it, the old one goes. The steps are written into the list first (`rekey`), so a stop at any
 * point (the app closed, no network, the `gist_update` budget used up) is finished by the next start (`finishRemove`).
 */

/** The friend link: the landing page of the app's site (5-) with the pointer ID after `#`, which no server log sees. */
export const FRIEND_LINK_BASE = 'https://notecards.yaseenarshad.com/friend'
/** The site and its preview (round 12, item 14). A link from another host is "a link of another app". */
const SITE = 'notecards.yaseenarshad.com'
/** A gist ID: 20 (old gists) or 32 hex characters. */
const LINK_ID = /^[0-9a-f]{20,40}$/i

export const friendLink = (pointer: string, base = FRIEND_LINK_BASE): string => `${base}#${pointer.toLowerCase()}`

/** The text of the iOS share sheet ("Share my link"). */
export const shareText = (link: string): { title: string; text: string; url: string } => ({
  title: 'Notecards friend link',
  text: 'Add me as a friend on Notecards. Open this link, copy the code, then paste it in the app.',
  url: link,
})

/** Decision 22: the add step says one time what a friend sees. */
export const WHAT_FRIENDS_SEE = 'Friends see your review numbers only: cards, minutes and streaks. Never your cards or your pages.'

export type LinkRead = { kind: 'ok'; id: string } | { kind: 'empty' } | { kind: 'other-app' } | { kind: 'not-a-link' }

/**
 * A pasted text in any shape: the full link, with spaces, a trailing slash or words around it; `/friend/<id>`,
 * `?id=<id>`, the preview site; a bare ID; a gist address (`gist.github.com/<user>/<id>`, `api.github.com/gists/<id>`).
 * A link of another host is `other-app`. Never throws.
 */
export function parseFriendLink(text: string): LinkRead {
  const words = String(text ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/^[<("'[]+|[>)"'\].,;:!?]+$/g, '').replace(/\/+$/, ''))
    .filter((w) => w !== '')
  if (words.length === 0) return { kind: 'empty' }
  let otherApp = false
  for (const word of words) {
    if (LINK_ID.test(word)) return { kind: 'ok', id: word.toLowerCase() }
    const looksLikeUrl = word.includes('://') || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/#?]|$)/i.test(word)
    if (!looksLikeUrl) continue
    let url: URL
    try {
      url = new URL(word.includes('://') ? word : `https://${word}`)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    let id: string | null = null
    if (host === SITE || host.endsWith(`.${SITE}`)) {
      id = url.hash.replace(/^#/, '').replace(/\/+$/, '') || url.searchParams.get('id') || (parts[0] === 'friend' ? (parts[1] ?? null) : null)
      if (id !== null && LINK_ID.test(id)) return { kind: 'ok', id: id.toLowerCase() }
      continue
    }
    if (host === 'gist.github.com' || host === 'gist.githubusercontent.com') id = parts.find((p) => LINK_ID.test(p)) ?? null
    else if (host === 'api.github.com' && parts[0] === 'gists') id = parts[1] ?? null
    if (id !== null && LINK_ID.test(id)) return { kind: 'ok', id: id.toLowerCase() }
    otherApp = true
  }
  return otherApp ? { kind: 'other-app' } : { kind: 'not-a-link' }
}

export interface ListOptions extends WriteOptions {
  now: () => number
}

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers.

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

/** The list as it is on GitHub now (GitHub has no conditional write: read just before each write). */
async function latest(api: GistsApi, handle: IndexHandle, opts: WriteOptions): Promise<IndexHandle> {
  try {
    const gist = await api.read(handle.id)
    if (gist === 'unchanged') return handle
    const read = parseFriendsIndex(fileText(gist, INDEX_FILE))
    if (read.kind === 'ok') return { ...handle, index: read.value, raw: read.raw, etag: gist.etag }
    if (read.kind === 'newer') throw new NewerList()
    // YAZ-5191: never go on with an old copy of a list that cannot be read now: nothing is written to it.
    throw new BrokenList()
  } catch (err) {
    if (gistErrorCode(err) !== 'NOT_FOUND') throw err
    const found = await findFriendsIndex(api, opts)
    if (found.kind === 'ok') return found.handle
    if (found.kind === 'newer') throw new NewerList()
    if (found.kind === 'broken') throw new BrokenList()
    throw err
  }
}
class NewerList extends Error {}
/** The list is not a JSON object with `v: 1`: the app writes nothing to it (YAZ-5191, `LIST_NEEDS_REPAIR`). */
class BrokenList extends Error {}

/** Writes `next`; `raw` patches the fields this module keeps beside the known ones (`rekey`). */
async function writeList(api: GistsApi, handle: IndexHandle, next: FriendsIndex, raw?: Record<string, unknown>): Promise<IndexHandle> {
  return writeFriendsIndex(api, raw === undefined ? handle : { ...handle, raw }, next)
}

const isMine = (index: FriendsIndex, id: string) => pointersOf(index).includes(id)

/** Writes `reads` into one of my pointers; keeps its other fields (`mark`, and what a newer app added). */
async function setReads(api: GistsApi, pointer: string, reads: string, stats: string, held: readonly string[] = []): Promise<void> {
  const gist = await api.read(pointer)
  if (gist === 'unchanged') return
  const state = readPointerFile(fileText(gist, POINTER_FILE))
  // YAZ-5241: a pointer this app cannot read (or a newer one) is never written over.
  if (state.kind !== 'ok') return
  // YAZ-5235: `held` lists the friend's own links that I still hold (an earlier link of theirs, before the pair
  // healed). The friend's app reads it and deletes those links, and a remove of me deletes them too.
  const before = heldOf(state.raw)
  const allHeld = [...new Set([...before, ...held.filter(isGistId)])]
  if (state.value.reads === reads && allHeld.length === before.length) return
  void stats
  await api.update(pointer, { [POINTER_FILE]: JSON.stringify({ ...state.raw, v: 1, stats: state.value.stats, reads, ...(allHeld.length > 0 && { held: allHeld }) }) })
}

/** The friend's links that a pointer says its owner holds (`held`, YAZ-5235). Untrusted: gist IDs only, at most 50. */
export const heldOf = (raw: Record<string, unknown>): string[] => (Array.isArray(raw.held) ? raw.held.filter(isGistId).slice(0, 50).map((x) => x.toLowerCase()) : [])

/** The raw pointer behind `theirs` (a fresh read, or the reader's cached copy), or null when it cannot be read now. */
async function theirRaw(api: GistsApi, theirs: string): Promise<Record<string, unknown> | null> {
  try {
    const gist = await api.read(theirs)
    if (gist === 'unchanged') return null
    const state = readPointerFile(fileText(gist, POINTER_FILE))
    return state.kind === 'ok' ? state.raw : null
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return null
    throw err
  }
}

/**
 * YAZ-5235: deletes my shared links that a friend says it holds (`held` in the pointer it gives me), and takes them out
 * of `shared`. That friend has paired with another of my pointers, so nobody uses them, and a remove of that friend
 * must not leave them leading to my numbers.
 */
export async function dropHeldShares(api: GistsApi, handle: IndexHandle, ids: readonly string[], opts: ListOptions): Promise<IndexHandle> {
  let base = await latest(api, handle, opts)
  const drop = (base.index.shared ?? []).filter((x) => ids.includes(x.mine)).map((x) => x.mine)
  if (drop.length === 0) return base
  base = await writeList(api, base, { ...base.index, shared: (base.index.shared ?? []).filter((x) => !drop.includes(x.mine)) })
  for (const id of drop) await removeQuietly(api, id)
  return base
}

/** The ID of the friend's numbers gist behind one of their pointers, or null when it cannot be read now. */
async function statsBehind(api: GistsApi, pointer: string): Promise<string | null> {
  try {
    const gist = await api.read(pointer)
    if (gist === 'unchanged') return null
    const state = readPointerFile(fileText(gist, POINTER_FILE))
    return state.kind === 'ok' ? state.value.stats : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Share and paste.

/** "Share my link": a new pointer for ONE friend, kept under `shared` until that friend's link is pasted. */
export async function shareLink(api: GistsApi, handle: IndexHandle, opts: ListOptions): Promise<{ handle: IndexHandle; pointer: string; link: string }> {
  const base = await latest(api, handle, opts)
  if (base.index.stats === null) throw new Error('The list has no numbers gist')
  const pointer = await makePointer(api, base.index.stats, opts)
  await opts.sleep(1000)
  const shared = [...(base.index.shared ?? []), { mine: pointer, at: new Date(opts.now()).toISOString() }]
  const next = await writeList(api, base, { ...base.index, shared })
  return { handle: next, pointer, link: friendLink(pointer) }
}

export type PasteResult =
  /** `paired`: the friend already reads my pointer. Else send `sendBack` (my link for them) so they can add me. */
  | { kind: 'added'; name: string; paired: boolean; sendBack: string | null; handle: IndexHandle }
  | { kind: 'already'; name: string }
  | { kind: 'empty' }
  | { kind: 'not-a-link' }
  | { kind: 'other-app' }
  | { kind: 'own-link' }
  | { kind: 'not-found' }
  | { kind: 'not-a-friend-link' }
  | { kind: 'newer-app' }
  /** My own friends list cannot be read: nothing is changed (YAZ-5191). */
  | { kind: 'needs-repair' }
  | { kind: 'offline' }
  | { kind: 'rate-limited'; retryAt?: number | null }
  | { kind: 'refused' }
  | { kind: 'unauthorized' }
  | { kind: 'failed' }

/** Plain words for a paste result (4E4 shows them). */
export function pasteMessage(result: PasteResult): string {
  switch (result.kind) {
    case 'added':
      return result.paired ? `${result.name} is now your friend.` : `${result.name} is added. Send them your link, so they can add you too.`
    case 'already':
      return `${result.name} is already in your friends.`
    case 'empty':
      return 'Paste the link that your friend sent you.'
    case 'not-a-link':
    case 'not-a-friend-link':
      return 'That is not a Notecards friend link. Ask your friend to tap Share my link and send it again.'
    case 'other-app':
      return "That link is from another app. Paste the link from your friend's Notecards."
    case 'own-link':
      return 'That is your own link. Send it to a friend, and paste the link they send you.'
    case 'not-found':
      return 'That link does not work any more. Ask your friend for a new one.'
    case 'newer-app':
      return 'Your friend has a newer Notecards. Update this app, then paste the link again.'
    case 'offline':
      return 'No connection. Try again when you are online.'
    case 'rate-limited':
      return 'GitHub asks the app to wait. Try again in a few minutes.'
    case 'refused':
      return 'Friends needs the Gists permission on your token.'
    case 'needs-repair':
      return LIST_NEEDS_REPAIR
    case 'unauthorized':
      return 'Sign in again, then paste the link.'
    default:
      return 'Something went wrong. Try again.'
  }
}

/** A thrown gist failure as a paste result. */
function failureResult(err: unknown): PasteResult {
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
      if (err instanceof NewerList) return { kind: 'newer-app' }
      if (err instanceof BrokenList) return { kind: 'needs-repair' }
      throw err
    default:
      return { kind: 'failed' }
  }
}

/** "Paste a friend's link" (decision 20). The list must exist (`ensureFriendsFiles`). */
export async function pasteLink(api: GistsApi, handle: IndexHandle, text: string, opts: ListOptions): Promise<PasteResult> {
  const link = parseFriendLink(text)
  if (link.kind !== 'ok') return link
  const id = link.id
  try {
    let base = await latest(api, handle, opts)
    const index = base.index
    if (id === base.id || id === index.stats || isMine(index, id)) return { kind: 'own-link' }

    let gist: GistDoc | 'unchanged'
    try {
      gist = await api.read(id)
    } catch (err) {
      if (gistErrorCode(err) === 'NOT_FOUND') return { kind: 'not-found' }
      throw err
    }
    if (gist === 'unchanged') return { kind: 'failed' }
    const pointer = readPointerFile(fileText(gist, POINTER_FILE))
    if (pointer.kind === 'newer') return { kind: 'newer-app' }
    if (pointer.kind === 'unreadable') return { kind: 'not-a-friend-link' }
    const theirStats = pointer.value.stats
    // A pointer of my own account (my other device's link, not in this list yet) names my numbers gist.
    if (theirStats === index.stats) return { kind: 'own-link' }
    const name = await friendName(api, theirStats)
    const reads = pointer.value.reads
    const shared = index.shared ?? []
    const readsMyShare = reads !== undefined && shared.some((s) => s.mine === reads)

    // The same friend already in the list: by the pointer, or by their numbers gist (a second link of theirs).
    let same = index.friends.find((f) => f.theirs === id)
    if (same === undefined)
      for (const f of index.friends) {
        if ((await statsBehind(api, f.theirs)) === theirStats) {
          same = f
          break
        }
      }

    if (same !== undefined) {
      if (same.theirs === id && (reads === undefined || reads === same.mine || !readsMyShare)) return { kind: 'already', name: same.name }
      // They read one of my shared links: take it as my pointer for them, and drop the extra one.
      const mine = readsMyShare ? reads! : same.mine
      // Their earlier link (`same.theirs`) stays with me unused: tell them in `held`, so their app deletes it.
      await setReads(api, mine, id, index.stats!, same.theirs !== id ? [same.theirs] : [])
      base = await latest(api, base, opts)
      const friends = base.index.friends.map((f) => (f === same || f.mine === same!.mine ? { ...f, theirs: id, mine, ...(reads === mine && { paired: true as const }) } : f))
      const next = await writeList(api, base, { ...base.index, friends, shared: (base.index.shared ?? []).filter((s) => s.mine !== mine) })
      if (mine !== same.mine) await removeQuietly(api, same.mine)
      return { kind: 'added', name: same.name, paired: reads === mine, sendBack: reads === mine ? null : friendLink(mine), handle: next }
    }

    // A new friend. If they read one of my shared links, that link is my pointer for them; else make one.
    let mine: string
    if (readsMyShare) {
      mine = reads!
      await setReads(api, mine, id, index.stats!)
    } else {
      mine = await makePointer(api, index.stats!, opts, { reads: id })
    }
    await opts.sleep(1000)
    base = await latest(api, base, opts)
    const next = await writeList(api, base, {
      ...base.index,
      friends: [...base.index.friends.filter((f) => f.theirs !== id), { name, theirs: id, mine, ...(readsMyShare && { paired: true as const }) }],
      shared: (base.index.shared ?? []).filter((s) => s.mine !== mine),
    })
    const paired = readsMyShare
    return { kind: 'added', name, paired, sendBack: paired ? null : friendLink(mine), handle: next }
  } catch (err) {
    return failureResult(err)
  }
}

/** The friend's name from their numbers (the nickname or the GitHub name), or "Friend". */
async function friendName(api: GistsApi, statsId: string): Promise<string> {
  try {
    const gist = await api.read(statsId)
    if (gist === 'unchanged') return 'Friend'
    const stats = readStatsFile(fileText(gist, NUMBERS_FILE))
    if (stats.kind !== 'ok') return 'Friend'
    return stats.value.name.trim() || stats.value.login.trim() || 'Friend'
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return 'Friend'
    throw err
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The rows (4E4 draws them).

/**
 * One friend as 4E4 shows it:
 * - `ok`: paired; `read` has the numbers.
 * - `waiting`: they have not added me yet (their pointer does not read mine). Their numbers show; `sendBack` is my link
 *   to send them. Label "Waiting for <name> to add you".
 * - `gone`: their pointer is deleted: they removed me (round 12, item 6). Grey, "No longer shares with you", with a
 *   Remove button. Nothing is deleted automatically. GitHub is asked again at most each `GONE_RECHECK_MS`.
 * - `no-numbers`: their numbers gist is between two IDs (they removed a friend just now). "no update yet".
 * - `newer-app`, `unreadable`: their files cannot be read by this app. `offline`: nothing read yet.
 */
export interface FriendRow {
  name: string
  theirs: string
  mine: string
  /** `removing` (YAZ-5236): my remove of this friend waits (the budget, or no connection); label "Removing…".
   *  `stopped` (YAZ-5274): I pasted their link, they never added me, and the link is gone ("This link stopped working.
   *  Share a new one."): their remove of someone ended every unused link. */
  state: 'ok' | 'waiting' | 'gone' | 'no-numbers' | 'newer-app' | 'unreadable' | 'offline' | 'removing' | 'stopped'
  read: FriendRead | null
  label: string | null
  sendBack: string | null
}

/** A gone friend is asked again only this often: no retry storm for a friend who removed me. */
export const GONE_RECHECK_MS = 60 * 60_000

export interface ListCache {
  reads: FriendReadCache
  /** Friend pointer → when it was first seen gone. */
  goneAt: Map<string, number>
}
export const newListCache = (): ListCache => ({ reads: new Map(), goneAt: new Map() })

export interface ListRows {
  rows: FriendRow[]
  /** The links I shared that no friend has used yet. */
  shared: { mine: string; link: string; at: string }[]
  /** Friends that read another of my pointers than the list says: `repairPairs` fixes the list. */
  repairs: { theirs: string; use: string }[]
  /** YAZ-5235: my shared links that a friend holds but does not use: `dropHeldShares` deletes them. */
  held: string[]
  /** YAZ-5274: friends seen paired for the first time: `markPaired` writes it in the list. */
  newlyPaired: string[]
}

/** YAZ-5274: writes `paired` for these friends (by my pointer), so a later 404 reads "No longer shares with you". */
export async function markPaired(api: GistsApi, handle: IndexHandle, mines: readonly string[], opts: ListOptions): Promise<IndexHandle> {
  const base = await latest(api, handle, opts)
  if (!base.index.friends.some((f) => mines.includes(f.mine) && f.paired !== true)) return base
  return writeList(api, base, { ...base.index, friends: base.index.friends.map((f) => (mines.includes(f.mine) ? { ...f, paired: true as const } : f)) })
}

/** Reads each friend (the pointer, then the numbers, with ETags) and gives the rows. Never throws for GitHub's answers. */
export async function readFriends(api: GistsApi, handle: IndexHandle, cache: ListCache, now: number): Promise<ListRows> {
  const index = handle.index
  const shared = index.shared ?? []
  const rows: FriendRow[] = []
  const repairs: ListRows['repairs'] = []
  const held: string[] = []
  const newlyPaired: string[] = []
  for (const f of index.friends) {
    const base: Pick<FriendRow, 'name' | 'theirs' | 'mine' | 'sendBack'> = { name: f.name, theirs: f.theirs, mine: f.mine, sendBack: null }
    const goneAt = cache.goneAt.get(f.theirs)
    if (goneAt !== undefined && now - goneAt < GONE_RECHECK_MS) {
      rows.push({ ...base, state: 'gone', read: { kind: 'gone' }, label: 'No longer shares with you' })
      continue
    }
    const read = await readFriend(api, f.theirs, cache.reads)
    if (read.kind === 'gone') cache.goneAt.set(f.theirs, now)
    else cache.goneAt.delete(f.theirs)
    switch (read.kind) {
      case 'ok': {
        // The newest name from their numbers (a nickname can change); the list's name until they send.
        const name = read.stats.name.trim() || f.name
        base.name = name
        const reads = read.pointer.reads
        if (reads !== undefined && reads !== f.mine && shared.some((s) => s.mine === reads)) repairs.push({ theirs: f.theirs, use: reads })
        const kept = cache.reads.get(f.theirs)
        if (kept !== undefined && 'gist' in kept) {
          const raw = readPointerFile(fileText(kept.gist, POINTER_FILE))
          if (raw.kind === 'ok') for (const id of heldOf(raw.raw)) if (shared.some((s) => s.mine === id) && !held.includes(id)) held.push(id)
        }
        const paired = reads === f.mine
        if (paired && f.paired !== true) newlyPaired.push(f.mine)
        rows.push({ ...base, state: paired ? 'ok' : 'waiting', read, label: paired ? null : `Waiting for ${name} to add you`, sendBack: paired ? null : friendLink(f.mine) })
        break
      }
      case 'gone':
        // YAZ-5274: a friend who never added me back, and whose link is gone: their remove stopped the link I pasted.
        if (f.paired === true) rows.push({ ...base, state: 'gone', read, label: 'No longer shares with you' })
        else rows.push({ ...base, state: 'stopped', read, label: 'This link stopped working. Share a new one.' })
        break
      case 'no-numbers':
        rows.push({ ...base, state: 'no-numbers', read, label: 'no update yet' })
        break
      case 'newer-app':
        rows.push({ ...base, state: 'newer-app', read, label: 'Needs a newer app' })
        break
      case 'unreadable':
        rows.push({ ...base, state: 'unreadable', read, label: "Can't read their numbers" })
        break
      default:
        rows.push({ ...base, state: 'offline', read, label: null })
    }
  }
  // YAZ-5236: the friends of a remove that waits show as "Removing…" until it is done.
  const waiting = pendingRemove(handle)
  if (waiting !== null)
    for (const [mine, name] of Object.entries(waiting.names ?? {})) {
      if (index.friends.every((f) => f.mine !== mine) && index.groups.every((g) => g.mine !== mine))
        rows.push({ name, theirs: '', mine, state: 'removing', read: null, label: 'Removing…', sendBack: null })
    }
  return { rows, shared: shared.map((s) => ({ mine: s.mine, link: friendLink(s.mine), at: s.at })), repairs, held, newlyPaired }
}

/** For each repair: the friend reads my shared link `use`, so it becomes my pointer for them; the old one goes. */
export async function repairPairs(api: GistsApi, handle: IndexHandle, repairs: ListRows['repairs'], opts: ListOptions): Promise<IndexHandle> {
  let base = handle
  for (const { theirs, use } of repairs) {
    base = await latest(api, base, opts)
    const f = base.index.friends.find((x) => x.theirs === theirs)
    if (f === undefined || !(base.index.shared ?? []).some((s) => s.mine === use)) continue
    await setReads(api, use, theirs, base.index.stats!)
    const friends = base.index.friends.map((x) => (x.theirs === theirs ? { ...x, mine: use } : x))
    base = await writeList(api, base, { ...base.index, friends, shared: (base.index.shared ?? []).filter((s) => s.mine !== use) })
    await removeQuietly(api, f.mine)
  }
  return base
}

// ---------------------------------------------------------------------------------------------------------------------
// Remove (round 16), in steps that survive a stop.

/** A remove in progress, kept in the list as `rekey` (an older app keeps the field). */
export interface Rekey {
  /** The numbers gist to replace. */
  old: string | null
  /** My pointers to delete (the removed friends', groups' or shared links'). */
  drop: string[]
  /** The new numbers gist, once made. */
  next: string | null
  at: string
  /** YAZ-5236: the names of the friends and groups in this remove, for the "Removing…" rows until it is done. */
  names?: Record<string, string>
}

export function pendingRemove(handle: IndexHandle): Rekey | null {
  const r = handle.raw.rekey
  if (typeof r !== 'object' || r === null) return null
  const o = r as Record<string, unknown>
  const id = (v: unknown) => (isGistId(v) ? v : null)
  return {
    old: id(o.old),
    drop: Array.isArray(o.drop) ? o.drop.filter(isGistId) : [],
    next: id(o.next),
    at: typeof o.at === 'string' ? o.at : '',
    names: isObj(o.names) ? Object.fromEntries(Object.entries(o.names).filter(([k, v]) => isGistId(k) && typeof v === 'string').map(([k, v]) => [k, (v as string).slice(0, 200)])) : {},
  }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const withRekey = (raw: Record<string, unknown>, rekey: Rekey | null): Record<string, unknown> => {
  const { rekey: _old, ...rest } = raw
  return rekey === null ? rest : { ...rest, rekey }
}

export type RemoveResult =
  | { kind: 'done'; handle: IndexHandle; budget: GistBudget }
  /** It stopped; the list holds what is left, and the next start (or `retryAt`) finishes it. */
  | { kind: 'paused'; handle: IndexHandle; budget: GistBudget; why: 'budget' | 'rate-limited' | 'offline' | 'refused' | 'unauthorized' | 'needs-repair'; retryAt: number | null }
  | { kind: 'not-found'; handle: IndexHandle; budget: GistBudget }

/**
 * Remove a friend, a group I am in (4E3: "Leave group"), or a shared link, by my pointer for them (`mine`). This is
 * also how sharing stops for that person (decision 22). Each `PATCH` counts on `gist_update`: one for each other
 * pointer and three for the list. A remove may use the reserve that the sender keeps for it (4E1).
 */
export async function removeFriend(
  api: GistsApi,
  handle: IndexHandle,
  mine: string,
  budget: GistBudget,
  opts: ListOptions,
  /** 4E3: more of my gists to delete in the same safe steps (the group file of "Delete group"). */
  more: { drop?: string[] } = {},
): Promise<RemoveResult> {
  return removeMany(api, handle, [mine], budget, opts, more)
}

/**
 * YAZ-5236: removes several friends, groups or shared links in ONE re-key (one new numbers gist, each other pointer
 * moved once). 30 removes in a row cost about as much as one.
 * The first write puts the remove in the list (`rekey`), so it is kept until it is done. A remove has priority over a
 * numbers update: that one write is tried also when this device's count says the hour is used up; only GitHub's own
 * "rate limit" stops it. Then the result is `paused` before any write, and the caller keeps the request (the phone:
 * `friendsRemoveQueue`) to try again.
 */
export async function removeMany(api: GistsApi, handle: IndexHandle, mines: readonly string[], budget: GistBudget, opts: ListOptions, more: { drop?: string[] } = {}): Promise<RemoveResult> {
  const now = opts.now()
  let fresh = handle
  try {
    const base = await latest(api, handle, opts)
    fresh = base
    const index = base.index
    const waiting = pendingRemove(base)
    const todo = [...new Set(mines)].filter((m) => isMine(index, m))
    if (todo.length === 0) return waiting === null ? { kind: 'not-found', handle: base, budget } : finishRemove(api, base, budget, opts)
    if (budget.blockedUntil !== null && now < budget.blockedUntil) return paused(base, budget, 'rate-limited', budget.blockedUntil)
    // YAZ-5235: my shared links that each friend says it holds go too (a friend who removed me: nothing to read).
    const heldShares: string[] = []
    for (const mine of todo) {
      const friend = index.friends.find((f) => f.mine === mine)
      const theirs = friend === undefined ? null : await theirRaw(api, friend.theirs)
      if (theirs !== null) for (const id of heldOf(theirs)) if ((index.shared ?? []).some((x) => x.mine === id) && !heldShares.includes(id)) heldShares.push(id)
    }
    const names: Record<string, string> = { ...(waiting?.names ?? {}) }
    for (const f of index.friends) if (todo.includes(f.mine)) names[f.mine] = f.name
    for (const g of index.groups) if (todo.includes(g.mine)) names[g.mine] = g.name
    const rekey: Rekey = {
      old: waiting?.old ?? index.stats,
      drop: [...(waiting?.drop ?? []), ...todo, ...heldShares, ...(more.drop ?? [])],
      next: waiting?.next ?? null,
      at: waiting?.at ?? new Date(now).toISOString(),
      names,
    }
    // YAZ-5274: every link I shared that no friend has used yet stops too: I cannot tell who holds it, and after the
    // re-key it would lead to the new numbers. A person who pasted one sees "This link stopped working".
    const unusedShares = (index.shared ?? []).map((x) => x.mine).filter((m) => !heldShares.includes(m))
    rekey.drop.push(...unusedShares.filter((m) => !rekey.drop.includes(m)))
    const gone = (m: string) => todo.includes(m) || heldShares.includes(m) || unusedShares.includes(m)
    const next: FriendsIndex = {
      ...index,
      friends: index.friends.filter((f) => !gone(f.mine)),
      groups: index.groups.filter((g) => !gone(g.mine)),
      ...(index.shared !== undefined && { shared: index.shared.filter((s) => !gone(s.mine)) }),
    }
    const written = await writeList(api, base, next, withRekey(base.raw, rekey))
    return finishRemove(api, written, recordUpdate(budget, now, null), opts)
  } catch (err) {
    // The list as last read: the caller sees which removes the list does not hold yet.
    return pauseOn(err, fresh, budget, now)
  }
}

function paused(handle: IndexHandle, budget: GistBudget, why: Extract<RemoveResult, { kind: 'paused' }>['why'], retryAt: number | null): RemoveResult {
  return { kind: 'paused', handle, budget, why, retryAt }
}

function pauseOn(err: unknown, handle: IndexHandle, budget: GistBudget, now: number): RemoveResult {
  switch (gistErrorCode(err)) {
    case 'OFFLINE':
    case 'GITHUB_DOWN':
      return paused(handle, budget, 'offline', null)
    case 'RATE_LIMITED': {
      const at = Math.max(now + 60_000, gistErrorResetAt(err) ?? 0)
      return paused(handle, { ...budget, blockedUntil: at }, 'rate-limited', at)
    }
    case 'READ_ONLY':
      return paused(handle, budget, 'refused', null)
    case 'UNAUTHORIZED':
      return paused(handle, budget, 'unauthorized', null)
    default:
      if (err instanceof NewerList) return paused(handle, budget, 'refused', null)
      if (err instanceof BrokenList) return paused(handle, budget, 'needs-repair', null)
      throw err
  }
}

/**
 * Finishes a remove that waits in the list (`rekey`). Each step can run again safely:
 * 1. delete the dropped pointers; 2. make the new numbers gist with the old numbers, and write its ID into `rekey`;
 * 3. move each pointer of the list to it (a pointer already there costs nothing); 4. delete every other numbers gist
 * of mine (the old one, and one made by a stop between 2 and its write); 5. write `stats`, and clear `rekey`.
 * The sender (4E1) does not send while a remove waits, so the removed friend's last numbers do not change.
 */
export async function finishRemove(api: GistsApi, handle: IndexHandle, budget: GistBudget, opts: ListOptions): Promise<RemoveResult> {
  const now = opts.now()
  let base = handle
  /** The numbers gist that THIS run made: the only new numbers gist it may delete (YAZ-5276). */
  let made: string | null = null
  const dropMine = async (keep: string | null) => {
    if (made !== null && made !== keep) await removeQuietly(api, made)
    made = null
  }
  try {
    base = await latest(api, handle, opts)
    let rekey = pendingRemove(base)
    if (rekey === null) return { kind: 'done', handle: base, budget }
    for (const id of rekey.drop) await removeQuietly(api, id)
    if (rekey.next === null) {
      if (!mayUpdate(budget, now, 2, 0)) return paused(base, budget, 'budget', now + sendGap(budget, now, 0))
      let text = JSON.stringify(emptyNumbers(now))
      if (rekey.old !== null)
        try {
          const old = await api.read(rekey.old)
          if (old !== 'unchanged') text = fileText(old, NUMBERS_FILE) ?? text
        } catch (err) {
          if (gistErrorCode(err) !== 'NOT_FOUND') throw err
        }
      made = (await api.create(opts.describe('numbers'), { [NUMBERS_FILE]: text })).id
      await opts.sleep(1000)
      // YAZ-5276: another device may finish the same remove now. Read the list again: if it already names a new numbers
      // gist (or the remove is done), adopt that one and delete only the one this run made.
      base = await latest(api, base, opts)
      const now2 = pendingRemove(base)
      if (now2 === null) {
        await dropMine(base.index.stats)
        return { kind: 'done', handle: base, budget }
      }
      if (now2.next !== null) {
        await dropMine(now2.next)
        rekey = now2
      } else {
        rekey = { ...now2, drop: [], next: made }
        base = await writeList(api, base, base.index, withRekey(base.raw, rekey))
        budget = recordUpdate(budget, now, null)
      }
    }
    let target = rekey.next!
    const relinkAll = async (to: string): Promise<RemoveResult | null> => {
      // YAZ-5274: only the pointers of the list as it is now (the friends and groups I still have, and links shared
      // AFTER the remove began) move to the new numbers gist. Each link made before it was dropped at its first write.
      for (const pointer of pointersOf(base.index)) {
        // Keep one update for the last write of the list.
        if (!mayUpdate(budget, now, 2, 0)) return paused(base, budget, 'budget', now + sendGap(budget, now, 0))
        const moved = await relinkPointers(api, [pointer], to, opts)
        if (moved.updated.length > 0) {
          budget = recordUpdate(budget, now, null)
          await opts.sleep(1000)
        }
      }
      return null
    }
    const stop = await relinkAll(target)
    if (stop !== null) return stop
    // Before the last write: the list once more. Another device may have finished, or chosen another new gist.
    base = await latest(api, base, opts)
    const last = pendingRemove(base)
    const agreed = last === null ? base.index.stats : last.next
    if (agreed !== null && agreed !== target) {
      const again = await relinkAll(agreed)
      if (again !== null) return again
      await dropMine(agreed)
      target = agreed
    }
    if (last === null) return { kind: 'done', handle: base, budget }
    // YAZ-5276: the old numbers gist goes only by its ID from the list, and only when it is provably ours.
    if (rekey.old !== null && rekey.old !== target) await removeIfOurNumbers(api, rekey.old)
    if (!mayUpdate(budget, now, 1, 0)) return paused(base, budget, 'budget', now + sendGap(budget, now, 0))
    base = await writeList(api, base, { ...base.index, stats: target }, withRekey(base.raw, null))
    return { kind: 'done', handle: base, budget: recordUpdate(budget, now, null) }
  } catch (err) {
    return pauseOn(err, base, budget, now)
  }
}

/** YAZ-5276: deletes a numbers gist only when it holds exactly our one file in our format (never another tool's gist). */
async function removeIfOurNumbers(api: GistsApi, id: string): Promise<void> {
  let gist: GistDoc | 'unchanged'
  try {
    gist = await api.read(id)
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') return
    throw err
  }
  if (gist === 'unchanged') return
  const names = Object.keys(gist.files)
  if (names.length !== 1 || names[0] !== NUMBERS_FILE || readStatsFile(fileText(gist, NUMBERS_FILE)).kind !== 'ok') return
  await removeQuietly(api, id)
}
