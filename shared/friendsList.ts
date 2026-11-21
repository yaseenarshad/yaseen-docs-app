import {
  LIST_NEEDS_REPAIR,
  NUMBERS_FILE,
  POINTER_FILE,
  emptyNumbers,
  gistErrorCode,
  gistErrorResetAt,
  isGistId,
  isOurNumbersGist,
  listFile,
  listPatch,
  PARKED,
  makeParkedPointer,
  pointersOf,
  tombTag,
  tombText,
  readFriend,
  pointerRedo,
  readPointerFile,
  readStatsFile,
  relinkPointers,
  type FriendRead,
  type FriendReadCache,
  type FriendsIndex,
  type GistDoc,
  type GistsApi,
  type IndexHandle,
  type EntryKind,
  type WriteOptions,
} from './friendGists'
import { BrokenList, ListError, NewerList, findFriendsIndex, latestList, listErrorCode, openFriendsList, updateList, writeList } from './friendListHome'
import { FRIEND_LINK_BASE, LINK_ID, isOurSite, linkPath } from './friendLinks'
import { LIST_PATH } from './friendListStore'
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
 *
 * YAZ-5083: the list is in the vault repo (`friendListStore.ts`). Each change of it is an OPERATION on the newest copy,
 * written with compare-and-swap (`updateList`): a device that wrote from an old copy gets "not a fast forward", reads
 * again and applies its change again. The gist steps of a remove are a saga driven from the list: the intent is in the
 * list first, then the gist step, then its result (each step safe to repeat, on any device).
 */

// The link address and the sites a pasted link may name: `friendLinks.ts` (one place, YAZ-5092).
export { FRIEND_LINK_BASE } from './friendLinks'

export const friendLink = (pointer: string, base = FRIEND_LINK_BASE): string => `${base}#${pointer.toLowerCase()}`

/** The text of the iOS share sheet ("Share my link"). */
export const shareText = (link: string): { title: string; text: string; url: string } => ({
  title: 'Yaseen Docs friend link',
  text: 'Add me as a friend on Yaseen Docs. Open this link, copy the code, then paste it in the app.',
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
    const parts = linkPath(url)
    let id: string | null = null
    if (isOurSite(host)) {
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

/**
 * The list as it is on GitHub now (an ETag read of the vault's branch). A handle with no vault is found again: every
 * write goes to the vault.
 */
async function latest(api: GistsApi, handle: IndexHandle, opts: WriteOptions): Promise<IndexHandle> {
  if (handle.store !== undefined) return latestList(handle)
  const found = await openFriendsList(api, opts)
  if (found.kind === 'ok' && found.handle.store !== undefined) return found.handle
  if (found.kind === 'newer') throw new NewerList()
  if (found.kind === 'elsewhere') throw new Elsewhere(found.home)
  if (found.kind === 'home-gone') throw new HomeGone(found.home, found.fileGone === true)
  if (found.kind === 'ok' || found.kind === 'broken') throw new BrokenList()
  throw Object.assign(new Error('The friends list is gone'), { code: 'NOT_FOUND' })
}

/** YAZ-5083: the list is in a vault this device does not have. Nothing is written. */
export class Elsewhere extends Error {
  constructor(readonly home: string) {
    super('The friends list is in another vault')
  }
}

/**
 * YAZ-5399: the list's home vault is gone on GitHub (deleted, or no access at all). The way out: `restartList`.
 * YAZ-5444 `fileGone`: the vault answers, but the list file is gone from it.
 */
export class HomeGone extends Error {
  constructor(
    readonly home: string,
    readonly fileGone = false,
  ) {
    super(fileGone ? 'The friends list file is gone from its vault' : 'The vault of the friends list is gone')
  }
}

/** One change of the list, as an operation on the newest copy (`f` gets the copy as it is then). */
function change(handle: IndexHandle, f: (index: FriendsIndex, cur: IndexHandle) => FriendsIndex | null, opts: WriteOptions, extra: (cur: IndexHandle) => Record<string, string | null> = () => ({})): Promise<IndexHandle> {
  return writeList(
    handle,
    (cur) => {
      const next = f(cur.index, cur)
      const patch = { ...(next === null ? {} : listPatch(cur, next)), ...extra(cur) }
      return Object.keys(patch).length === 0 ? null : patch
    },
    opts,
  )
}

/**
 * YAZ-5312: after the list names a new (parked) pointer, a fresh read gives the list's numbers gist as it is NOW, and
 * the pointer gets it. A pointer of an entry that a remove already ended stays parked.
 */
export async function pinPointer(api: GistsApi, handle: IndexHandle, pointer: string, opts: ListOptions): Promise<IndexHandle> {
  const now = await latest(api, handle, opts)
  if (now.index.stats !== null && pointersOf(now.index).includes(pointer) && pendingRemove(now) === null) await relinkPointers(api, [pointer], now.index.stats, opts)
  return now
}

/** A pointer read (with an ETag cache, so an unchanged pointer is a free 304). */
type PointerCache = Map<string, { etag: string | null; gist: GistDoc }>
async function readPointer(api: GistsApi, id: string, cache?: PointerCache): Promise<GistDoc | null> {
  const kept = cache?.get(id)
  let gist: GistDoc | 'unchanged'
  try {
    gist = await api.read(id, kept?.etag ?? null)
  } catch (err) {
    if (gistErrorCode(err) === 'NOT_FOUND') {
      cache?.delete(id)
      return null
    }
    throw err
  }
  if (gist === 'unchanged') return kept?.gist ?? null
  cache?.set(id, { etag: gist.etag, gist })
  return gist
}

/**
 * Each pointer of the list moves to the list's CURRENT numbers gist when it names anything else (YAZ-5354): a pointer
 * that is still parked, one an older generation left, or one that a slow device wrote back after another device
 * finished. Only while no remove waits (the remove's own steps move the pointers then). The phone runs it once each
 * session (the rows) and before each send of the numbers, so a kept friend reads the numbers just sent (I6).
 */
export async function settlePointers(api: GistsApi, handle: IndexHandle, opts: ListOptions, cache?: PointerCache, only: 'all' | 'stats' = 'all'): Promise<IndexHandle> {
  const base = await latest(api, handle, opts)
  const target = base.index.stats
  if (base.state === undefined || target === null || pendingRemove(base) !== null) return base
  for (const pointer of pointersOf(base.index)) {
    const gist = await readPointer(api, pointer, cache)
    if (gist === null) continue
    const state = readPointerFile(fileText(gist, POINTER_FILE))
    if (state.kind !== 'ok') continue
    // A friend's entry: my pointer for them reads THEIR pointer that the entry names (a stop between the list write
    // and the pointer write of a paste leaves it reading the old one).
    const friend = base.index.friends.find((f) => f.mine === pointer)
    const reads = only === 'all' && friend !== undefined && state.value.reads !== friend.theirs ? friend.theirs : state.value.reads
    const move = state.value.stats !== target
    if (!move && reads === state.value.reads) continue
    try {
      const ours = { ...state.raw, v: 1, stats: target, ...(reads !== undefined && { reads }) }
      await api.update(pointer, { [POINTER_FILE]: JSON.stringify(ours) }, pointerRedo(state.raw, ours))
      cache?.delete(pointer)
    } catch (err) {
      // Gone (a remove at this moment), or GitHub's 409 (another write of it now): the next settle looks again.
      if (gistErrorCode(err) !== 'NOT_FOUND' && gistErrorCode(err) !== 'GITHUB_DOWN') throw err
    }
  }
  return base
}

const isMine = (index: FriendsIndex, id: string) => pointersOf(index).includes(id)

/** The kind of entry that my pointer `mine` is in the list now, or null. */
export const kindOf = (index: FriendsIndex, mine: string): EntryKind | null =>
  index.friends.some((f) => f.mine === mine) ? 'friend' : index.groups.some((g) => g.mine === mine) ? 'group' : (index.shared ?? []).some((x) => x.mine === mine) ? 'shared' : null

/** Writes `reads` into one of my pointers; keeps its other fields (`mark`, and what a newer app added). */
async function setReads(api: GistsApi, pointer: string, reads: string, held: readonly string[] = []): Promise<void> {
  const gist = await readPointer(api, pointer)
  if (gist === null) return
  const state = readPointerFile(fileText(gist, POINTER_FILE))
  // YAZ-5241: a pointer this app cannot read (or a newer one) is never written over.
  if (state.kind !== 'ok') return
  // YAZ-5235: `held` lists the friend's own links that I still hold (an earlier link of theirs, before the pair
  // healed). The friend's app reads it and deletes those links, and a remove of me deletes them too.
  const before = heldOf(state.raw)
  const allHeld = [...new Set([...before, ...held.filter(isGistId)])]
  if (state.value.reads === reads && allHeld.length === before.length) return
  try {
    const ours = { ...state.raw, v: 1, stats: state.value.stats, reads, ...(allHeld.length > 0 && { held: allHeld }) }
    await api.update(pointer, { [POINTER_FILE]: JSON.stringify(ours) }, pointerRedo(state.raw, ours))
  } catch (err) {
    if (gistErrorCode(err) !== 'NOT_FOUND') throw err
  }
}

/**
 * A pointer of mine that an entry stops using (a heal, a new link of the same friend). The list keeps it as a shared
 * link until its gist is deleted, so a stop in between never leaves a pointer that no list names and that the friend
 * may still read (it moves with the numbers, and the next remove ends it). Then it goes from the gist and the list.
 */
async function retire(api: GistsApi, handle: IndexHandle, old: string, opts: ListOptions): Promise<IndexHandle> {
  await removeQuietly(api, old)
  return writeList(handle, (cur) => ((cur.index.shared ?? []).some((x) => x.mine === old) && (cur.files ?? {})[listFile.shared(old)] !== undefined ? { [listFile.shared(old)]: null } : null), opts)
}

/** The friend's links that a pointer says its owner holds (`held`, YAZ-5235). Untrusted: gist IDs only, at most 50. */
export const heldOf = (raw: Record<string, unknown>): string[] => (Array.isArray(raw.held) ? raw.held.filter(isGistId).slice(0, 50).map((x) => x.toLowerCase()) : [])

/** The raw pointer behind `theirs` (a fresh read), or null when it cannot be read now. */
async function theirRaw(api: GistsApi, theirs: string): Promise<Record<string, unknown> | null> {
  const gist = await readPointer(api, theirs)
  if (gist === null) return null
  const state = readPointerFile(fileText(gist, POINTER_FILE))
  return state.kind === 'ok' ? state.raw : null
}

/**
 * YAZ-5235: deletes my shared links that a friend says it holds (`held` in the pointer it gives me), and takes them out
 * of `shared`. That friend has paired with another of my pointers, so nobody uses them, and a remove of that friend
 * must not leave them leading to my numbers. Only the links that are STILL shared links in the newest list go.
 */
export async function dropHeldShares(api: GistsApi, handle: IndexHandle, ids: readonly string[], opts: ListOptions): Promise<IndexHandle> {
  const base = await latest(api, handle, opts)
  const { handle: next, result: drop } = await updateList(
    base,
    (cur) => {
      const drop = (cur.index.shared ?? []).filter((x) => ids.includes(x.mine)).map((x) => x.mine)
      return { patch: drop.length === 0 ? null : listPatch(cur, { ...cur.index, shared: (cur.index.shared ?? []).filter((x) => !drop.includes(x.mine)) }), result: drop }
    },
    opts,
  )
  for (const id of drop) await removeQuietly(api, id)
  return next
}

/** Who is behind one of a friend's pointers: GitHub's owner of the gist, and the numbers gist it names. */
async function whoBehind(api: GistsApi, pointer: string): Promise<{ owner: string | null; stats: string | null }> {
  try {
    const gist = await api.read(pointer)
    if (gist === 'unchanged') return { owner: null, stats: null }
    const state = readPointerFile(fileText(gist, POINTER_FILE))
    return { owner: gist.owner ?? null, stats: state.kind === 'ok' ? state.value.stats : null }
  } catch {
    return { owner: null, stats: null }
  }
}
const sameLogin = (a: string | null | undefined, b: string | null | undefined) => typeof a === 'string' && typeof b === 'string' && a !== '' && a.toLowerCase() === b.toLowerCase()

// ---------------------------------------------------------------------------------------------------------------------
// Share and paste.

/** "Share my link": a new pointer for ONE friend, kept under `shared` until that friend's link is pasted. */
export async function shareLink(api: GistsApi, handle: IndexHandle, opts: ListOptions): Promise<{ handle: IndexHandle; pointer: string; link: string }> {
  const base = await latest(api, handle, opts)
  if (base.index.stats === null) throw new Error('The list has no numbers gist')
  const pointer = await makeParkedPointer(api, opts)
  await opts.sleep(1000)
  const at = new Date(opts.now()).toISOString()
  const written = await writeList(base, () => ({ [listFile.shared(pointer)]: JSON.stringify({ v: 1, at }) }), opts)
  const next = await pinPointer(api, written, pointer, opts)
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
  /** YAZ-5083: my friends list is in the vault `home`, which this device does not have: nothing is changed. */
  | { kind: 'list-elsewhere'; home: string }
  /** YAZ-5083: the token cannot read or write the vault that holds my friends list. */
  | { kind: 'no-list-access' }
  /** YAZ-5399: the vault that held my friends list is gone on GitHub. The way out: start the list again. */
  | { kind: 'home-gone'; home: string; fileGone?: boolean }
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
      return 'That is not a Yaseen Docs friend link. Ask your friend to tap Share my link and send it again.'
    case 'other-app':
      return "That link is from another app. Paste the link from your friend's Yaseen Docs."
    case 'own-link':
      return 'That is your own link. Send it to a friend, and paste the link they send you.'
    case 'not-found':
      return 'That link does not work any more. Ask your friend for a new one.'
    case 'newer-app':
      return 'Your friend has a newer Yaseen Docs. Update this app, then paste the link again.'
    case 'offline':
      return 'No connection. Try again when you are online.'
    case 'rate-limited':
      return 'GitHub asks the app to wait. Try again in a few minutes.'
    case 'refused':
      return 'Friends needs the Gists permission on your token.'
    case 'needs-repair':
      return LIST_NEEDS_REPAIR
    case 'list-elsewhere':
      return listElsewhereMessage(result.home)
    case 'no-list-access':
      return NO_LIST_ACCESS
    case 'home-gone':
      return homeGoneMessage(result.home, result.fileGone === true)
    case 'unauthorized':
      return 'Sign in again, then paste the link.'
    default:
      return 'Something went wrong. Try again.'
  }
}

/** YAZ-5083: the words when the list is in a vault this device does not have. */
export const listElsewhereMessage = (home: string): string => `Your friends list is in the vault ${home}. Add that vault on this device to use Friends here.`
/** YAZ-5083: the words when the token cannot read or write the vault that holds the list. */
export const NO_LIST_ACCESS = 'Your token cannot write to the vault that holds your friends list. Give the token Contents (read and write) on that vault, then try again.'
/** YAZ-5399: the words when the home vault is gone on GitHub (what happened, and what it means). */
export const homeGoneMessage = (home: string, fileGone = false): string =>
  fileGone
    ? `Your friends list was in the vault ${home}. The list file ${LIST_PATH} is gone from that vault on GitHub: it was deleted, or the vault was made again. The list cannot be read, so no friend can be changed or removed.`
    : `Your friends list was in the vault ${home}. GitHub does not have that vault for your account any more: it was deleted, or your token lost access to it. The list cannot be read, so no friend can be changed or removed.`
/** YAZ-5400: the words when an old list gist has more than 300 files (GitHub gives the app only 300 of them). */
export const LIST_CUT =
  'Your old friends list on GitHub has more than 300 files. GitHub gives the app only 300 of them, so the app cannot read the whole list or move it. Nothing was changed, and no new list was started.'
/** YAZ-5464: the way out could not see every gist (it would miss a friend link): it changed nothing. */
export const TOO_MANY_GISTS = `You have more than ${30 * 100} gists on GitHub, and GitHub lists only that many to the app. The app could miss a friend link, so it changed nothing. Delete gists you do not need on gist.github.com, then try again.`
/** YAZ-5399: the way out, as a button. */
export const restartAction = (vault: string): string => `Start the friends list again in ${vault}`
/** YAZ-5399: what the way out does, said before it runs (its privacy effect). */
export const restartWarning = (vault: string): string =>
  `This stops sharing with everyone. Yaseen Docs deletes every friend link, group link and numbers file that you made, so no old friend or group can read your numbers. Then it makes a new, empty friends list in ${vault}. To share again, send your link to each friend.`

/** A thrown failure as a paste result. */
function failureResult(err: unknown): PasteResult {
  if (err instanceof NewerList) return { kind: 'newer-app' }
  if (err instanceof BrokenList) return { kind: 'needs-repair' }
  if (err instanceof Elsewhere) return { kind: 'list-elsewhere', home: err.home }
  if (err instanceof HomeGone) return { kind: 'home-gone', home: err.home, ...(err.fileGone && { fileGone: true }) }
  if (listErrorCode(err) === 'NO_LIST_ACCESS') return { kind: 'no-list-access' }
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

/** "Paste a friend's link" (decision 20). The list must exist (`openFriendsList` with a seed). */
export async function pasteLink(api: GistsApi, handle: IndexHandle, text: string, opts: ListOptions): Promise<PasteResult> {
  const link = parseFriendLink(text)
  if (link.kind !== 'ok') return link
  const id = link.id
  try {
    let base = await latest(api, handle, opts)
    // A paste reads the friend's files, then writes the list as an operation. When the newest list shows the same
    // friend (another device pasted at the same moment) or the entry it changes is gone, it starts again from there.
    for (let round = 0; round < 4; round++) {
      const r = await pasteOnce(api, base, id, opts)
      if (r.kind !== 'again') return r
      base = await latest(api, base, opts)
    }
    return { kind: 'failed' }
  } catch (err) {
    return failureResult(err)
  }
}

async function pasteOnce(api: GistsApi, base: IndexHandle, id: string, opts: ListOptions): Promise<PasteResult | { kind: 'again' }> {
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
  // A pointer of my own account (my other device's link, not in this list yet): GitHub's owner is mine, or it names
  // my numbers gist.
  if (sameLogin(gist.owner, base.owner) || theirStats === index.stats) return { kind: 'own-link' }
  const login = typeof gist.owner === 'string' && gist.owner !== '' ? gist.owner.slice(0, 100) : undefined
  const name = await friendName(api, theirStats)
  const reads = pointer.value.reads
  const shared = index.shared ?? []
  const readsMyShare = reads !== undefined && shared.some((s) => s.mine === reads)

  // The same friend already in the list: by the pointer; by GitHub's owner kept in the entry (YAZ-5353); else by
  // GitHub's owner of their pointers (YAZ-5312: two links of one person can name two numbers gists); else by their
  // numbers gist.
  let same = index.friends.find((f) => f.theirs === id) ?? index.friends.find((f) => login !== undefined && sameLogin(f.login, login))
  if (same === undefined)
    for (const f of index.friends) {
      if (f.login !== undefined) continue
      const who = await whoBehind(api, f.theirs)
      if ((who.owner !== null && sameLogin(who.owner, gist.owner)) || (who.owner === null && who.stats !== null && who.stats === theirStats)) {
        same = f
        break
      }
    }

  if (same !== undefined) {
    if (same.theirs === id && (reads === undefined || reads === same.mine || !readsMyShare)) return { kind: 'already', name: same.name }
    // They read one of my shared links: take it as my pointer for them, and drop the extra one.
    const mine = readsMyShare ? reads! : same.mine
    const sameMine = same.mine
    // `paired` is about the link the entry holds NOW: a new link is paired only when the friend already reads my
    // pointer through it; else it waits for their app to confirm (markPaired). A link of mine that a remove has
    // already ended may still answer for a moment, so an old `paired` must never carry over to a new link.
    const { handle: next, result } = await updateList(
      base,
      (cur) => {
        // The entry this paste changes must still be there, and the link it takes must still be a shared link.
        if (!cur.index.friends.some((f) => f.mine === sameMine) || (readsMyShare && mine !== sameMine && !(cur.index.shared ?? []).some((s) => s.mine === mine))) return { patch: null, result: 'again' as const }
        const friends = cur.index.friends.map((f) => (f.mine === sameMine ? { name: f.name, theirs: id, mine, ...(reads === mine && { paired: true as const }), ...(login !== undefined && { login }) } : f))
        // The pointer the entry stops using stays in the list (as a shared link) until its gist is gone (`retire`).
        const shared = [...(cur.index.shared ?? []).filter((s) => s.mine !== mine), ...(mine !== sameMine ? [{ mine: sameMine, at: new Date(opts.now()).toISOString() }] : [])]
        return { patch: listPatch(cur, { ...cur.index, friends, shared }), result: 'ok' as const }
      },
      opts,
    )
    if (result === 'again') return { kind: 'again' }
    // YAZ-5312: the list first, then my pointer. A stop in between leaves my new entry unpaired ("waiting"), and the
    // friend still sees my pointer read their OLD link, so their app keeps it. `settlePointers` finishes the step.
    // Their earlier link (`same.theirs`) stays with me unused: tell them in `held`, so their app deletes it.
    await setReads(api, mine, id, same.theirs !== id ? [same.theirs] : [])
    const after = mine !== sameMine ? await retire(api, next, sameMine, opts) : next
    return { kind: 'added', name: same.name, paired: reads === mine, sendBack: reads === mine ? null : friendLink(mine), handle: after }
  }

  // A new friend. If they read one of my shared links, that link is my pointer for them; else make one.
  let mine: string
  if (readsMyShare) mine = reads!
  else mine = await makeParkedPointer(api, opts, { reads: id })
  await opts.sleep(1000)
  // YAZ-5353: the write checks the NEWEST list: when another device of mine added this friend a moment ago (the same
  // link, or GitHub's owner of it), this paste adds no second entry; its own new pointer goes.
  const { handle: next, result } = await updateList(
    base,
    (cur) => {
      const dup = cur.index.friends.some((f) => f.theirs === id || (login !== undefined && sameLogin(f.login, login)))
      if (dup) return { patch: null, result: 'again' as const }
      if (readsMyShare && !(cur.index.shared ?? []).some((s) => s.mine === mine)) return { patch: null, result: 'again' as const }
      const entry = { name, theirs: id, mine, ...(readsMyShare && { paired: true as const }), ...(login !== undefined && { login }) }
      return { patch: listPatch(cur, { ...cur.index, friends: [...cur.index.friends, entry], shared: (cur.index.shared ?? []).filter((s) => s.mine !== mine) }), result: 'ok' as const }
    },
    opts,
  )
  if (result === 'again') {
    if (!readsMyShare) await removeQuietly(api, mine)
    return { kind: 'again' }
  }
  // The list first, then my pointer's `reads` (YAZ-5312: a stop in between is finished by `settlePointers`).
  if (readsMyShare) await setReads(api, mine, id)
  const paired = readsMyShare
  const pinned = readsMyShare ? next : await pinPointer(api, next, mine, opts)
  return { kind: 'added', name, paired, sendBack: paired ? null : friendLink(mine), handle: pinned }
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
  return change(base, (index) => (index.friends.some((f) => mines.includes(f.mine) && f.paired !== true) ? { ...index, friends: index.friends.map((f) => (mines.includes(f.mine) ? { ...f, paired: true as const } : f)) } : null), opts)
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
    await setReads(api, use, theirs)
    // On the NEWEST list: the friend's entry and the shared link must both still be there.
    const { handle: next, result: old } = await updateList(
      base,
      (cur) => {
        const entry = cur.index.friends.find((x) => x.theirs === theirs)
        if (entry === undefined || !(cur.index.shared ?? []).some((s) => s.mine === use)) return { patch: null, result: null }
        const friends = cur.index.friends.map((x) => (x.theirs === theirs ? { ...x, mine: use } : x))
        // The old pointer stays in the list (as a shared link) until its gist is gone (`retire`).
        const shared = [...(cur.index.shared ?? []).filter((s) => s.mine !== use), ...(entry.mine !== use ? [{ mine: entry.mine, at: new Date(opts.now()).toISOString() }] : [])]
        return { patch: listPatch(cur, { ...cur.index, friends, shared }), result: entry.mine }
      },
      opts,
    )
    base = next
    if (old !== null && old !== use) base = await retire(api, base, old, opts)
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

/**
 * YAZ-5361: the removes that wait in the list (the saga state, not the phone's queue): the names of the friends and
 * groups in them, and how many removes. The erase ask counts these too.
 */
export function waitingRemoves(handle: IndexHandle): { count: number; names: string[] } {
  const pending = handle.state?.pending ?? []
  const waiting = pendingRemove(handle)
  if (waiting === null) return { count: 0, names: [] }
  const named = pending.filter((t) => t.kinds.length > 0)
  return { count: Math.max(1, named.length), names: Object.values(waiting.names ?? {}) }
}

export type RemoveResult =
  | { kind: 'done'; handle: IndexHandle; budget: GistBudget; took?: string[] }
  /**
   * It stopped; the list holds what is left, and the next start (or `retryAt`) finishes it. `took` (YAZ-5352): the
   * pointers whose remove this call wrote into the list. A pointer not in it was not taken: GitHub refused the first
   * write, or the entry is not of the kind asked for any more (a shared link that a friend now uses).
   * `busy` (YAZ-5083): another device of mine makes the new numbers gist of this remove now.
   */
  | { kind: 'paused'; handle: IndexHandle; budget: GistBudget; why: 'budget' | 'rate-limited' | 'offline' | 'refused' | 'unauthorized' | 'needs-repair' | 'busy' | 'list-elsewhere' | 'no-list-access' | 'home-gone'; retryAt: number | null; took?: string[] }
  | { kind: 'not-found'; handle: IndexHandle; budget: GistBudget }

/**
 * Remove a friend, a group I am in (4E3: "Leave group"), or a shared link, by my pointer for them (`mine`). This is
 * also how sharing stops for that person (decision 22). Each `PATCH` of a pointer counts on `gist_update`; the list's
 * own writes go to the vault repo and do not. A remove may use the reserve that the sender keeps for it (4E1).
 */
export async function removeFriend(
  api: GistsApi,
  handle: IndexHandle,
  mine: string,
  budget: GistBudget,
  opts: ListOptions,
  /** 4E3: more of my gists to delete in the same safe steps (the group file of "Delete group"). */
  more: { drop?: string[]; kinds?: Record<string, EntryKind> } = {},
): Promise<RemoveResult> {
  return removeMany(api, handle, [mine], budget, opts, more)
}

/**
 * YAZ-5236: removes several friends, groups or shared links in ONE re-key (one new numbers gist, each other pointer
 * moved once). 30 removes in a row cost about as much as one.
 * The first write puts the remove in the list (a tombstone for each pointer), so it is kept until it is done. It is a
 * compare-and-swap commit of the vault repo (no `gist_update`), checked on the NEWEST list: a pointer is ended only as
 * the kind of entry it is then (YAZ-5352: `kinds` says which kind the caller meant), and a shared link that a friend I
 * keep uses now is that friend's pointer, not an unused link (YAZ-5311). Only GitHub's own "rate limit" or no
 * connection stops it before that write: then the result is `paused` with nothing in `took`, and the caller keeps the
 * request (the phone: `friendsRemoveQueue`) to try again.
 */
export async function removeMany(api: GistsApi, handle: IndexHandle, mines: readonly string[], budget: GistBudget, opts: ListOptions, more: { drop?: string[]; kinds?: Record<string, EntryKind> } = {}): Promise<RemoveResult> {
  const now = opts.now()
  let fresh = handle
  try {
    let base = await latest(api, handle, opts)
    fresh = base
    const wanted = (index: FriendsIndex) => [...new Set(mines)].filter((m) => kindOf(index, m) !== null && (more.kinds?.[m] === undefined || kindOf(index, m) === more.kinds[m]))
    let todo = wanted(base.index)
    if (todo.length === 0) return pendingRemove(base) === null ? { kind: 'not-found', handle: base, budget } : finishRemove(api, base, budget, opts)
    if (budget.blockedUntil !== null && now < budget.blockedUntil) return paused(base, budget, 'rate-limited', budget.blockedUntil)
    // YAZ-5311: decide what is "unused" from fresh facts. First the pairs: a friend I keep who reads one of my shared
    // links has that link as my pointer for them (the heal), so it is used, not unused.
    const shares = new Set((base.index.shared ?? []).map((x) => x.mine))
    const repairs: ListRows['repairs'] = []
    for (const f of base.index.friends) {
      if (todo.includes(f.mine)) continue
      const theirs = await theirRaw(api, f.theirs)
      const reads = theirs !== null && isGistId(theirs.reads) ? theirs.reads.toLowerCase() : null
      if (reads !== null && reads !== f.mine && shares.has(reads)) repairs.push({ theirs: f.theirs, use: reads })
    }
    if (repairs.length > 0) {
      base = await repairPairs(api, base, repairs, opts)
      fresh = base
    }
    // A shared link that a friend turned out to use is now that friend's pointer: cancelling the LINK must not remove
    // the friend (the friend's own Remove does that). It is no longer an unused link, so it is not in this remove.
    todo = wanted(base.index)
    if (todo.length === 0) return pendingRemove(base) === null ? { kind: 'not-found', handle: base, budget } : finishRemove(api, base, budget, opts)
    // YAZ-5235: my shared links that each removed friend says it holds go too.
    const heldShares: string[] = []
    for (const mine of todo) {
      const friend = base.index.friends.find((f) => f.mine === mine)
      const theirs = friend === undefined ? null : await theirRaw(api, friend.theirs)
      if (theirs !== null) for (const id of heldOf(theirs)) if ((base.index.shared ?? []).some((x) => x.mine === id) && !heldShares.includes(id)) heldShares.push(id)
    }
    const at = new Date(now).toISOString()
    // The remove's first write, on the newest list: a tombstone for each pointer that is still of the kind asked, each
    // held link, and (YAZ-5274) every link I shared that no friend uses: I cannot tell who holds it.
    const { handle: written, result: took } = await updateList(
      base,
      (cur) => {
        const ix = cur.index
        const now2 = wanted(ix)
        const held = heldShares.filter((m) => kindOf(ix, m) === 'shared' && !now2.includes(m))
        const unused = (ix.shared ?? []).map((x) => x.mine).filter((m) => !now2.includes(m) && !held.includes(m))
        const all = [...now2, ...held, ...unused]
        if (now2.length === 0) return { patch: null, result: [] as string[] }
        const kindsOf = (m: string): EntryKind[] => [
          ...(ix.friends.some((f) => f.mine === m) ? (['friend'] as const) : []),
          ...(ix.groups.some((g) => g.mine === m) ? (['group'] as const) : []),
          ...((ix.shared ?? []).some((x) => x.mine === m) ? (['shared'] as const) : []),
        ]
        const nameOf = (m: string) => ix.friends.find((f) => f.mine === m)?.name ?? ix.groups.find((g) => g.mine === m)?.name
        const tombs: Record<string, string> = {}
        for (const [i, m] of all.entries()) {
          const name = nameOf(m)
          tombs[listFile.tomb(m, tombTag(kindsOf(m), true, at))] = tombText({ kinds: kindsOf(m), rekey: true, at, ...(name !== undefined && { name }), drop: i === 0 ? (more.drop ?? []).filter(isGistId) : [] })
        }
        return { patch: tombs, result: now2 }
      },
      opts,
    )
    if (took.length === 0) return pendingRemove(written) === null ? { kind: 'not-found', handle: written, budget } : finishRemove(api, written, budget, opts)
    const r = await finishRemove(api, written, budget, opts)
    return r.kind === 'not-found' ? r : { ...r, took }
  } catch (err) {
    // The list as last read: the caller sees which removes the list does not hold yet.
    return pauseOn(err, fresh, budget, now)
  }
}

function paused(handle: IndexHandle, budget: GistBudget, why: Extract<RemoveResult, { kind: 'paused' }>['why'], retryAt: number | null): RemoveResult {
  return { kind: 'paused', handle, budget, why, retryAt }
}

function pauseOn(err: unknown, handle: IndexHandle, budget: GistBudget, now: number): RemoveResult {
  if (err instanceof NewerList) return paused(handle, budget, 'refused', null)
  if (err instanceof BrokenList) return paused(handle, budget, 'needs-repair', null)
  if (err instanceof Elsewhere) return paused(handle, budget, 'list-elsewhere', null)
  if (err instanceof HomeGone) return paused(handle, budget, 'home-gone', null)
  if (listErrorCode(err) === 'NO_LIST_ACCESS') return paused(handle, budget, 'no-list-access', null)
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
      throw err
  }
}

/** Another run takes over a generation that a device started this long ago and did not finish (it stopped). */
export const INTENT_LEASE_MS = 2 * 60_000

/** An intent of another run is live while its time is within the lease of this device's clock (either way: a clock
 *  far ahead or behind never holds a generation for good; a take-over is safe, step 2c keeps one gist per generation). */
const liveIntent = (at: string, now: number) => Math.abs(now - (Date.parse(at) || 0)) < INTENT_LEASE_MS

/** The tag of this run of the app, for a device that gives none (`WriteOptions.device`). */
const RUN_TAG = `r${Math.floor(Math.random() * 36 ** 8).toString(36)}`

/**
 * Finishes a remove that waits in the list (YAZ-5310, YAZ-5312, and the saga of YAZ-5083). Each step can run again
 * safely, on any device; each list write is a compare-and-swap of the vault repo:
 * 1. the removed pointers (and their extra gists, the group file of "Delete group") are deleted FIRST;
 * 2. a NEW numbers generation k for the removes that the current generation does not cover. The saga: (a) the INTENT
 *    `i.k` goes into the list first, with the set of removes FIXED (YAZ-5310: a generation's gist is only good for the
 *    removes it was made after); only the run whose intent the list holds goes on; (b) it makes the numbers gist;
 *    (c) it writes the generation `n.k-<id>` only while its own intent is still there and no generation k exists, so
 *    there is never a second gist for one generation; a run that lost deletes its own gist. A run that stopped between
 *    (a) and (c) is taken over after `INTENT_LEASE_MS`. The gist's ID is in the list before any pointer names it;
 * 3. each pointer of the list as it is now (the friends and groups I keep) moves to the current generation;
 * 4. a fresh read proves it: no remove waits, the same generation, every pointer names it;
 * 5. the older numbers gists go (by their IDs in the list, and only when provably ours), then the generation is marked
 *    done, and the records that only the remove needed leave the list (so it stays small).
 * The sender (4E1) does not send while a remove waits. `done` only after a fresh read shows nothing waits.
 */
export async function finishRemove(api: GistsApi, handle: IndexHandle, budget: GistBudget, opts: ListOptions): Promise<RemoveResult> {
  const now = opts.now()
  const me = (opts.device ?? RUN_TAG).slice(0, 40)
  let base = handle
  /** The numbers gists that THIS run made: the only new numbers gists it may delete (YAZ-5276). */
  const made = new Set<string>()
  /** This run wrote a pointer (a late one may name a generation another device passed meanwhile). */
  let movedAny = false
  try {
    for (let round = 0; round < 12; round++) {
      base = await latest(api, base, opts)
      const st = base.state
      if (st === undefined) return pendingRemove(base) === null ? { kind: 'done', handle: base, budget } : paused(base, budget, 'needs-repair', null)
      const current = st.gens.at(-1)
      if (st.pending.length === 0 && (current === undefined || current.done)) {
        for (const id of made) if (id !== base.index.stats) await removeQuietly(api, id)
        // This run moved pointers to a generation that another device has since passed and finished: a write of this
        // run that landed late may name the older gist. Move them once more to the current one (YAZ-5354, I2).
        if (movedAny && current !== undefined) {
          const again = await moveForward(api, base, current.stats, budget, now, opts)
          budget = again.budget
        }
        return { kind: 'done', handle: base, budget }
      }
      // 1. The removed pointers go first (one that the list holds again under another kind, a re-add at the same
      // moment on another device, stays: it moves to the new numbers with the friends I keep).
      const live = new Set(pointersOf(base.index))
      for (const t of st.pending) {
        if (t.kinds.length > 0 && !live.has(t.mine)) await removeQuietly(api, t.mine)
        for (const d of t.drop) await removeQuietly(api, d)
      }
      // 2. A new generation for the removes that the current generation does not cover.
      if (st.pending.length > 0) {
        const k = (current?.k ?? -1) + 1
        const intent = st.intents.find((i) => i.k === k)
        // The clock NOW (round 5): a run that waited long (a slow call, the app in the background) never judges a lease by
        // the time it started, which would take over another device's fresh intent.
        const t = opts.now()
        const fresh = intent !== undefined && intent.by !== me && liveIntent(intent.at, t)
        if (fresh) return paused(base, budget, 'busy', (Date.parse(intent.at) || t) + INTENT_LEASE_MS)
        if (intent === undefined || intent.by !== me) {
          // (a) The intent, on the newest list: generation k is still the next one, and no live run of another
          // device holds it.
          const claim = await updateList(
            base,
            (cur) => {
              const s = cur.state!
              const c = s.gens.at(-1)
              if ((c?.k ?? -1) + 1 !== k || s.pending.length === 0) return { patch: null, result: false }
              const other = s.intents.find((i) => i.k === k)
              if (other !== undefined && other.by !== me && liveIntent(other.at, opts.now())) return { patch: null, result: false }
              const covers = [...new Set([...(c?.covers ?? []), ...s.pending.map((t) => t.id)])]
              return { patch: { [listFile.intent(k)]: JSON.stringify({ v: 1, covers, by: me, at: new Date(opts.now()).toISOString() }) }, result: true }
            },
            opts,
          )
          base = claim.handle
          continue
        }
        // (b) The numbers gist, a copy of the numbers as they are.
        let text = JSON.stringify(emptyNumbers(now))
        if (base.index.stats !== null)
          try {
            const old = await api.read(base.index.stats)
            if (old !== 'unchanged') text = fileText(old, NUMBERS_FILE) ?? text
          } catch (err) {
            if (gistErrorCode(err) !== 'NOT_FOUND') throw err
          }
        const id = (await api.create(opts.describe('numbers'), { [NUMBERS_FILE]: text })).id
        made.add(id)
        await opts.sleep(1000)
        // (c) Its ID into the list, only while the intent is still mine and generation k is not there.
        const rec = await updateList(
          base,
          (cur) => {
            const s = cur.state!
            const mineNow = s.intents.find((i) => i.k === k)
            if (mineNow === undefined || mineNow.by !== me || s.gens.some((g) => g.k === k)) return { patch: null, result: false }
            return { patch: { [listFile.gen(k, id)]: JSON.stringify({ v: 1, stats: id, covers: mineNow.covers }), [listFile.intent(k)]: null }, result: true }
          },
          opts,
        )
        base = rec.handle
        if (!rec.result) {
          await removeQuietly(api, id)
          made.delete(id)
        }
        continue
      }
      // 3. Every pointer I keep moves to the current generation.
      const target = current!.stats
      const moved = await moveForward(api, base, target, budget, now, opts)
      budget = moved.budget
      movedAny ||= moved.wrote
      if (moved.stop !== null) return moved.stop
      // 4. A fresh read proves it.
      const proof = await latest(api, base, opts)
      const st2 = proof.state!
      if (st2.pending.length > 0 || st2.gens.at(-1)?.stats !== target) {
        base = proof
        continue
      }
      if (!(await allNamed(api, proof, target))) {
        base = proof
        continue
      }
      // 5. The older numbers gists go; then the generation is done, and the records that only the remove needed go.
      for (const g of st2.gens) if (g.stats !== target) await removeIfOurNumbers(api, g.stats)
      if (st2.legacyStats !== null && st2.legacyStats !== target) await removeIfOurNumbers(api, st2.legacyStats)
      for (const id of made) if (id !== target) await removeQuietly(api, id)
      base = await writeList(
        proof,
        (cur) => {
          const s = cur.state!
          const last = s.gens.at(-1)
          if (last === undefined || last.stats !== target || s.pending.length > 0) return null
          const files = cur.files ?? {}
          const patch: Record<string, string | null> = { [listFile.done(last.stats)]: '{"v":1}' }
          for (const g of s.gens) if (g !== last) {
            if (files[listFile.gen(g.k, g.stats)] !== undefined) patch[listFile.gen(g.k, g.stats)] = null
            if (files[listFile.done(g.stats)] !== undefined) patch[listFile.done(g.stats)] = null
          }
          // The record of each entry that a tombstone ended, then each tombstone the done generation covers (no stale
          // write can bring an entry back: every write is a compare-and-swap). The intents of older generations go.
          const fileOf = { friend: listFile.friend, group: listFile.group, shared: listFile.shared } as const
          const covered = new Set(last.covers)
          for (const t of s.tombs) {
            for (const kind of t.kinds) if (files[fileOf[kind](t.mine)] !== undefined) patch[fileOf[kind](t.mine)] = null
            const name = listFile.tomb(t.mine, t.id.slice(t.mine.length + 1))
            if ((covered.has(t.id) || !t.rekey) && files[name] !== undefined) patch[name] = null
          }
          for (const i of s.intents) if (i.k <= last.k && files[listFile.intent(i.k)] !== undefined) patch[listFile.intent(i.k)] = null
          if (s.legacyStats !== null && files[INDEX_FILE_NAME] !== undefined) {
            const head = JSON.parse(files[INDEX_FILE_NAME]) as Record<string, unknown>
            if ('stats' in head) {
              const { stats: _old, ...rest } = head
              patch[INDEX_FILE_NAME] = JSON.stringify(rest)
            }
          }
          return patch
        },
        opts,
      )
    }
    return paused(base, budget, 'offline', null)
  } catch (err) {
    return pauseOn(err, base, budget, now)
  }
}
const INDEX_FILE_NAME = 'notecards-friends.json'

/**
 * Moves each pointer of the list to `target` (the current generation of the list as just read). One that a slow run
 * wrote back to an older gist is moved again by the next round, by `settlePointers`, or by the next send (YAZ-5354).
 */
async function moveForward(api: GistsApi, base: IndexHandle, target: string, budget: GistBudget, now: number, opts: ListOptions): Promise<{ budget: GistBudget; stop: RemoveResult | null; wrote: boolean }> {
  let wrote = false
  for (const pointer of pointersOf(base.index)) {
    const gist = await readPointer(api, pointer)
    if (gist === null) continue
    const state = readPointerFile(fileText(gist, POINTER_FILE))
    if (state.kind !== 'ok' || state.value.stats === target) continue
    if (!mayUpdate(budget, now, 1, 0)) return { budget, stop: paused(base, budget, 'budget', now + sendGap(budget, now, 0)), wrote }
    try {
      const ours = { ...state.raw, v: 1, stats: target }
      await api.update(pointer, { [POINTER_FILE]: JSON.stringify(ours) }, pointerRedo(state.raw, ours))
    } catch (err) {
      if (gistErrorCode(err) === 'NOT_FOUND') continue // deleted in the meantime (a remove on another device)
      // GitHub's 409 (another device of mine writes this pointer at this moment, to the same generation): the proof of
      // step 4 reads it again, and the next round moves it if it still needs it.
      if (gistErrorCode(err) === 'GITHUB_DOWN') continue
      throw err
    }
    budget = recordUpdate(budget, now, null)
    wrote = true
    await opts.sleep(1000)
  }
  return { budget, stop: null, wrote }
}

/** Does every pointer of the list name `target` (a pointer that is gone does not count against it)? */
async function allNamed(api: GistsApi, base: IndexHandle, target: string): Promise<boolean> {
  for (const pointer of pointersOf(base.index)) {
    const gist = await readPointer(api, pointer)
    if (gist === null) continue
    const state = readPointerFile(fileText(gist, POINTER_FILE))
    if (state.kind === 'ok' && state.value.stats !== target) return false
  }
  return true
}

/** YAZ-5276: deletes a numbers gist only when it holds exactly our one file in our format (never another tool's gist). */
async function removeIfOurNumbers(api: GistsApi, id: string): Promise<void> {
  if (await isOurNumbersGist(api, id)) await removeQuietly(api, id)
}

/**
 * The numbers gist is gone on GitHub (deleted by hand): a new one, as a remove with no friend in it (a tombstone of no
 * entry). The same saga makes it, moves each pointer to it, and writes it in the list: one generation, never two.
 */
export async function remakeNumbers(api: GistsApi, handle: IndexHandle, budget: GistBudget, opts: ListOptions): Promise<RemoveResult> {
  const now = opts.now()
  try {
    const base = await latest(api, handle, opts)
    const at = new Date(now).toISOString()
    const written = pendingRemove(base) !== null ? base : await writeList(base, (cur) => (pendingRemove(cur) !== null ? null : { [listFile.tomb(PARKED, tombTag([], true, at))]: tombText({ kinds: [], rekey: true, at, drop: [] }) }), opts)
    return await finishRemove(api, written, budget, opts)
  } catch (err) {
    return pauseOn(err, handle, budget, now)
  }
}

/**
 * YAZ-5492: a list whose numbers gist is GONE heals itself: a new generation (`remakeNumbers`: the same saga as a
 * remove, so one generation, never two; each pointer of the list moves to it). Two phones' way outs into two vaults at
 * the same moment could each delete the other's new numbers gist; the list that the note names then pointed at nothing
 * for good, and each friend added after it read "no update yet". One read of the numbers gist (an ETag read, free when
 * it is there). `null`: nothing to heal (the gist is there, a remove waits and makes its own, or GitHub did not answer).
 */
export async function healNumbers(api: GistsApi, handle: IndexHandle, budget: GistBudget, opts: ListOptions): Promise<RemoveResult | null> {
  const stats = handle.index.stats
  if (handle.store === undefined || stats === null || pendingRemove(handle) !== null || (handle.state?.pending.length ?? 0) > 0) return null
  try {
    await api.read(stats)
    return null
  } catch (err) {
    if (gistErrorCode(err) !== 'NOT_FOUND') return null
  }
  // The list read AGAIN after the 404: a remove on another device that just finished made a new generation and then
  // deleted the old gist (the one this copy names). Only a list that still names the gone gist, with no remove
  // waiting, gets a new one (else this would make a second generation over another device's).
  let fresh: IndexHandle
  try {
    fresh = await latestList(handle)
  } catch {
    return null
  }
  if (fresh.index.stats !== stats || pendingRemove(fresh) !== null || (fresh.state?.pending.length ?? 0) > 0) return null
  return remakeNumbers(api, fresh, budget, opts)
}

/** Reads the list (read only), for a caller that holds no handle yet. */
export { findFriendsIndex, ListError }
