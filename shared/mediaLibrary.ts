/**
 * The media library's RULES (🔒 YAZ-1775 D4 / D5, YAZ-1817): what a valid item is, and what add / remove /
 * record do to the lists in `<library>/media.json`. Pure and Electron-free — the main-process
 * store around it (`desktop/src/main/library/mediaStore.ts`) only reads, writes and watches the
 * file, so every rule here is unit-tested with no disk.
 *
 * The item validator is the web app's `convex/mediaTypes.ts` verbatim: an item is whole or it is
 * not one at all (a wrong-typed optional REJECTS rather than being dropped — a half-read item
 * would show a broken tile). The FILE is lenient around that: a bad row is dropped, the rest
 * survive, so one hand-edit cannot cost the user 499 favorites. Both lists are newest-first,
 * de-duplicated by `itemKey`, and capped on the tail — the same order the web app's
 * `by_ownerId_and_updatedAt` index answered in.
 */
import {
  AUTO_FAVORITE_USES,
  MAX_ITEM_WORDS,
  MAX_ITEM_WORD_LENGTH,
  MAX_MEDIA_FAVORITES,
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

export const EMPTY_MEDIA_LIBRARY: MediaLibraryFile = { version: 1, favorites: [], recent: [], used: [] }


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

/** Null when the document is not a version-1 library at all (→ corrupt, moved aside); otherwise every readable row. */
export function sanitizeMediaLibrary(raw: unknown): MediaLibraryFile | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  // Newest-first, one row per `itemKey` (the first wins), capped — `guards.ts`'s one list rule.
  const list = (rows: unknown, cap: number) => cleanList(rows, normalizeStoredMediaItem, (item) => item.itemKey, cap)
  // A library from before YAZ-4157 has no `used`: it reads as none, and nothing else changes.
  const used = cleanList(raw.used, normalizeUsedItem, (item) => item.itemKey, MAX_MEDIA_USED)
  return { version: 1, favorites: list(raw.favorites, MAX_MEDIA_FAVORITES), recent: list(raw.recent, RECENT_LIMIT), used }
}

/** The web app's `addFavorite`: a new key goes to the head, an existing one changes nothing. */
export function addFavorite(lib: MediaLibraryFile, item: MediaItem, now: number): MediaLibraryFile {
  if (lib.favorites.some((f) => f.itemKey === item.itemKey)) return lib
  return { ...lib, favorites: [stamp(item, now), ...lib.favorites].slice(0, MAX_MEDIA_FAVORITES) }
}

/**
 * A removal starts the item's count again (YAZ-4157 demo 6A): it becomes a favorite again after `AUTO_FAVORITE_USES`
 * more adds, the same rule as the first time, and never on the very next add. Its words stay.
 */
export function removeFavorite(lib: MediaLibraryFile, itemKey: string): MediaLibraryFile {
  if (!lib.favorites.some((f) => f.itemKey === itemKey)) return lib
  return { ...lib, favorites: lib.favorites.filter((f) => f.itemKey !== itemKey), used: lib.used.map((u) => (u.itemKey === itemKey ? { ...u, count: 0 } : u)) }
}

/** The web app's `recordRecent`: an MRU — the item as it arrives NOW moves to the head, re-stamped. */
export function recordRecent(lib: MediaLibraryFile, item: MediaItem, now: number): MediaLibraryFile {
  return { ...lib, recent: [stamp(item, now), ...lib.recent.filter((r) => r.itemKey !== item.itemKey)].slice(0, RECENT_LIMIT) }
}

/** The item's row moved to the head of `used`, re-stamped — `edit` makes the new one from the old (or none). */
function touchUsed(lib: MediaLibraryFile, item: MediaItem, now: number, edit: (before: UsedMediaItem | undefined) => UsedMediaItem): MediaLibraryFile {
  const before = lib.used.find((u) => u.itemKey === item.itemKey)
  return { ...lib, used: [edit(before), ...lib.used.filter((u) => u.itemKey !== item.itemKey)].slice(0, MAX_MEDIA_USED) }
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
    touchUsed(lib, item, now, (before) => {
      const row = usedRow(before, item, now)
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
 * its place and its stamp; an item never added starts a row at 0 uses.
 */
export function addWord(lib: MediaLibraryFile, item: MediaItem, word: string, now: number): MediaLibraryFile {
  const clean = normalizeWord(word)
  if (clean === null) return lib
  const before = lib.used.find((u) => u.itemKey === item.itemKey)
  if (before === undefined) return touchUsed(lib, item, now, () => ({ ...usedRow(undefined, item, now), words: [clean] }))
  if (before.words[0] === clean) return lib
  return { ...lib, used: lib.used.map((u) => (u === before ? { ...u, words: withWord(u.words, clean) } : u)) }
}
