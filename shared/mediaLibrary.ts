/**
 * The media library's RULES (🔒 YAZ-1775 D4 / D5, YAZ-1817): what a valid item is, and what add / remove /
 * record do to the lists in `<library>/media.json`. Pure and Electron-free — the main-process
 * store around it (`desktop/src/main/library/mediaStore.ts`) only reads, writes and watches the
 * file, so every rule here is unit-tested with no disk.
 *
 * The item validator is the web app's `convex/mediaTypes.ts` verbatim: an item is whole or it is
 * not one at all (a wrong-typed optional REJECTS rather than being dropped — a half-read item
 * would show a broken tile). The FILE is lenient around that: a bad row is dropped, the rest
 * survive, so one hand-edit cannot cost the user their other favorites. The lists are newest-first and
 * de-duplicated by `itemKey` — the same order the web app's `by_ownerId_and_updatedAt` index answered in.
 * `recent` and `used` are capped on the tail; `favorites` has no cap (YAZ-4363): the user builds it by hand.
 */
import {
  AUTO_FAVORITE_USES,
  MAX_ITEM_WORDS,
  MAX_ITEM_WORD_LENGTH,
  MAX_MEDIA_REMOVED,
  MAX_MEDIA_USED,
  RECENT_LIMIT,
  isMediaItemKind,
  isMediaProvider,
  type MediaItem,
  type MediaLibraryFile,
  type StoredMediaItem,
  type UsedMediaItem,
} from './types'
import { cleanList, isFiniteNumber, isRecord } from './guards'

export const EMPTY_MEDIA_LIBRARY: MediaLibraryFile = { version: 1, favorites: [], recent: [], used: [], removed: {} }


/** The optional fields and their one type each — `mediaItemValidator`'s `v.optional(...)` rows. */
const OPTIONAL_STRINGS = ['previewUrl', 'creator', 'creatorUrl', 'collectionName', 'sourceUrl', 'licenseName', 'licenseUrl', 'attribution'] as const
const OPTIONAL_NUMBERS = ['width', 'height'] as const

/** `mediaItemValidator`, field for field: null unless every present field is right; unknown fields drop. */
export function normalizeMediaItem(v: unknown): MediaItem | null {
  if (!isRecord(v)) return null
  const { itemKey, provider, providerId, kind, title } = v
  if (typeof itemKey !== 'string' || itemKey === '' || typeof providerId !== 'string' || providerId === '') return null
  if (!isMediaProvider(provider) || !isMediaItemKind(kind) || typeof title !== 'string') return null
  const out: MediaItem = { itemKey, provider, providerId, kind, title }
  for (const k of OPTIONAL_STRINGS) {
    if (v[k] === undefined) continue
    if (typeof v[k] !== 'string') return null
    out[k] = v[k]
  }
  for (const k of OPTIONAL_NUMBERS) {
    if (v[k] === undefined) continue
    if (!isFiniteNumber(v[k])) return null
    out[k] = v[k]
  }
  if (v.trademarkNotice !== undefined) {
    if (typeof v.trademarkNotice !== 'boolean') return null
    out.trademarkNotice = v.trademarkNotice
  }
  return out
}

/** The stored row: an item plus the finite `updatedAt` the lists are ordered by. */
export function normalizeStoredMediaItem(v: unknown): StoredMediaItem | null {
  const item = normalizeMediaItem(v)
  if (item === null || !isRecord(v) || !isFiniteNumber(v.updatedAt)) return null
  return { ...item, updatedAt: v.updatedAt }
}

/**
 * A word as the library keeps it (YAZ-4157 D5): trimmed, lower case, one space between words. Null when nothing is
 * left, or when it is longer than `MAX_ITEM_WORD_LENGTH` — a pasted paragraph is not a word.
 */
export function normalizeWord(raw: string): string | null {
  const word = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return word === '' || word.length > MAX_ITEM_WORD_LENGTH ? null : word
}

/** The `used` row: a stored item plus a whole-number count and its words; a bad word drops, a bad count rejects. */
export function normalizeUsedItem(v: unknown): UsedMediaItem | null {
  const item = normalizeStoredMediaItem(v)
  if (item === null || !isRecord(v) || !Number.isSafeInteger(v.count) || (v.count as number) < 0 || !Array.isArray(v.words)) return null
  const words = [...new Set(v.words.flatMap((w) => (typeof w === 'string' ? (normalizeWord(w) ?? []) : [])))].slice(0, MAX_ITEM_WORDS)
  // A row from the first demo build may carry `noAutoFavorite`; that rule is gone (demo 6A), so the field drops.
  return { ...item, count: v.count as number, words }
}

/** How an incoming item gets its stamp: main's clock, never the renderer's. */
export const stamp = (item: MediaItem, now: number): StoredMediaItem => ({ ...item, updatedAt: now })

/**
 * NEVER BACK IN TIME (YAZ-4381, the YAZ-3299 rule of `store.ts` `setSettings`): a change's stamp is `now`, or just
 * above the stamp it replaces when that is later. Two Macs share the library, and the newest stamp wins the merge; a
 * Mac whose clock runs ahead must not win over a later change made on this Mac.
 */
export const after = (now: number, ...before: (number | undefined)[]): number =>
  before.reduce<number>((at, b) => (b === undefined || b < at ? at : b + 1), now)

/** Null when the document is not a version-1 library at all (→ corrupt, moved aside); otherwise every readable row. */
export function sanitizeMediaLibrary(raw: unknown): MediaLibraryFile | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  // Newest-first, one row per `itemKey` (the first wins), capped — `guards.ts`'s one list rule.
  const list = (rows: unknown, cap: number) => cleanList(rows, normalizeStoredMediaItem, (item) => item.itemKey, cap)
  // A library from before YAZ-4157 has no `used`: it reads as none, and nothing else changes.
  const used = cleanList(raw.used, normalizeUsedItem, (item) => item.itemKey, MAX_MEDIA_USED)
  return { version: 1, favorites: list(raw.favorites, Infinity), recent: list(raw.recent, RECENT_LIMIT), used, removed: cleanRemoved(raw.removed, Infinity) }
}

/** The web app's `addFavorite`: a new key goes to the head, an existing one changes nothing. Nothing falls off (YAZ-4363). */
export function addFavorite(lib: MediaLibraryFile, item: MediaItem, now: number): MediaLibraryFile {
  if (lib.favorites.some((f) => f.itemKey === item.itemKey)) return lib
  // A favorite added again is newer than its removal (also one from a Mac whose clock runs ahead), so a merge keeps
  // it; the note has done its work. It is also newer than the head of the list, so it shows first on every Mac.
  const { [item.itemKey]: was, ...removed } = lib.removed
  return { ...lib, favorites: [stamp(item, after(now, was, lib.favorites[0]?.updatedAt)), ...lib.favorites], removed }
}

/**
 * A removal starts the item's count again (YAZ-4157 demo 6A): it becomes a favorite again after `AUTO_FAVORITE_USES`
 * more adds, the same rule as the first time, and never on the very next add. Its words stay. It is kept in `removed`
 * (YAZ-4364), so another Mac's file that still holds the favorite does not bring it back.
 *
 * Both stamps are newer than the rows they replace (`after`): the note is newer than the favorite, also one from a Mac
 * whose clock runs ahead (YAZ-4381), and the `used` row at count 0 is stamped again, so it wins over the other Mac's
 * row with the old count (YAZ-4380).
 */
export function removeFavorite(lib: MediaLibraryFile, itemKey: string, now: number): MediaLibraryFile {
  const row = lib.favorites.find((f) => f.itemKey === itemKey)
  if (row === undefined) return lib
  return {
    ...lib,
    favorites: lib.favorites.filter((f) => f !== row),
    used: lib.used.map((u) => (u.itemKey === itemKey ? { ...u, count: 0, updatedAt: after(now, u.updatedAt) } : u)),
    // Not capped here: the next read's merge caps it, and knows which old notes still hold a favorite back.
    removed: { ...lib.removed, [itemKey]: after(now, row.updatedAt, lib.removed[itemKey]) },
  }
}

/** The web app's `recordRecent`: an MRU — the item as it arrives NOW moves to the head, re-stamped above the head (`after`). */
export function recordRecent(lib: MediaLibraryFile, item: MediaItem, now: number): MediaLibraryFile {
  return { ...lib, recent: [stamp(item, after(now, lib.recent[0]?.updatedAt)), ...lib.recent.filter((r) => r.itemKey !== item.itemKey)].slice(0, RECENT_LIMIT) }
}

/** The item's row moved to the head of `used`, re-stamped — `edit` makes the new one from the old (or none) at `at`. */
function touchUsed(lib: MediaLibraryFile, item: MediaItem, now: number, edit: (before: UsedMediaItem | undefined, at: number) => UsedMediaItem): MediaLibraryFile {
  const before = lib.used.find((u) => u.itemKey === item.itemKey)
  return { ...lib, used: [edit(before, after(now, before?.updatedAt)), ...lib.used.filter((u) => u.itemKey !== item.itemKey)].slice(0, MAX_MEDIA_USED) }
}

/** `words` with `word` in front (once), capped. */
const withWord = (words: readonly string[], word: string | null): string[] =>
  word === null ? [...words] : [word, ...words.filter((w) => w !== word)].slice(0, MAX_ITEM_WORDS)

/** A row as it was, or a fresh one at 0 uses; the item's own fields are the ones that arrive now. */
const usedRow = (before: UsedMediaItem | undefined, item: MediaItem, now: number): UsedMediaItem => ({ ...stamp(item, now), count: before?.count ?? 0, words: before?.words ?? [] })

/**
 * One add to a board (YAZ-4157 D1, D9): the MRU as `recordRecent`, the count up by one, the search it was found
 * by as a word, and — at `AUTO_FAVORITE_USES` — a favorite. A removal restarts the count (`removeFavorite`).
 */
export function recordUse(lib: MediaLibraryFile, item: MediaItem, query: string, now: number): MediaLibraryFile {
  const next = recordRecent(
    touchUsed(lib, item, now, (before, at) => {
      const row = usedRow(before, item, at)
      return { ...row, count: row.count + 1, words: withWord(row.words, normalizeWord(query)) }
    }),
    item,
    now,
  )
  const row = next.used[0]
  return row.count >= AUTO_FAVORITE_USES ? addFavorite(next, item, now) : next
}

/**
 * "Add a word…" (YAZ-4157 D5): the word goes in front of the item's words. A word is not a use, so a known row keeps
 * its place and its count; an item never added starts a row at 0 uses. The row is stamped again (`after`): with two
 * Macs, the row with the newest stamp is the one that stays (YAZ-4380).
 */
export function addWord(lib: MediaLibraryFile, item: MediaItem, word: string, now: number): MediaLibraryFile {
  const clean = normalizeWord(word)
  if (clean === null) return lib
  const before = lib.used.find((u) => u.itemKey === item.itemKey)
  if (before === undefined) return touchUsed(lib, item, now, (_none, at) => ({ ...usedRow(undefined, item, at), words: [clean] }))
  if (before.words[0] === clean) return lib
  return { ...lib, used: lib.used.map((u) => (u === before ? { ...u, words: withWord(u.words, clean), updatedAt: after(now, u.updatedAt) } : u)) }
}

/**
 * `word` off the item's words (YAZ-4348 demo round 2: the × on a word chip in Search words…). The row stays, with its
 * count; a newer `updatedAt`, so the other Mac's merge keeps the removal. A word it does not have changes nothing.
 */
export function removeWord(lib: MediaLibraryFile, itemKey: string, word: string, now: number): MediaLibraryFile {
  const clean = normalizeWord(word)
  const before = lib.used.find((u) => u.itemKey === itemKey)
  if (clean === null || before === undefined || !before.words.includes(clean)) return lib
  return { ...lib, used: lib.used.map((u) => (u === before ? { ...u, words: u.words.filter((w) => w !== clean), updatedAt: after(now, u.updatedAt) } : u)) }
}

// ---------- Two Macs, one library (YAZ-4364, round 3 decision 2) ----------

/** `media-<12 a-z 0-9>.json` (the `macId` shape): one Mac's file. A copy (`media-x 2.json`, `.sync-conflict-…`) never counts. */
export const MEDIA_FILE_RE = /^media-[0-9a-z]{12}\.json$/

export const mediaFileName = (macId: string): string => `media-${macId}.json`

/**
 * `removed` without a bad entry, newest first: the newest `cap`, and every note in `held` past the cap. A file is read
 * whole (`Infinity`); the merge caps (YAZ-4366).
 */
function cleanRemoved(raw: unknown, cap: number, held: ReadonlySet<string> = new Set()): Record<string, number> {
  if (!isRecord(raw)) return {}
  const rows = Object.entries(raw).filter((e): e is [string, number] => e[0] !== '' && isFiniteNumber(e[1]))
  return Object.fromEntries(rows.sort((a, b) => b[1] - a[1]).filter(([key], i) => i < cap || held.has(key)))
}

/** Per itemKey the row with the newest `updatedAt` (a tie keeps the one seen first), newest first, capped. */
function newestRows<T extends StoredMediaItem>(lists: readonly (readonly T[])[], cap: number, keep: (row: T) => boolean = () => true): T[] {
  const best = new Map<string, { row: T; at: number }>()
  let seen = 0
  for (const list of lists) {
    for (const row of list) {
      const had = best.get(row.itemKey)
      if (had === undefined || row.updatedAt > had.row.updatedAt) best.set(row.itemKey, { row, at: had?.at ?? seen++ })
    }
  }
  return [...best.values()]
    .filter(({ row }) => keep(row))
    .sort((a, b) => b.row.updatedAt - a.row.updatedAt || a.at - b.at)
    .slice(0, cap)
    .map(({ row }) => row)
}

/**
 * Every Mac's file as ONE library (decision 2). Per itemKey the newest `updatedAt` wins. A removal is kept in
 * `removed` (itemKey → when), so a merge does not bring back a favorite that is older than its removal; a favorite
 * added again after it is newer, and stays. The first library wins a tie: the caller puts this Mac's own file first.
 *
 * The newest `MAX_MEDIA_REMOVED` notes stay, and past the cap every note that still holds back a favorite of an input
 * (YAZ-4366): the old `media.json` and the file of a Mac that no longer runs are never written again, so the favorite
 * they hold would come back the day its note dropped. One library within the cap is answered as it is.
 */
export function mergeMediaLibraries(libs: readonly MediaLibraryFile[]): MediaLibraryFile {
  if (libs.length === 0) return EMPTY_MEDIA_LIBRARY
  if (libs.length === 1 && Object.keys(libs[0].removed).length <= MAX_MEDIA_REMOVED) return libs[0]
  const removed: Record<string, number> = {}
  for (const lib of libs) for (const [key, at] of Object.entries(lib.removed)) if (!(at <= (removed[key] ?? -Infinity))) removed[key] = at
  const isRemoved = (row: StoredMediaItem) => row.updatedAt <= (removed[row.itemKey] ?? -Infinity)
  const held = new Set(libs.flatMap((l) => l.favorites.filter(isRemoved).map((row) => row.itemKey)))
  return {
    version: 1,
    favorites: newestRows(libs.map((l) => l.favorites), Infinity, (row) => !isRemoved(row)),
    recent: newestRows(libs.map((l) => l.recent), RECENT_LIMIT),
    used: newestRows(libs.map((l) => l.used), MAX_MEDIA_USED),
    removed: cleanRemoved(removed, MAX_MEDIA_REMOVED, held),
  }
}

// ---------- A Library move with a component name clash (YAZ-4378) ----------

/** The components that a Library move copied under another slug: old slug → the slug and name in the new folder. */
export type ComponentMoves = Readonly<Record<string, { readonly slug: string; readonly name: string }>>

/** A saved component's itemKey (`componentItem` in the renderer): its slug is its id. */
export const componentItemKey = (slug: string): string => `component:${slug}`

/**
 * The old folder's library with each moved component's rows on its new slug and name: `favorites`, `recent`, `used`
 * and `removed`. So after the move a favorite still means the component that was favorited, and its tile and its add
 * give the same one. Each row maps once, from its old slug: a chain of moves (`logo` → `logo-2`, `logo-2` → `logo-3`)
 * never maps a row twice. The library is answered as it is when no row moves.
 */
export function renameMovedComponents(lib: MediaLibraryFile, moves: ComponentMoves): MediaLibraryFile {
  if (Object.keys(moves).length === 0) return lib
  const moveOf = (itemKey: string) => {
    const slug = itemKey.startsWith('component:') ? itemKey.slice('component:'.length) : null
    return slug !== null && Object.hasOwn(moves, slug) ? moves[slug] : null
  }
  const row = <T extends StoredMediaItem>(r: T): T => {
    const to = r.provider === 'component' ? moveOf(r.itemKey) : null
    return to === null ? r : { ...r, itemKey: componentItemKey(to.slug), providerId: to.slug, title: to.name }
  }
  const removedKey = (key: string): string => {
    const to = moveOf(key)
    return to === null ? key : componentItemKey(to.slug)
  }
  return {
    ...lib,
    favorites: lib.favorites.map(row),
    recent: lib.recent.map(row),
    used: lib.used.map(row),
    removed: Object.fromEntries(Object.entries(lib.removed).map(([key, at]) => [removedKey(key), at])),
  }
}
