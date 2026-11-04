/**
 * The media library's RULES (🔒 YAZ-1775 D4 / D5, YAZ-1817), TDD'd with no Electron and no disk: what a
 * valid item is, and what add / remove / record do to the two lists. The main-process module
 * around this (`desktop/src/main/library/mediaStore.ts`) only reads, writes and watches the file.
 *
 * The validator semantics are the web app's `convex/mediaTypes.ts` verbatim: an item is whole or
 * it is not one at all. The FILE is lenient around that — a bad row is dropped, the rest survive.
 */
import { describe, expect, it } from 'vitest'
import { AUTO_FAVORITE_USES, MAX_ITEM_WORDS, MAX_MEDIA_USED, RECENT_LIMIT, type MediaItem, type MediaLibraryFile, type StoredMediaItem, type UsedMediaItem } from '@shared/types'
import { EMPTY_MEDIA_LIBRARY, addFavorite, addWord, normalizeMediaItem, normalizeStoredMediaItem, normalizeWord, recordRecent, recordUse, removeFavorite, sanitizeMediaLibrary, stamp } from '@shared/mediaLibrary'

/** The minimum a provider result has to carry: every required field of `mediaItemValidator`. */
const item = (over: Partial<MediaItem> = {}): MediaItem => ({ itemKey: 'pixabay:1', provider: 'pixabay', providerId: '1', kind: 'photo', title: 'A tree', ...over })
const stored = (over: Partial<StoredMediaItem> = {}): StoredMediaItem => ({ ...item(), updatedAt: 1000, ...over })

describe('normalizeMediaItem — the web app`s mediaItemValidator, field for field', () => {
  it('accepts the five required fields alone', () => {
    expect(normalizeMediaItem(item())).toEqual(item())
  })

  it('carries every optional field through when it is the right type', () => {
    const full = item({
      previewUrl: 'https://cdn/x.png',
      creator: 'Ada',
      creatorUrl: 'https://pixabay.com/users/ada',
      collectionName: 'Trees',
      sourceUrl: 'https://pixabay.com/photos/1',
      licenseName: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license',
      attribution: 'Ada on Pixabay',
      width: 640,
      height: 480,
      trademarkNotice: true,
    })
    expect(normalizeMediaItem(full)).toEqual(full)
  })

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 7, [], true]) expect(normalizeMediaItem(bad)).toBeNull()
  })

  it('rejects a missing or empty required field — an item with no identity is not an item', () => {
    expect(normalizeMediaItem({ ...item(), itemKey: undefined })).toBeNull()
    expect(normalizeMediaItem({ ...item(), itemKey: '' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), providerId: '' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), title: undefined })).toBeNull()
  })

  it('allows an EMPTY title — providers do serve untitled photos, and the tile falls back to the id', () => {
    expect(normalizeMediaItem({ ...item(), title: '' })?.title).toBe('')
  })

  it('rejects an unknown provider or kind, the way a union validator does', () => {
    expect(normalizeMediaItem({ ...item(), provider: 'unsplash' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), kind: 'video' })).toBeNull()
  })

  it('rejects a WRONG-TYPED optional rather than quietly dropping it — a half-read item is not one', () => {
    expect(normalizeMediaItem({ ...item(), creator: 7 })).toBeNull()
    expect(normalizeMediaItem({ ...item(), width: '640' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), trademarkNotice: 'yes' })).toBeNull()
  })

  it('rejects a non-finite dimension — NaN and Infinity survive JSON.parse of a hand-edited file', () => {
    expect(normalizeMediaItem({ ...item(), width: Number.NaN })).toBeNull()
    expect(normalizeMediaItem({ ...item(), height: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('drops an unknown field instead of storing it — the file stays the shape both apps read', () => {
    expect(normalizeMediaItem({ ...item(), rogue: 'x', updatedAt: 5 })).toEqual(item())
  })

  it('an absent optional stays absent — it is never written as undefined or null', () => {
    const out = normalizeMediaItem(item())
    expect(out !== null && 'creator' in out).toBe(false)
  })
})

describe('normalizeStoredMediaItem — the same, plus the stamp the file orders by', () => {
  it('needs a finite updatedAt', () => {
    expect(normalizeStoredMediaItem(stored())).toEqual(stored())
    expect(normalizeStoredMediaItem(item())).toBeNull()
    expect(normalizeStoredMediaItem({ ...stored(), updatedAt: 'yesterday' })).toBeNull()
    expect(normalizeStoredMediaItem({ ...stored(), updatedAt: Number.NaN })).toBeNull()
  })

  it('stamp() is how an incoming item gets one — main`s clock, never the renderer`s', () => {
    expect(stamp(item(), 42)).toEqual({ ...item(), updatedAt: 42 })
  })
})

describe('sanitizeMediaLibrary — lenient over the rows, strict about the file', () => {
  it('reads a well-formed file back unchanged', () => {
    const file = { version: 1, favorites: [stored()], recent: [stored({ itemKey: 'iconify:a', provider: 'iconify', providerId: 'a', kind: 'icon' })], used: [] }
    expect(sanitizeMediaLibrary(file)).toEqual(file)
  })

  it('CORRUPT (null) for anything that is not a version-1 library — the caller moves it aside', () => {
    for (const bad of [null, 'x', 7, [], { version: 2, favorites: [], recent: [] }, { favorites: [], recent: [] }]) expect(sanitizeMediaLibrary(bad)).toBeNull()
  })

  it('a missing or non-array list reads as empty rather than corrupting the whole file', () => {
    expect(sanitizeMediaLibrary({ version: 1 })).toEqual(EMPTY_MEDIA_LIBRARY)
    expect(sanitizeMediaLibrary({ version: 1, favorites: 'nope', recent: null })).toEqual(EMPTY_MEDIA_LIBRARY)
  })

  it('drops the rows it cannot read and keeps the ones it can', () => {
    const good = stored()
    const out = sanitizeMediaLibrary({ version: 1, favorites: [good, { itemKey: 'x' }, null], recent: [] })
    expect(out?.favorites).toEqual([good])
  })

  it('de-duplicates by itemKey, keeping the FIRST (newest) row', () => {
    const out = sanitizeMediaLibrary({ version: 1, favorites: [stored({ updatedAt: 9 }), stored({ updatedAt: 1 })], recent: [] })
    expect(out?.favorites).toEqual([stored({ updatedAt: 9 })])
  })

  it('enforces the recent cap on READ too; favorites have no cap (YAZ-4363): 600 stay 600', () => {
    const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => stored({ itemKey: `${prefix}${i}`, providerId: String(i) }))
    const out = sanitizeMediaLibrary({ version: 1, favorites: many(600, 'f'), recent: many(RECENT_LIMIT + 5, 'r') })
    expect(out?.favorites).toHaveLength(600)
    expect(out?.recent).toHaveLength(RECENT_LIMIT)
  })
})

describe('addFavorite (the web app`s addFavorite)', () => {
  it('puts a new favorite at the head, stamped with main`s clock', () => {
    const out = addFavorite(EMPTY_MEDIA_LIBRARY, item(), 500)
    expect(out.favorites).toEqual([stored({ updatedAt: 500 })])
    expect(out.recent).toEqual([])
  })

  it('an itemKey already favorited changes NOTHING — not the order, not the stamp', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored({ itemKey: 'b' }), stored({ itemKey: 'a', updatedAt: 1 })] }
    const after = addFavorite(before, item({ itemKey: 'a', title: 'renamed' }), 999)
    expect(after.favorites).toEqual(before.favorites)
  })

  it('never drops a favorite (YAZ-4363): the 601st add keeps all 600 before it', () => {
    const full = { ...EMPTY_MEDIA_LIBRARY, favorites: Array.from({ length: 600 }, (_, i) => stored({ itemKey: `f${i}` })) }
    const out = addFavorite(full, item({ itemKey: 'new' }), 500)
    expect(out.favorites).toHaveLength(601)
    expect(out.favorites[0].itemKey).toBe('new')
    expect(out.favorites.at(-1)?.itemKey).toBe('f599')
  })

  it('never touches the input', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored()] }
    const snapshot = structuredClone(before)
    addFavorite(before, item({ itemKey: 'other' }), 1)
    expect(before).toEqual(snapshot)
  })
})

describe('removeFavorite', () => {
  it('drops the one itemKey and leaves everything else in order', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored({ itemKey: 'a' }), stored({ itemKey: 'b' }), stored({ itemKey: 'c' })] }
    expect(removeFavorite(before, 'b').favorites.map((f) => f.itemKey)).toEqual(['a', 'c'])
  })

  it('an itemKey that is not there is a no-op, not an error', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored()] }
    expect(removeFavorite(before, 'nope')).toEqual(before)
  })

  it('never touches recent — the two lists are independent (unfavoriting does not forget a use)', () => {
    const before = { version: 1 as const, favorites: [stored({ itemKey: 'a' })], recent: [stored({ itemKey: 'a' })], used: [] }
    expect(removeFavorite(before, 'a').recent).toEqual(before.recent)
  })
})

describe('recordRecent (the web app`s recordRecent) — an MRU, not a log', () => {
  it('puts a first use at the head', () => {
    expect(recordRecent(EMPTY_MEDIA_LIBRARY, item(), 700).recent).toEqual([stored({ updatedAt: 700 })])
  })

  it('a use of something already there MOVES it to the head and re-stamps it, never duplicates', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, recent: [stored({ itemKey: 'b' }), stored({ itemKey: 'a', updatedAt: 1 })] }
    const after = recordRecent(before, item({ itemKey: 'a', title: 'A tree' }), 900)
    expect(after.recent.map((r) => r.itemKey)).toEqual(['a', 'b'])
    expect(after.recent[0].updatedAt).toBe(900)
  })

  it('re-records the item as it arrives NOW — a title or licence that changed is refreshed', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, recent: [stored({ itemKey: 'a', title: 'old' })] }
    expect(recordRecent(before, item({ itemKey: 'a', title: 'new' }), 5).recent[0].title).toBe('new')
  })

  it(`keeps exactly RECENT_LIMIT (${RECENT_LIMIT}), dropping the least recent`, () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, recent: Array.from({ length: RECENT_LIMIT }, (_, i) => stored({ itemKey: `r${i}` })) }
    const out = recordRecent(before, item({ itemKey: 'new' }), 5)
    expect(out.recent).toHaveLength(RECENT_LIMIT)
    expect(out.recent[0].itemKey).toBe('new')
    expect(out.recent.some((r) => r.itemKey === `r${RECENT_LIMIT - 1}`)).toBe(false)
  })

  it('never touches favorites — a favorite that is used stays favorited, once', () => {
    const before = { version: 1 as const, favorites: [stored({ itemKey: 'a' })], recent: [], used: [] }
    expect(recordRecent(before, item({ itemKey: 'a' }), 5).favorites).toEqual(before.favorites)
  })
})

// ---------- YAZ-4157: what the Add tab learns from each add ----------

const lib = (over: Partial<MediaLibraryFile> = {}): MediaLibraryFile => ({ ...EMPTY_MEDIA_LIBRARY, ...over })
const used = (over: Partial<UsedMediaItem> = {}): UsedMediaItem => ({ ...stored(), count: 1, words: [], ...over })
const component = item({ itemKey: 'component:pricing-card', provider: 'component', providerId: 'pricing-card', kind: 'component', title: 'Pricing card' })

describe('the used list in the file (YAZ-4157 D1)', () => {
  it('a library from before YAZ-4157 (no used) reads as none and keeps everything else', () => {
    const before = { version: 1, favorites: [stored()], recent: [stored()] }
    expect(sanitizeMediaLibrary(before)).toEqual({ ...before, used: [] })
  })

  it('reads a used row back, and drops a row with a bad count — the other rows survive', () => {
    const good = used({ count: 4, words: ['tree'] })
    // The first demo build's `noAutoFavorite` mark (demo 6A) reads as nothing.
    const out = sanitizeMediaLibrary({ version: 1, favorites: [], recent: [], used: [{ ...good, noAutoFavorite: true }, { ...used({ itemKey: 'pixabay:2' }), count: -1 }, { ...used({ itemKey: 'pixabay:3' }), count: 1.5 }] })
    expect(out?.used).toEqual([good])
  })

  it('cleans the words of a hand-edited row: case, spaces, repeats, non-strings, the cap', () => {
    const words = ['  Big   Tree ', 'big tree', 7, '', ...Array.from({ length: MAX_ITEM_WORDS + 5 }, (_, i) => `w${i}`)]
    const out = sanitizeMediaLibrary({ version: 1, favorites: [], recent: [], used: [{ ...used(), words }] })
    expect(out?.used[0].words[0]).toBe('big tree')
    expect(out?.used[0].words).toHaveLength(MAX_ITEM_WORDS)
  })

  it(`keeps ${MAX_MEDIA_USED} rows on read`, () => {
    const many = Array.from({ length: MAX_MEDIA_USED + 3 }, (_, i) => used({ itemKey: `u${i}`, providerId: String(i) }))
    expect(sanitizeMediaLibrary({ version: 1, favorites: [], recent: [], used: many })?.used).toHaveLength(MAX_MEDIA_USED)
  })

  it('a saved component is a media item (D2): provider and kind component, the slug as its id', () => {
    expect(normalizeMediaItem(component)).toEqual(component)
  })
})

describe('normalizeWord', () => {
  it('trims, lowers and joins spaces; nothing left or too long is no word', () => {
    expect(normalizeWord('  Rocket  Ship ')).toBe('rocket ship')
    expect(normalizeWord('   ')).toBeNull()
    expect(normalizeWord('x'.repeat(61))).toBeNull()
  })
})

describe('recordUse — one add (YAZ-4157 D1, D9)', () => {
  it('a first add: the MRU head, a used row at 1 with the search as its word', () => {
    const out = recordUse(lib(), item(), '  Tree ', 50)
    expect(out.recent).toEqual([stamp(item(), 50)])
    expect(out.used).toEqual([{ ...stamp(item(), 50), count: 1, words: ['tree'] }])
    expect(out.favorites).toEqual([])
  })

  it('an add with an empty search counts the use and learns no word; a repeat word is not stored twice', () => {
    const once = recordUse(lib(), item(), 'tree', 1)
    const twice = recordUse(once, item(), '', 2)
    const thrice = recordUse(twice, item(), 'TREE', 3)
    expect(thrice.used[0]).toMatchObject({ count: 3, words: ['tree'] })
  })

  it('the newest word goes first', () => {
    const out = recordUse(recordUse(lib(), item(), 'tree', 1), item(), 'oak', 2)
    expect(out.used[0].words).toEqual(['oak', 'tree'])
  })

  it(`the add number ${AUTO_FAVORITE_USES} makes the item a favorite, once`, () => {
    let state = lib()
    for (let i = 1; i < AUTO_FAVORITE_USES; i++) state = recordUse(state, item(), '', i)
    expect(state.favorites).toEqual([])
    state = recordUse(state, item(), '', 10)
    expect(state.favorites).toEqual([stamp(item(), 10)])
    expect(recordUse(state, item(), '', 11).favorites).toEqual([stamp(item(), 10)])
  })

  it(`a removed favorite starts its count again: ${AUTO_FAVORITE_USES} more adds bring it back, not the next one (demo 6A)`, () => {
    let state = lib()
    for (let i = 1; i <= AUTO_FAVORITE_USES; i++) state = recordUse(state, item(), 'tree', i)
    state = removeFavorite(state, item().itemKey)
    expect(state.used[0]).toMatchObject({ count: 0, words: ['tree'] })
    for (let i = 1; i < AUTO_FAVORITE_USES; i++) state = recordUse(state, item(), '', 20 + i)
    expect(state.favorites).toEqual([])
    state = recordUse(state, item(), '', 30)
    expect(state.favorites).toEqual([stamp(item(), 30)])
  })

  it('removing a favorite that was never added to a board changes only the favorites', () => {
    expect(removeFavorite(lib({ favorites: [stored()] }), stored().itemKey)).toEqual(lib())
  })

  it(`moves the item to the head of used and keeps ${MAX_MEDIA_USED} rows`, () => {
    const many = Array.from({ length: MAX_MEDIA_USED }, (_, i) => used({ itemKey: `u${i}`, providerId: String(i) }))
    const out = recordUse(lib({ used: many }), item(), '', 5)
    expect(out.used).toHaveLength(MAX_MEDIA_USED)
    expect(out.used[0].itemKey).toBe(item().itemKey)
    expect(out.used.at(-1)?.itemKey).toBe(`u${MAX_MEDIA_USED - 2}`)
  })

  it('counts a component like any item', () => {
    let state = lib()
    for (let i = 0; i < AUTO_FAVORITE_USES; i++) state = recordUse(state, component, 'pricing', i)
    expect(state.favorites.map((f) => f.itemKey)).toEqual(['component:pricing-card'])
  })

  it('never touches the input', () => {
    const before = lib({ used: [used()] })
    const copy = structuredClone(before)
    recordUse(before, item(), 'tree', 9)
    expect(before).toEqual(copy)
  })
})

describe('addWord — "Add a word…" (YAZ-4157 D5)', () => {
  it('a known row gets the word in front and keeps its place, its stamp and its count', () => {
    const rows = [used({ itemKey: 'other', providerId: 'o' }), used({ count: 2, words: ['tree'] })]
    const out = addWord(lib({ used: rows }), item(), ' Oak ', 99)
    expect(out.used[1]).toEqual({ ...rows[1], words: ['oak', 'tree'] })
    expect(out.used[0]).toBe(rows[0])
  })

  it('an item never added starts a row at 0 uses — a word is not a use', () => {
    const out = addWord(lib(), item(), 'oak', 7)
    expect(out.used).toEqual([{ ...stamp(item(), 7), count: 0, words: ['oak'] }])
    expect(out.recent).toEqual([])
  })

  it('an empty word, or the word already first, changes nothing', () => {
    const state = lib({ used: [used({ words: ['oak'] })] })
    expect(addWord(state, item(), '  ', 1)).toBe(state)
    expect(addWord(state, item(), 'OAK', 1)).toBe(state)
  })
})
