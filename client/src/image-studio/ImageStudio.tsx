/**
 * THE ADD TAB (YAZ-4157; before it, the Images tab of 🔒 YAZ-1775 D4 / YAZ-1818 and the Components tab of YAZ-1819):
 * ONE field over everything a board can take — your favorites, your recent adds, your saved components, the shapes,
 * Excalidraw's public libraries, and the web (Iconify, Pixabay, over the providers MAIN owns). The renderer never holds
 * an API key and never reaches a provider.
 *
 * WHAT IT SHOWS (D7). An empty field shows Favorites, Recent, Components and Shapes, one row each. A typed field shows
 * "Best matches" — every local item, in the ONE order of `rankItems` (D4) — then "Hand-drawn" (the library items, ranked
 * the same way as you type, demo 6K), then "From the web", one tile per icon with its variants on request (demo 6J).
 * Filter › Show (the old chips, D8) narrows them.
 *
 * WHAT IT LEARNS (D1, D5, D9). Each add is one `media:used` write: the MRU, the count, the text it was found by as a
 * word, and at the third add a favorite — said once, quietly, with Undo. A removed favorite starts its count again:
 * three more adds bring it back (demo 6A). "Search words…" (a right-click on a tile) teaches a word by hand.
 *
 * A PREVIEW IS ASKED FOR, NOT LINKED TO. Every media tile asks `media:preview` for its bytes as a dataURL, because the
 * renderer may not fetch from a provider; a favorite's stored `previewUrl` is never read. A component's picture is
 * `components:preview`, and a Hand-drawn item's is drawn here from its elements. The caches are bounded
 * (`lib/previewCache.tsx`).
 *
 * NO KEY IS NOT AN ERROR (🔒 YAZ-1775 D4): with no Pixabay key there is no Filter › Show › Photos, and nothing explains why.
 * OFFLINE IS A STATE, NOT A BANNER: the web half says so in one line; everything local keeps working.
 *
 * THE SMART SHAPES ARRIVE LATE ON PURPOSE. `@excalidraw/element` is a second ~300 kB download (`engine.ts`'s lazy
 * rule), so the seven basic shapes render immediately and the twelve Smart Shapes join when it lands.
 *
 * WHAT IT REMEMBERS LIVES ELSEWHERE (🔒 YAZ-1990). Closing the canvas panel unmounts this tab, so the chip, the query,
 * the results and the scroll are `imageStudioSession.ts`'s; this component renders them and keeps what one click has
 * in flight.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { MAX_COMPONENT_NAME_LENGTH, MAX_ITEM_WORD_LENGTH, PIXABAY_SECRET, type ComponentItem, type MediaBytesProvider, type MediaLibraryFile, type StudioItem } from '@shared/types'
import { DEFAULT_MEDIA_FILTERS, needsCredit, sanitizeMediaFilters, type IconPackInfo, type MediaFilters } from '@shared/iconPacks'
import { parseComponentFragment } from '@shared/savedComponents'
import { api } from '../api'
import { storage } from '../lib/storage'
import { createPreviewCache } from '../lib/previewCache'
import { createScenePreviewPng, type PreviewBounds, type PreviewEngine } from '../lib/scenePreview'
import { loadExcalidrawElement } from '../drawings/engine'
import type { ComponentEngine, ComponentTarget } from '../components-library/componentData'
import { componentFragmentJson, insertComponent } from '../components-library/componentData'
import { captureImageFile, isTextPaste, nameFromFile, PASTE_IMAGE_TYPES, pastedImages } from '../components-library/pastedImage'
import { componentItem, componentPreviews, useComponentLibrary } from '../components-library/useComponentLibrary'
import { insertImage, insertShape, fileFromImport, type InsertEngine, type InsertTarget } from './insertShape'
import { buildShapeCatalog, getShape, shapeAliases, type ShapeCatalogItem, type ShapePreview, type SmartShapeApi } from './shapes'
import { groupResults } from './groupResults'
import { FilterMenu } from './FilterMenu'
import { IconPacksFooter } from './IconPacksFooter'
import { PackView } from './PackView'
import { useIconPacks } from './useIconPacks'
import { rankItems } from './rankItems'
import {
  MIN_QUERY,
  chipSource,
  clearShowAndFilters,
  closePack,
  OFFLINE_WITH_PACKS_NOTICE,
  openPack,
  setFilters,
  setPackInfo,
  typePackQuery,
  getErrorMessage,
  imageStudioSession,
  OFFLINE_NOTICE,
  pickChip,
  runSearch,
  scrollTops,
  searchNow,
  STUDIO_CHIPS,
  STUDIO_CHIP_LABELS,
  typeQuery,
  wasRequested,
  type StudioChip,
} from './imageStudioSession'
import './imageStudio.css'


/**
 * One row of the grid: what a section shows before "Show all" (D7). Four at the panel's usual width; a wider panel
 * (YAZ-4348 demo round 2: "one would expect more icons to show up instead of only getting them bigger") fits one
 * more column for each `TILE_MIN_WIDTH` it gains.
 */
const MIN_ROW = 4
const TILE_MIN_WIDTH = 84
const TILE_GAP = 6
/** The columns a list of this width holds. */
const rowFor = (width: number): number => Math.max(MIN_ROW, Math.floor((width + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP)))
/** How many of your own matches a typed field shows at a time; "Show more" grows it. */
const MATCH_PAGE = 48
/** How to save a copied picture at full size (demo 6M), under Components. */
const PASTE_HINT = 'Copy a picture anywhere, then press ⌘V here to save it to your library at full size. You can drop a picture file here too.'

/** No item touched during this search: one empty set, so `shownElsewhere` keeps its identity. */
const NOTHING_TOUCHED: ReadonlySet<string> = new Set()

/** What an add says on a read-only board, where it puts nothing. */
export const READ_ONLY_NOTICE = 'This board is read only. Click “Allow edits” on its Read only chip to add to it.'
/**
 * How many tiles the pack page shows before "Show more" (YAZ-4366 audit 70). A big pack scrolled whole put thousands
 * of tiles in the list, and each panel change (an add, an open menu) built every one again. The infinite scroll goes
 * on up to the cap; "Show more" lifts it by the same step. Every shown tile stays in the DOM, so the arrow keys still
 * walk all of them.
 */
const PACK_PAGE = 240
/** How many hand-drawn matches show at first (demo 6K): two rows; "Show more" adds `MATCH_PAGE`. */
const DRAWING_PAGE = 8

export interface ImageStudioProps {
  /** The engine values an insert, a component capture and a component preview need. */
  engine: InsertEngine & ComponentEngine & PreviewEngine
  /** The engine's imperative handle; `CanvasSidebar` does not render a tab without one. */
  excalidrawAPI: InsertTarget & ComponentTarget
  /** Whether the canvas holds a selection right now — the gate of "Save selection" (D6). */
  hasSelection: boolean
  /** Set by a ⌘F that opened the tab: put the caret in the field (the web app's own pattern). */
  searchFocusPending?: boolean
  /** Called once the field has the focus, so the request is taken exactly once (🔒 YAZ-1990). */
  onSearchFocused?: () => void
  /** The board's right-click "Save to library…" (demo 6L): open the name form for the selection, then call the taker. */
  saveRequestPending?: boolean
  onSaveRequestTaken?: () => void
  /** A read-only board: an add puts nothing on it, so it records no use either. */
  readOnly?: boolean
  /** The board's theme, which the Hand-drawn tile pictures are drawn in. */
  theme?: 'light' | 'dark'
}

/** A catalog shape as a studio item, so one grid renders every kind. */
const shapeItem = (shape: ShapeCatalogItem): StudioItem => ({
  itemKey: `shape:${shape.id}`,
  provider: 'shape',
  providerId: shape.id,
  kind: 'shape',
  title: shape.title,
})

/** Whether an item belongs under a chip. */
function inChip(chip: StudioChip, item: StudioItem, favoriteKeys: ReadonlySet<string>): boolean {
  switch (chip) {
    case 'all':
      return true
    case 'favorites':
      return favoriteKeys.has(item.itemKey)
    case 'components':
      return item.provider === 'component'
    case 'shapes':
      return item.provider === 'shape'
    case 'icons':
      return item.provider === 'iconify'
    case 'photos':
      return item.provider === 'pixabay'
  }
}

/**
 * The media tile pictures. Keyed `provider:id` — the same key main's 24 h disk cache uses. Exported so a test starts
 * with an empty one. Bounded (YAZ-2073 5J, YAZ-3737 S13): 300 pictures and 32 MB of dataURLs at most.
 */
const previews = createPreviewCache(async (key) => {
  const [provider, ...rest] = key.split(':')
  const { dataURL } = await api.media.preview({ provider: provider as MediaBytesProvider, id: rest.join(':') })
  return dataURL
}, { limit: 300, maxBytes: 32 * 1024 * 1024 })
/**
 * What a hand-drawn tile (demo 6K) is drawn with: the board's engine and its look (its background). Set by the mounted
 * tab in an effect; the cache below is module scope like the others, so it outlives a close of the panel. The theme is
 * in the picture's KEY (`<theme>|<id>`), so a board in the other theme gets its own picture (polish, audit 9).
 */
let drawingCanvas: { engine: ComponentEngine & PreviewEngine; appState: () => Record<string, unknown> } | null = null
const DRAWING_TILE_BOUNDS: PreviewBounds = { maxWidth: 240, maxHeight: 240, padding: 8 }
/** The picture of what the save step saves (demo 6O). */
const SAVING_PREVIEW_BOUNDS: PreviewBounds = { maxWidth: 480, maxHeight: 240, padding: 8 }
/** A library item's picture: its elements from main (one library file serves all its items), drawn here as a PNG. */
const drawingPreviews = createPreviewCache(async (key) => {
  if (drawingCanvas === null) throw new Error('No board to draw with')
  const { engine } = drawingCanvas
  const [theme, id] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]
  const { elements } = await api.media.drawing({ id })
  const restored = engine.restoreElements(elements as never, null) as unknown as unknown[]
  return createScenePreviewPng(engine, { elements: restored, appState: { ...drawingCanvas.appState(), theme }, files: {} }, DRAWING_TILE_BOUNDS)
}, { limit: 300, maxBytes: 16 * 1024 * 1024 })

/**
 * The tile picture of an elements favorite from its own copy (YAZ-4370): a component that was deleted, a shape that
 * left the catalog, a library item (its copy first, else the network). Keyed `<theme>|<itemKey>`.
 */
const copyPreviews = createPreviewCache(async (key) => {
  if (drawingCanvas === null) throw new Error('No board to draw with')
  const { engine } = drawingCanvas
  const [theme, itemKey] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]
  const copy = await api.media.favoriteElements(itemKey)
  const fragment = copy !== null ? parseComponentFragment(copy) : itemKey.startsWith('excalidraw:') ? { elements: (await api.media.drawing({ id: itemKey.slice('excalidraw:'.length) })).elements, files: {} } : null
  if (fragment === null) throw new Error('No copy to draw')
  const restored = engine.restoreElements(fragment.elements as never, null) as unknown as unknown[]
  return createScenePreviewPng(engine, { elements: restored, appState: { ...drawingCanvas.appState(), theme }, files: fragment.files }, DRAWING_TILE_BOUNDS)
}, { limit: 300, maxBytes: 16 * 1024 * 1024 })

/**
 * Every pack the panel can name (Filter › Packs, the pack page, YAZ-4360 / YAZ-4361): asked once a window, when first
 * needed — main answers the Mac's packs or Iconify's list. A failure is forgotten, so the next ask retries.
 */
let packList: Promise<IconPackInfo[]> | null = null
export function loadPackList(): Promise<IconPackInfo[]> {
  if (packList !== null) return packList
  const asked = api.media.packList()
  packList = asked
  asked.catch(() => {
    if (packList === asked) packList = null
  })
  return asked
}

/** The settings' filters and pins, read where the panel has no settings prop (`storage`, which a test may not have). */
const settingsFilters = (): MediaFilters => sanitizeMediaFilters(storage.getSettings()?.mediaFilters ?? DEFAULT_MEDIA_FILTERS)
const settingsPins = (): string[] => storage.getSettings()?.mediaPinnedPacks ?? []
const settingsGroupSimilar = (): boolean => storage.getSettings()?.mediaGroupSimilar ?? true
/** The pins as they are now, or the same array when they hold the same packs, so a settings broadcast renders nothing. */
const samePins = (now: string[], next: string[]): string[] => (now.length === next.length && now.every((p, i) => p === next[i]) ? now : next)

export const clearPreviewMemo = () => {
  packList = null
  previews.clear()
  copyPreviews.clear()
  drawingPreviews.clear()
  componentPreviews.clear()
}

/** A shape tile's picture: one of six stock outlines, or the engine's own generated path. */
function ShapeTile({ preview }: { preview: ShapePreview }) {
  if (preview.type === 'smart') {
    return (
      <svg viewBox={preview.viewBox} aria-hidden="true">
        {preview.closed ? (
          <polygon className="image-studio__shape-path--closed" points={preview.points} />
        ) : (
          <polyline className="image-studio__shape-path--open" points={preview.points} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    )
  }
  if (preview.shape === 'rectangle') {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <rect className="image-studio__shape-path--basic" x="10" y="20" width="80" height="60" rx="12" />
      </svg>
    )
  }
  if (preview.shape === 'ellipse') {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <ellipse className="image-studio__shape-path--basic" cx="50" cy="50" rx="40" ry="34" />
      </svg>
    )
  }
  const points =
    preview.shape === 'diamond'
      ? '50,7 93,50 50,93 7,50'
      : preview.shape === 'triangle'
        ? '50,10 90,88 10,88'
        : preview.shape === 'hexagon'
          ? '25,10 75,10 94,50 75,90 25,90 6,50'
          : '50,5 61,36 95,38 68,58 78,91 50,71 22,91 32,58 5,38 39,36'
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <polygon className="image-studio__shape-path--basic" points={points} />
    </svg>
  )
}

interface InlineFormProps {
  item: StudioItem
  /** Rename (a component's name), else "Search words…". */
  renaming: boolean
  initial: string
  /** The words that find the item now, after its name. */
  words: readonly string[]
  /** The search text as a one-click word, or '' (`wordToOffer`). */
  offer: string
  notch: CSSProperties
  onWord: (word: string) => void
  onRemoveWord: (word: string) => void
  onRename: (name: string) => void
  onClose: () => void
}

/**
 * The full-width row that "Search words…" or Rename opens under the tile's row. Its own component, so a key typed in
 * its field renders this row only, not the whole panel with every grid and tile (YAZ-4366 audit 68).
 */
function InlineForm({ item, renaming, initial, words, offer, notch, onWord, onRemoveWord, onRename, onClose }: InlineFormProps) {
  const [draft, setDraft] = useState(initial)
  // YAZ-4348 demo round 2: the field empties for the next word; the row stays open, with the new chip in it.
  const addWord = (word: string) => {
    if (word.trim() === '') return
    setDraft('')
    onWord(word)
  }
  return (
    <form
      className={renaming ? 'image-studio__inline' : 'image-studio__inline image-studio__word-form'}
      style={notch}
      onSubmit={(event) => {
        event.preventDefault()
        if (renaming) onRename(draft)
        else addWord(draft)
      }}
    >
      {!renaming && (
        // YAZ-4348 demo round 2: every word that finds it shows (its name first), and a new one is ADDED to them
        <div className="image-studio__word-head">
          <span>
            Search words for <b>{item.title}</b>
          </span>
          <span className="image-studio__word-chips" aria-label={`Words that find ${item.title}`}>
            <span className="image-studio__word-chip is-name" title="Its name always finds it">
              {item.title.toLowerCase()}
            </span>
            {words.map((w) => (
              <span className="image-studio__word-chip" key={w}>
                {w}
                <button type="button" className="image-studio__word-remove" aria-label={`Remove the word “${w}”`} title="Remove this word" onClick={() => onRemoveWord(w)}>
                  ×
                </button>
              </span>
            ))}
          </span>
        </div>
      )}
      {/* Autofocused: the menu item above is the only way here. */}
      <input
        autoFocus
        value={draft}
        maxLength={renaming ? MAX_COMPONENT_NAME_LENGTH : MAX_ITEM_WORD_LENGTH}
        aria-label={renaming ? `Rename ${item.title}` : `A word for ${item.title}`}
        placeholder={renaming ? 'Name' : 'A new word, like “person”'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      />
      <button type="submit">{renaming ? 'Save' : 'Add word'}</button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      {offer !== '' && (
        <span className="image-studio__word-offer">
          Your search:
          <button type="button" onClick={() => addWord(offer)}>
            + {offer}
          </button>
        </span>
      )}
    </form>
  )
}

/** Where a tile's menu opens: at the pointer, or at the tile's corner from the keyboard. `right` keeps it in the panel. */
type MenuAt = { top: number; left?: number; right?: number }
/**
 * The tile whose menu or row is open. `key` is a SLOT — the section and the item — not the item alone: one item can be
 * in two sections at once (a favorite component is in Favorites and in Components), and only the tile that was
 * right-clicked opens (demo 6B).
 */
type OpenTile = { key: string; mode: 'menu'; at: MenuAt } | { key: string; mode: 'word' | 'rename' | 'confirm' } | null
const slotOf = (where: string, item: StudioItem) => `${where}|${item.itemKey}`
/** Where the focus goes after a favorite change: the tile's own button, else the one that took its place, else the field. */
type FocusPlan = { slot: string; section: Element | null; index: number; fromMenu: boolean }

/** Where an item comes from, in words (demo 6H): the tile's tooltip and the first line of its menu. */
export function sourceLabel(item: StudioItem): string {
  if (item.provider === 'iconify') return item.collectionName ? `Iconify · ${item.collectionName}` : 'Iconify'
  if (item.provider === 'pixabay') return item.creator ? `Pixabay · ${item.creator}` : 'Pixabay'
  if (item.provider === 'excalidraw') return item.collectionName ? `Excalidraw library · ${item.collectionName}` : 'Excalidraw library'
  return item.provider === 'component' ? 'Your component' : 'Built-in shape'
}

/** The line an add of a CC-BY icon shows (extra 16): its pack's license asks for a credit where the work is published. */
export const creditReminder = (item: StudioItem): string =>
  `Credit needed: ${item.collectionName ?? 'this pack'} is ${item.licenseName}. Name its author where you publish this board.`

/** Google Images for the text in the field (demo 6I): opened in the browser, never fetched by the app. */
export const googleImagesUrl = (query: string) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query.trim())}`

/** About the menu's drawn width: a menu that would pass the list's right edge opens to the left instead. */
const MENU_WIDTH = 150
/** The room a menu keeps from the list's bottom edge when it moves up to fit (YAZ-302, checked for YAZ-4365). */
const MENU_EDGE_GAP = 4

/** The quiet line under the field (D9): one sentence, and the item Undo takes back out of the favorites. */
type Line = { text: string; undo?: StudioItem } | null

/**
 * Arrow keys between tiles (D7). Left and right walk the tiles in reading order; up and down keep the column, and
 * cross into the next or the previous section. ArrowUp from the first row goes back to the field.
 */
function moveBetweenTiles(event: KeyboardEvent<HTMLElement>, list: HTMLElement | null, field: HTMLInputElement | null, ROW: number) {
  const from = event.target as HTMLElement
  if (list === null || !from.classList.contains('image-studio__add')) return
  const grids = [...list.querySelectorAll<HTMLElement>('.image-studio__grid')]
  const tilesOf = (grid: HTMLElement) => [...grid.querySelectorAll<HTMLButtonElement>('.image-studio__add')]
  const all = grids.flatMap(tilesOf)
  const at = all.indexOf(from as HTMLButtonElement)
  if (at === -1) return
  let to: HTMLElement | null | undefined
  if (event.key === 'ArrowRight') to = all[at + 1]
  else if (event.key === 'ArrowLeft') to = all[at - 1]
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const g = grids.findIndex((grid) => grid.contains(from))
    const tiles = tilesOf(grids[g])
    const i = tiles.indexOf(from as HTMLButtonElement)
    const col = i % ROW
    if (event.key === 'ArrowDown') {
      const next = grids.slice(g + 1).map(tilesOf).find((t) => t.length > 0)
      to = tiles[i + ROW] ?? (i + ROW < Math.ceil(tiles.length / ROW) * ROW ? tiles.at(-1) : next?.[Math.min(col, next.length - 1)])
    } else {
      const prev = grids.slice(0, g).map(tilesOf).filter((t) => t.length > 0).at(-1)
      to = i >= ROW ? tiles[i - ROW] : prev ? prev[Math.min(Math.floor((prev.length - 1) / ROW) * ROW + col, prev.length - 1)] : field
    }
  } else return
  if (!to) return
  event.preventDefault()
  to.focus()
}

export function ImageStudio({ engine, excalidrawAPI, hasSelection, searchFocusPending = false, onSearchFocused, saveRequestPending = false, onSaveRequestTaken, readOnly = false, theme = 'light' }: ImageStudioProps) {
  // The session outlives this component (🔒 YAZ-1990 D2): closing the panel unmounts it, reopening reads it back.
  const session = useSyncExternalStore(imageStudioSession.subscribe, imageStudioSession.getState)
  const { chip, query, searchedQuery, results, cursor, warnings, isSearching, waiting, offline, pageError, error, pixabayAvailable, favorites, recent, used, components, drawings, recentOpen, smart, filters, pack } = session
  const { set } = imageStudioSession
  const packsStatus = useIconPacks()
  // The filters, the pins and Similar icons live in the settings (they travel); the session holds a copy of the
  // filters for the search to send. A change from another window searches again, as a pick in the menu does
  // (YAZ-4384); the same filters ask nothing. `read` runs on each settings broadcast (a tab click too), so the same
  // values keep the same state and render nothing (YAZ-4366 audit 67, 69).
  const [pinned, setPinned] = useState<string[]>(settingsPins)
  // Filter › Similar icons (YAZ-4348 demo round 2): the "+N" groups, or every icon as its own tile.
  const [groupSimilar, setGroupSimilar] = useState<boolean>(settingsGroupSimilar)
  useEffect(() => {
    const read = () => {
      setFilters(settingsFilters())
      setPinned((now) => samePins(now, settingsPins()))
      setGroupSimilar(settingsGroupSimilar())
    }
    read()
    return storage.subscribe(read)
  }, [])
  const changeFilters = (next: MediaFilters) => {
    setFilters(next)
    storage.patchSettings({ mediaFilters: next })
  }
  const clearFilters = () => {
    clearShowAndFilters()
    storage.patchSettings({ mediaFilters: DEFAULT_MEDIA_FILTERS })
  }
  const togglePin = (prefix: string) => {
    const now = settingsPins()
    const next = now.includes(prefix) ? now.filter((p) => p !== prefix) : [...now, prefix]
    setPinned(next)
    storage.patchSettings({ mediaPinnedPacks: next })
  }
  /** "More from this pack" (YAZ-4361): the page opens at once; its name, count and license follow from the pack list. */
  const explorePack = (prefix: string) => {
    setOpenTile(null)
    void loadPackList().then(
      (list) => {
        const info = list.find((p) => p.prefix === prefix)
        if (info !== undefined) setPackInfo(info)
      },
      () => undefined,
    )
    openPack(prefix, null)
  }
  useEffect(() => {
    drawingCanvas = { engine, appState: () => excalidrawAPI.getAppState() as unknown as Record<string, unknown> }
  }, [engine, excalidrawAPI])

  // The library index, once a window (demo 6K). A failure (offline) leaves it null, so the next mount asks again.
  useEffect(() => {
    if (imageStudioSession.getState().drawings !== null) return
    let live = true
    api.media.drawingIndex().then(
      ({ items }) => live && set({ drawings: items }),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])
  const [insertingKey, setInsertingKey] = useState<string | null>(null)
  const [busyFavoriteKey, setBusyFavoriteKey] = useState<string | null>(null)
  const [openTile, setOpenTile] = useState<OpenTile>(null)
  // The open "+N" group, apart from `openTile` (YAZ-4348 demo round 2): a right-click on a tile inside the group opens
  // that tile's menu and the group stays open; one shared state closed the group, and the menu with its tile.
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  // A change of Similar icons, here or from another window, closes the open group: its tile may no longer have one.
  useEffect(() => setOpenGroup(null), [groupSimilar])
  const changeGroupSimilar = (on: boolean) => {
    setGroupSimilar(on)
    storage.patchSettings({ mediaGroupSimilar: on })
  }
  const [line, setLine] = useState<Line>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [componentName, setComponentName] = useState('')
  const [shownMatches, setShownMatches] = useState(MATCH_PAGE)
  const [shownDrawings, setShownDrawings] = useState(DRAWING_PAGE)
  const [shownPack, setShownPack] = useState(PACK_PAGE)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const importMenuRef = useRef<HTMLSpanElement>(null)
  // The Components ⋯ menu behaves as a tile's menu does (6B, polish audit 10): its item takes the focus, and a click
  // outside it closes it.
  useEffect(() => {
    if (!importMenuOpen) return
    importMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) setImportMenuOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [importMenuOpen])

  const fieldRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // The columns follow the list's width (`rowFor`): the grids and a section's one row use the same count.
  const [ROW, setRow] = useState(MIN_ROW)
  useEffect(() => {
    const list = listRef.current
    if (list === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setRow(rowFor(entry.contentRect.width)))
    observer.observe(list)
    return () => observer.disconnect()
  }, [])
  const menuRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const report = (kind: 'error' | 'notice', message: string) => (kind === 'error' ? set({ error: message }) : setNotice(message))
  const library = useComponentLibrary(engine, excalidrawAPI, report)
  /**
   * A picture pasted (⌘V) or dropped into the tab (demo 6M): its name form, at full size. One at a time; the event is
   * taken only when it holds a picture, so a text paste into the field stays a text paste, and the board under the
   * panel never gets the picture as well.
   */
  const takePictures = async (files: File[]) => {
    try {
      const picture = await captureImageFile(engine, files[0])
      // A second picture keeps a name the user already typed (polish, audit 31).
      setComponentName((typed) => (library.captured !== null && typed.trim() !== '' ? typed : nameFromFile(files[0].name)))
      library.startSaveFrom(picture)
      setNotice(files.length > 1 ? 'One picture at a time: the first one is ready to name.' : null)
    } catch (cause) {
      set({ error: getErrorMessage(cause, 'That picture could not be read') })
    }
  }
  const takeFrom = (event: { preventDefault(): void; stopPropagation(): void }, data: DataTransfer | null) => {
    const files = pastedImages(data)
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    void takePictures(files)
  }

  /**
   * The save step (demo 6O): while a selection or a picture waits for its name, the form shows WHAT is saved, and the
   * rest of the tab is greyed and inert, so it reads as one step with one way out (Save, Cancel or Escape).
   */
  const saving = library.captured !== null
  const [savingPreview, setSavingPreview] = useState<string | null>(null)
  useEffect(() => {
    setSavingPreview(null)
    const captured = library.captured
    if (captured === null) return
    let live = true
    createScenePreviewPng(engine, { elements: captured.elements, appState: excalidrawAPI.getAppState() as unknown as Record<string, unknown>, files: captured.files }, SAVING_PREVIEW_BOUNDS).then(
      (png) => live && setSavingPreview(png),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [library.captured])

  // The board's right-click "Save to library…" (demo 6L): the name form, once the tab can capture the selection.
  useEffect(() => {
    if (!saveRequestPending || !library.canCapture) return
    onSaveRequestTaken?.()
    setComponentName('')
    library.startSave()
  }, [saveRequestPending, library.canCapture, onSaveRequestTaken])

  const setLibrary = (lib: MediaLibraryFile) => set({ favorites: lib.favorites, recent: lib.recent, used: lib.used })

  // The library, and the ONE push that keeps it true in every window and every vault: one read answers all three lists.
  useEffect(() => {
    let live = true
    const refresh = () => void api.media.used({ op: 'list' }).then((lib) => live && setLibrary(lib), () => undefined)
    refresh()
    const off = api.media.onChanged(refresh)
    return () => {
      live = false
      off()
    }
  }, [])

  // Whether a key is set, before the first search has said so — so Photos is never offered to someone who has not
  // entered one (🔒 YAZ-1775 D4: the renderer learns yes/no, never a value).
  useEffect(() => {
    let live = true
    void api.secrets.has({ name: PIXABAY_SECRET }).then(
      (has) => live && set({ pixabayAvailable: has }),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  // The Smart Shapes' package, lazily; the basics are already on screen while it arrives.
  useEffect(() => {
    let live = true
    void loadExcalidrawElement().then(
      (mod) => live && set({ smart: mod as unknown as SmartShapeApi }),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  // A chip that is no longer offered cannot stay picked.
  useEffect(() => {
    if (!pixabayAvailable && chip === 'photos') pickChip('all')
  }, [pixabayAvailable, chip])

  useEffect(() => {
    // The kept query arrives selected (🔒 YAZ-1990 D4): typing replaces it, an arrow key keeps it.
    if (!searchFocusPending) return
    fieldRef.current?.focus()
    fieldRef.current?.select()
    onSearchFocused?.()
  }, [searchFocusPending, onSearchFocused])

  // Back where this chip was left (🔒 YAZ-1990 D3). The rows come from the session, so they exist on the first paint.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = scrollTops[chip]
  }, [chip])
  // The pack page starts at its top; Back lands where the search was left (YAZ-4361).
  const packOpen = pack !== null
  useEffect(() => setShownPack(PACK_PAGE), [pack?.prefix, pack?.query])
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = packOpen ? 0 : scrollTops[chip]
  }, [packOpen])

  const catalog = useMemo(() => buildShapeCatalog(smart), [smart])
  const shapes = useMemo(() => catalog.map(shapeItem), [catalog])
  const favoriteKeys = useMemo(() => new Set(favorites.map(({ itemKey }) => itemKey)), [favorites])
  const usedByKey = useMemo(() => new Map(used.map((row) => [row.itemKey, row])), [used])
  const componentsBySlug = useMemo(() => new Map(components.map((c) => [c.slug, c])), [components])
  const componentItems = useMemo(() => components.map(componentItem), [components])

  /** A stored row as it is NOW: a component takes its live name, and one that was deleted is gone (D2). */
  const live = useMemo(() => {
    return (item: StudioItem): StudioItem | null => {
      if (item.provider !== 'component') return item
      const component = componentsBySlug.get(item.providerId)
      return component === undefined ? null : componentItem(component)
    }
  }, [componentsBySlug])
  const liveList = (items: readonly StudioItem[]) => items.flatMap((item) => live(item) ?? [])

  // A favorite component that was deleted stays, by its stored name: its copy adds it (YAZ-4370). Elsewhere it is gone (D2).
  const favoriteItems = useMemo(() => favorites.flatMap((item) => live(item) ?? (item.provider === 'component' ? [item] : [])), [favorites, live])
  const recentItems = useMemo(() => liveList(recent), [recent, live])
  /** Everything local, once each: the pool "Best matches" ranks. */
  const pool = useMemo(() => {
    const byKey = new Map<string, StudioItem>()
    for (const item of [...favoriteItems, ...recentItems, ...liveList(used), ...componentItems, ...shapes]) if (!byKey.has(item.itemKey)) byKey.set(item.itemKey, item)
    return [...byKey.values()]
  }, [favoriteItems, recentItems, used, componentItems, shapes, live])

  const typed = query.trim() !== ''
  const aliases = (item: StudioItem): readonly string[] => {
    if (item.provider !== 'shape') return []
    const shape = getShape(catalog, item.providerId)
    return shape ? shapeAliases(shape) : []
  }
  /**
   * The items you added, starred or gave a word during this search (YAZ-4348 demo round 2: "if im in the web and then
   * i click it or i add a word to it it jumps to best matches … where did the image go"). They stay where they were
   * — in From the web, or Hand-drawn — until the search changes; then they rank in Best matches as usual. An item
   * already in Best matches is not one: it stays there too, and does not jump to From the web (YAZ-4366 audit 66).
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const touch = (itemKey: string) => {
    if (yourKeys.has(itemKey)) return
    setTouched((now) => (now.has(itemKey) ? now : new Set(now).add(itemKey)))
  }
  // The same empty set when nothing was touched, so a typed key costs no second render (YAZ-4366 audit 71).
  useEffect(() => setTouched((now) => (now.size === 0 ? now : new Set())), [query, chip])
  const ranked = useMemo(
    () => (typed ? rankItems(pool.filter((item) => inChip(chip, item, favoriteKeys)), usedByKey, query, aliases) : []),
    // `aliases` reads `catalog`, which is listed.
    [typed, pool, chip, favoriteKeys, usedByKey, query, catalog],
  )
  // A touched item that is still on screen elsewhere (the web results, the hand-drawn list) is not in Best matches too.
  // With nothing touched (most searches) it walks nothing, also on each page of results (YAZ-4366 audit 72).
  const shownElsewhere = useMemo(
    () => (touched.size === 0 ? NOTHING_TOUCHED : new Set([...results, ...(drawings ?? [])].map((item) => item.itemKey).filter((key) => touched.has(key)))),
    [results, drawings, touched],
  )
  const yours = useMemo(() => (shownElsewhere.size === 0 ? ranked : ranked.filter((item) => !shownElsewhere.has(item.itemKey))), [ranked, shownElsewhere])
  useEffect(() => {
    setShownMatches(MATCH_PAGE)
    setShownDrawings(DRAWING_PAGE)
  }, [query, chip])
  const yourKeys = useMemo(() => new Set(yours.map((item) => item.itemKey)), [yours])
  // Excalidraw's public libraries (demo 6K): ranked here by the same matcher as Best matches, as you type, with no
  // request per key. A library's name is its items' alias, so "tools" finds the Tools library's hammer.
  const handDrawn = useMemo(
    () => (typed && chip === 'all' && drawings !== null ? rankItems(drawings, usedByKey, query, (item) => (item.collectionName ? [item.collectionName] : [])).filter((item) => !yourKeys.has(item.itemKey)) : []),
    [typed, chip, drawings, usedByKey, query, yourKeys],
  )
  const webOn = chipSource(chip) !== null
  // One tile per icon; its copies from other sets and its styles are its variants, shown on request (demo 6J).
  const webGroups = useMemo(
    // Not on the pack page (YAZ-4361): its results are the pack's own, shown whole.
    () => {
      if (!(typed && webOn && pack === null)) return []
      const web = results.filter((item) => !yourKeys.has(item.itemKey))
      return groupSimilar ? groupResults(web, searchedQuery || query) : web.map((head) => ({ head, variants: [] }))
    },
    [typed, webOn, results, yourKeys, searchedQuery, query, pack, groupSimilar],
  )
  const variantsOf = useMemo(() => new Map(webGroups.map((group) => [group.head.itemKey, group.variants])), [webGroups])

  // The infinite scroll of the web results: one observer on a sentinel at their end, re-armed whenever the cursor
  // moves. It is never armed for a cursor already asked for, so a page cannot load twice.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!(packOpen || (typed && webOn)) || !cursor || pageError || isSearching || wasRequested(cursor) || !sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void runSearch({ append: true })
      },
      { root: listRef.current, rootMargin: '160px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // `shownPack`: on the pack page the sentinel comes back after "Show more"
  }, [typed, webOn, cursor, isSearching, pageError, chip, packOpen, shownPack])

  // The tile buttons are disabled while one is in flight; these re-check the same fact, because a keyboard
  // activation can land in the frame before React has re-rendered them.
  const addItem = async (item: StudioItem) => {
    if (insertingKey !== null) return
    touch(item.itemKey)
    // A read-only board takes no element, so nothing is added and no use is counted (polish, audit Must 2).
    if (readOnly) {
      setNotice(READ_ONLY_NOTICE)
      return
    }
    setInsertingKey(item.itemKey)
    set({ error: null })
    setLine(null)
    setNotice(null)
    try {
      let recorded = item
      // A favorite's own copy first (YAZ-4370): it adds offline, and after its library, shape or component is gone.
      const copy = item.provider !== 'iconify' && item.provider !== 'pixabay' && favoriteKeys.has(item.itemKey) ? await api.media.favoriteElements(item.itemKey).catch(() => null) : null
      if (copy !== null) {
        insertComponent(engine, excalidrawAPI, copy)
      } else if (item.provider === 'shape') {
        const shape = getShape(catalog, item.providerId)
        if (shape === undefined) throw new Error('That shape is not available yet.')
        insertShape(engine, excalidrawAPI, shape)
      } else if (item.provider === 'component') {
        await library.insert(item.providerId)
      } else if (item.provider === 'excalidraw') {
        // A library item is elements, like a saved component: the same insert, so each copy is independent.
        const { elements } = await api.media.drawing({ id: item.providerId })
        insertComponent(engine, excalidrawAPI, componentFragmentJson({ elements, files: {} }))
      } else {
        const imported = await api.media.import({ provider: item.provider, id: item.providerId })
        await insertImage(excalidrawAPI, fileFromImport(item, imported))
        // Main's item is what the provider says NOW — a fresh size and attribution — layered over the caller's,
        // which knows the pretty collection name a search gave it.
        recorded = { ...item, ...imported.item }
      }
      const wasFavorite = favoriteKeys.has(item.itemKey)
      const lib = await api.media.used({ op: 'record', item: recorded, query: query.trim() })
      setLibrary(lib)
      const row = lib.used.find((u) => u.itemKey === item.itemKey)
      if (!wasFavorite && row !== undefined && lib.favorites.some((f) => f.itemKey === item.itemKey)) {
        setLine({ text: `${item.title} is now a favorite. You added it ${row.count} times.`, undo: item })
      } else if (recorded.provider === 'iconify' && needsCredit(recorded.licenseName)) {
        // Extra 16: a CC-BY icon asks for a credit where the work is published.
        setLine({ text: creditReminder(recorded) })
      }
    } catch (cause) {
      set({ error: getErrorMessage(cause, `${item.title || 'That item'} could not be added`) })
    } finally {
      setInsertingKey(null)
    }
  }

  /**
   * `slot` is the tile the change came from; `fromMenu` when its menu asked. A tile that leaves its section (a favorite
   * taken out of Favorites) would take the focus with it to the page (YAZ-302, checked for YAZ-4365): `refocusAfter`
   * says where it goes instead, once the list has changed.
   */
  const toggleFavorite = async (item: StudioItem, slot?: string, fromMenu = false) => {
    if (busyFavoriteKey !== null) return
    touch(item.itemKey)
    setBusyFavoriteKey(item.itemKey)
    set({ error: null })
    setLine(null)
    if (slot !== undefined) refocusAfter.current = focusPlan(slot, fromMenu)
    try {
      set({ favorites: favoriteKeys.has(item.itemKey) ? await api.media.favorites({ op: 'remove', itemKey: item.itemKey }) : await api.media.favorites({ op: 'add', item }) })
    } catch (cause) {
      refocusAfter.current = null
      set({ error: getErrorMessage(cause, 'Could not change favorites') })
    } finally {
      setBusyFavoriteKey(null)
    }
  }

  const undoAutoFavorite = async (item: StudioItem) => {
    setLine(null)
    try {
      set({ favorites: await api.media.favorites({ op: 'remove', itemKey: item.itemKey }) })
    } catch (cause) {
      set({ error: getErrorMessage(cause, 'Could not change favorites') })
    }
  }

  // YAZ-4348 demo round 2: the row stays open after an add, with the new chip in it, and no line above the list (it
  // pushed the list down, so the tile and its row jumped).
  const saveWord = async (item: StudioItem, word: string) => {
    if (word.trim() === '') return
    touch(item.itemKey)
    try {
      setLibrary(await api.media.used({ op: 'add-word', item, word }))
    } catch (cause) {
      set({ error: getErrorMessage(cause, 'Could not add the word') })
    }
  }

  /** The × on a word chip (YAZ-4348 demo round 2): the word stops finding the item; the row stays open to show it. */
  const removeWord = async (item: StudioItem, word: string) => {
    try {
      setLibrary(await api.media.used({ op: 'remove-word', itemKey: item.itemKey, word }))
    } catch (cause) {
      set({ error: getErrorMessage(cause, 'Could not remove the word') })
    }
  }

  /**
   * The search text, offered as a one-click word (YAZ-4157 D5), unless the icon is already found by it. YAZ-4348 demo
   * round 2: the field itself starts empty; "man" typed in it for the icon Mana read as a change of its words.
   */
  const wordToOffer = (item: StudioItem): string => {
    const typedWord = query.trim()
    const known = [...item.title.toLowerCase().split(/\s+/), ...(usedByKey.get(item.itemKey)?.words ?? [])]
    return typedWord === '' || known.includes(typedWord.toLowerCase()) ? '' : typedWord
  }
  const openRow = (key: string, mode: 'word' | 'rename' | 'confirm') => {
    setOpenTile({ key, mode })
  }

  /**
   * The tile menu (D10, demo 6B): a right-click on the tile, or Shift+F10 / the menu key on its add button. It opens
   * at the pointer, in the panel, and a click outside it or Escape closes it.
   */
  const openMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, key: string) => {
    event.preventDefault()
    const card = event.currentTarget.getBoundingClientRect()
    const listRight = listRef.current?.getBoundingClientRect().right ?? Infinity
    const x = 'clientX' in event ? event.clientX : card.left + 4
    const top = 'clientY' in event ? event.clientY - card.top : 24
    setOpenTile({ key, mode: 'menu', at: x + MENU_WIDTH > listRight ? { top, right: card.right - x } : { top, left: x - card.left } })
  }
  const closeMenu = (refocus: boolean) => {
    const key = openTile?.key
    setOpenTile(null)
    if (refocus && key !== undefined) listRef.current?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(key)}"] .image-studio__add`)?.focus()
  }
  const refocusAfter = useRef<FocusPlan | null>(null)
  const focusPlan = (slot: string, fromMenu: boolean): FocusPlan => {
    const card = listRef.current?.querySelector(`[data-slot="${CSS.escape(slot)}"]`) ?? null
    const section = card?.closest('section') ?? null
    return { slot, section, index: section === null || card === null ? 0 : [...section.querySelectorAll('[data-slot]')].indexOf(card), fromMenu }
  }
  useEffect(() => {
    const plan = refocusAfter.current
    if (plan === null) return
    refocusAfter.current = null
    const list = listRef.current
    const own = list?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(plan.slot)}"] .image-studio__add`)
    // A tile that stays keeps the focus where it was; its menu, which is gone, hands it back to the tile.
    if (own) {
      if (plan.fromMenu) own.focus()
      return
    }
    const adds = plan.section?.isConnected ? [...plan.section.querySelectorAll<HTMLElement>('[data-slot] .image-studio__add')] : []
    ;(adds[plan.index] ?? adds[plan.index - 1] ?? fieldRef.current)?.focus()
  }, [favorites])

  // The shape favorites' copies (YAZ-4370): only this renderer has the catalog and the engine that make a shape, so it
  // saves the ones main says are missing — when the panel opens, and on each change of the favorites.
  useEffect(() => {
    let live = true
    if (!favorites.some((item) => item.provider === 'shape')) return
    void api.media.favoritesForPanel().then(
      async (keys) => {
        for (const key of keys) {
          const shape = key.startsWith('shape:') ? getShape(catalog, key.slice('shape:'.length)) : undefined
          if (!live || shape === undefined) continue
          const elements = engine.convertToExcalidrawElements(shape.create(0, 0))
          await api.media.saveFavoriteElements({ itemKey: key, fragmentJson: componentFragmentJson({ elements, files: {} }) }).catch(() => undefined)
        }
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [favorites, catalog, engine])

  const menuKey = openTile?.mode === 'menu' ? openTile.key : null
  // A menu near the bottom of the list moves up so all of it shows (YAZ-302, checked for YAZ-4365): the list scrolls,
  // so a menu that ran past its bottom edge would be cut off. Never above the list's top.
  useLayoutEffect(() => {
    const menu = menuRef.current
    const list = listRef.current
    if (menuKey === null || menu === null || list === null) return
    const m = menu.getBoundingClientRect()
    const l = list.getBoundingClientRect()
    const shift = Math.min(m.bottom - l.bottom + MENU_EDGE_GAP, m.top - l.top)
    if (shift <= 0) return
    setOpenTile((open) => (open?.mode === 'menu' && open.key === menuKey ? { ...open, at: { ...open.at, top: open.at.top - shift } } : open))
  }, [menuKey])
  useEffect(() => {
    if (menuKey === null) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpenTile(null)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [menuKey])
  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    event.stopPropagation()
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  /** One tile, with its star; its menu opens on a right-click (D10). */
  const tile = (item: StudioItem, where: string): ReactNode => {
    const slot = slotOf(where, item)
    const shape = item.provider === 'shape' ? getShape(catalog, item.providerId) : undefined
    const component: ComponentItem | undefined = item.provider === 'component' ? componentsBySlug.get(item.providerId) : undefined
    const favorited = favoriteKeys.has(item.itemKey)
    const menuAt = openTile?.key === slot && openTile.mode === 'menu' ? openTile.at : null
    const variants = variantsOf.get(item.itemKey) ?? []
    const variantsOpen = openGroup === slot
    const busy = insertingKey !== null || (component !== undefined && library.busySlug === component.slug)
    return (
      <article
        // The tile whose row is open (Search words, Rename, Delete) is ringed, so the row says whose it is (YAZ-4348 demo round 2)
        className={openTile?.key === slot && openTile.mode !== 'menu' ? 'image-studio__card is-editing' : 'image-studio__card'}
        key={item.itemKey}
        data-slot={slot}
        aria-busy={busy || undefined}
        onContextMenu={(event) => openMenu(event, slot)}
      >
        <button
          type="button"
          className="image-studio__add"
          disabled={busy}
          onClick={() => void addItem(item)}
          onKeyDown={(event) => (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && openMenu(event, slot)}
          aria-label={`Add ${item.title}`}
          aria-keyshortcuts="Shift+F10"
          title={`${item.title} — ${sourceLabel(item)}`}
        >
          <span className="image-studio__preview">
            {item.provider === 'shape' && shape ? (
              <ShapeTile preview={shape.preview} />
            ) : item.provider === 'component' && component ? (
              <componentPreviews.Preview cacheKey={item.providerId} placeholderClass="image-studio__placeholder" />
            ) : item.provider === 'shape' || item.provider === 'component' || (item.provider === 'excalidraw' && favorited) ? (
              // Its source is gone, or it is a library favorite: the picture comes from the copy (YAZ-4370).
              <copyPreviews.Preview cacheKey={`${theme}|${item.itemKey}`} placeholderClass="image-studio__placeholder" />
            ) : item.provider === 'excalidraw' ? (
              <drawingPreviews.Preview cacheKey={`${theme}|${item.providerId}`} placeholderClass="image-studio__placeholder" />
            ) : (
              <previews.Preview cacheKey={`${item.provider}:${item.providerId}`} placeholderClass="image-studio__placeholder" />
            )}
            {insertingKey === item.itemKey && <span className="image-studio__adding">Adding…</span>}
          </span>
          <span className={item.provider === 'component' ? 'image-studio__name' : 'image-studio__name image-studio__name--title'}>{item.title}</span>
        </button>
        <button
          type="button"
          className={favorited ? 'image-studio__favorite is-active' : 'image-studio__favorite'}
          aria-label={favorited ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}
          aria-pressed={favorited}
          disabled={busyFavoriteKey !== null}
          onClick={() => void toggleFavorite(item, slot)}
        >
          {favorited ? '★' : '☆'}
        </button>
        {variants.length > 0 && (
          <button
            type="button"
            className="image-studio__variants-toggle"
            aria-label={`${variantsOpen ? 'Hide' : 'Show'} ${variants.length} more like ${item.title}`}
            aria-expanded={variantsOpen}
            onClick={() => setOpenGroup(variantsOpen ? null : slot)}
          >
            +{variants.length}
          </button>
        )}
        {menuAt !== null && (
          <div className="image-studio__menu" role="menu" aria-label={`Actions for ${item.title}`} ref={menuRef} style={menuAt as CSSProperties} onKeyDown={menuKeys}>
            <div className="image-studio__menu-source">From {sourceLabel(item)}</div>
            {item.sourceUrl !== undefined && (item.provider === 'iconify' || item.provider === 'pixabay' || item.provider === 'excalidraw') && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenTile(null)
                  void api.shell.openLink({ href: item.sourceUrl as string })
                }}
              >
                {item.provider === 'excalidraw' ? 'Open its library ↗' : `Open on ${item.provider === 'iconify' ? 'Iconify' : 'Pixabay'} ↗`}
              </button>
            )}
            {variants.length > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenTile(null)
                  setOpenGroup(slot)
                }}
              >
                Show {variants.length} more like this
              </button>
            )}
            {item.provider === 'iconify' && pack?.prefix !== item.providerId.slice(0, item.providerId.indexOf(':')) && (
              <button type="button" role="menuitem" onClick={() => explorePack(item.providerId.slice(0, item.providerId.indexOf(':')))}>
                More from this pack
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => openRow(slot, 'word')}>
              Search words…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenTile(null)
                void toggleFavorite(item, slot, true)
              }}
            >
              {favorited ? 'Remove from favorites' : 'Add to favorites'}
            </button>
            {component !== undefined && (
              <>
                <button type="button" role="menuitem" onClick={() => openRow(slot, 'rename')}>
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setOpenTile(null)
                    // 🔒 confirmDelete off = delete straight away; the files go to the Trash either way.
                    if (library.confirmDelete) openRow(slot, 'confirm')
                    else library.remove(component)
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </article>
    )
  }

  /** The full-width row of a tile's "+N" look-alikes (demo 6J), open under the tile's row while its group is open. */
  const variantsRow = (item: StudioItem, where: string): ReactNode =>
    openGroup === slotOf(where, item) && (
      <div className="image-studio__inline image-studio__variants" key={`${item.itemKey}:group`} role="group" aria-label={`More like ${item.title}`}>
        <div className="image-studio__variants-grid">{(variantsOf.get(item.itemKey) ?? []).map((variant) => tile(variant, `${where}:variants`))}</div>
      </div>
    )

  /** The full-width row that "Search words…", Rename or Delete opens under the tile's row. */
  const inlineRow = (item: StudioItem, where: string, column = 0): ReactNode => {
    // A notch over the tile's column points up at the ringed tile
    const notch = { '--notch': `${((column + 0.5) / ROW) * 100}%` } as CSSProperties
    if (openTile?.key !== slotOf(where, item) || openTile.mode === 'menu') return null
    const component = item.provider === 'component' ? componentsBySlug.get(item.providerId) : undefined
    if (openTile.mode === 'confirm' && component) {
      return (
        <div className="image-studio__inline" style={notch} key={`${item.itemKey}:row`} role="alertdialog" aria-label={`Delete ${component.name}?`}>
          <span>Delete “{component.name}”?</span>
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              setOpenTile(null)
              library.remove(component)
            }}
          >
            Delete
          </button>
          <button type="button" onClick={() => setOpenTile(null)}>
            Cancel
          </button>
        </div>
      )
    }
    const renaming = openTile.mode === 'rename'
    return (
      <InlineForm
        // The mode in the key: Rename after Search words starts from the name, not from the typed word
        key={`${item.itemKey}:row:${openTile.mode}`}
        item={item}
        renaming={renaming}
        initial={renaming && component ? component.name : ''}
        words={usedByKey.get(item.itemKey)?.words ?? []}
        offer={renaming ? '' : wordToOffer(item)}
        notch={notch}
        onWord={(word) => void saveWord(item, word)}
        onRemoveWord={(word) => void removeWord(item, word)}
        onRename={(name) => {
          setOpenTile(null)
          if (component) library.rename(component, name)
        }}
        onClose={() => setOpenTile(null)}
      />
    )
  }

  /** A grid of tiles in the section `where`; an open inline row goes after the row its tile is on. */
  const grid = (items: readonly StudioItem[], where: string) => {
    const cells: ReactNode[] = []
    items.forEach((item, i) => {
      cells.push(tile(item, where))
      const rowEnd = i % ROW === ROW - 1 || i === items.length - 1
      if (rowEnd) items.slice(i - (i % ROW), i + 1).forEach((other, column) => cells.push(variantsRow(other, where), inlineRow(other, where, column)))
    })
    return (
      <div className="image-studio__grid" style={{ '--studio-cols': ROW } as CSSProperties}>
        {cells}
      </div>
    )
  }

  /** A section: its title, its one row (or all of it), and "Show all" — which picks the chip that shows the rest. */
  const section = (title: string, items: readonly StudioItem[], more?: { label: string; onClick: () => void }, actions?: ReactNode) => (
    <section className="image-studio__section" key={title} aria-label={title}>
      <header className="image-studio__section-head">
        <h3>{title}</h3>
        {actions}
        {more && (
          <button type="button" className="image-studio__show-all" onClick={more.onClick}>
            {more.label}
          </button>
        )}
      </header>
      {grid(items, title)}
    </section>
  )
  const row = (title: string, items: readonly StudioItem[], to: StudioChip) => items.length > 0 && section(title, items.slice(0, ROW), items.length > ROW ? { label: 'Show all', onClick: () => pickChip(to) } : undefined)

  const importMenu = (
    <span className="image-studio__section-menu" ref={importMenuRef}>
      <button type="button" className="image-studio__more-inline" aria-label="More for Components" aria-expanded={importMenuOpen} onClick={() => setImportMenuOpen(!importMenuOpen)}>
        ⋯
      </button>
      {importMenuOpen && (
        <div
          className="image-studio__menu"
          role="menu"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' && event.key !== 'Tab') return
            event.preventDefault()
            setImportMenuOpen(false)
            importMenuRef.current?.querySelector<HTMLElement>('.image-studio__more-inline')?.focus()
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={library.importing}
            onClick={() => {
              setImportMenuOpen(false)
              setNotice(null)
              void library.importFile()
            }}
            title="Import an .excalidraw file as a component"
          >
            {library.importing ? 'Importing…' : 'Import a file…'}
          </button>
        </div>
      )}
    </span>
  )

  const chipTitle = STUDIO_CHIP_LABELS[chip]
  /** The web half shows once the web is asked or is waiting to be: during the pause, a search, offline, a result. */
  const webShown = webOn && (waiting || isSearching || offline || searchedQuery !== '' || pageError !== null)
  let body: ReactNode
  if (pack !== null) {
    // The pack page (YAZ-4361): every icon of the pack, as Iconify or the Mac lists them — no folding of look-alikes,
    // the user came to see them all.
    body = (
      <PackView
        pack={pack}
        pinned={pinned.includes(pack.prefix)}
        onBack={closePack}
        onPin={() => togglePin(pack.prefix)}
        onType={typePackQuery}
        onSearchNow={searchNow}
      >
        {offline && (
          <div className="image-studio__notice" role="status">
            {packsStatus?.state === 'complete' ? OFFLINE_WITH_PACKS_NOTICE : OFFLINE_NOTICE}
          </div>
        )}
        {results.length > 0 && grid(results.slice(0, shownPack), 'pack')}
        {(waiting || (isSearching && results.length === 0)) && (
          <div className="image-studio__state" role="status">
            Loading the pack…
          </div>
        )}
        {!waiting && !isSearching && !offline && cursor === null && results.length === 0 && pageError === null && (
          <div className="image-studio__state">{pack.query.trim() === '' ? 'This pack has no icons to show.' : `No icon in this pack matches “${pack.query.trim()}”`}</div>
        )}
        {cursor && results.length > 0 && results.length < shownPack && <div className="image-studio__search-sentinel" ref={sentinelRef} aria-hidden="true" />}
        {(results.length > shownPack || (cursor !== null && results.length >= shownPack)) && (
          <button type="button" className="image-studio__show-all image-studio__pack-more" onClick={() => setShownPack(shownPack + PACK_PAGE)}>
            Show more
          </button>
        )}
        {pageError && cursor && (
          <button type="button" className="image-studio__retry" disabled={isSearching} onClick={() => void runSearch({ append: true, retry: true })}>
            {isSearching ? 'Retrying…' : 'Retry loading icons'}
          </button>
        )}
        {isSearching && results.length > 0 && (
          <div className="image-studio__loading-more" role="status">
            Loading more…
          </div>
        )}
      </PackView>
    )
  } else if (typed) {
    const mine = yours.slice(0, shownMatches)
    body = (
      <>
        {mine.length > 0 && section('Best matches', mine, yours.length > shownMatches ? { label: 'Show more', onClick: () => setShownMatches(shownMatches + MATCH_PAGE) } : undefined)}
        {handDrawn.length > 0 &&
          section('Hand-drawn', handDrawn.slice(0, shownDrawings), handDrawn.length > shownDrawings ? { label: 'Show more', onClick: () => setShownDrawings(shownDrawings + MATCH_PAGE) } : undefined)}
        {/* The web half appears from the first key: during the pause it says the web is coming. */}
        {webShown && (
          <section className="image-studio__section" aria-label="From the web">
            <header className="image-studio__section-head">
              <h3>From the web</h3>
            </header>
            {offline && (
              <div className="image-studio__notice" role="status">
                {packsStatus?.state === 'complete' ? OFFLINE_WITH_PACKS_NOTICE : OFFLINE_NOTICE}
              </div>
            )}
            {warnings.length > 0 && <div className="image-studio__warning">{warnings.join(' ')}</div>}
            {query.trim().length >= 2 && (waiting || (isSearching && results.length === 0)) && (
              <div className="image-studio__state" role="status">
                Searching the web…
              </div>
            )}
            {webGroups.length > 0 && grid(webGroups.map((group) => group.head), 'web')}
            {/* Also when the filters left nothing (Best matches holds them, or no name has the word): no empty section. */}
            {!waiting && !isSearching && !offline && searchedQuery !== '' && cursor === null && webGroups.length === 0 && (
              <div className="image-studio__state">No graphics match “{searchedQuery}”</div>
            )}
            {cursor && results.length > 0 && <div className="image-studio__search-sentinel" ref={sentinelRef} aria-hidden="true" />}
            {pageError && cursor && (
              <>
                <div className="image-studio__error" role="alert">
                  {pageError}
                </div>
                <button type="button" className="image-studio__retry" disabled={isSearching} onClick={() => void runSearch({ append: true, retry: true })}>
                  {isSearching ? 'Retrying…' : 'Retry loading results'}
                </button>
              </>
            )}
            {isSearching && results.length > 0 && (
              <div className="image-studio__loading-more" role="status">
                Loading more…
              </div>
            )}
          </section>
        )}
        {/* Nothing local, and no web half yet (a chip with no web, or text too short for a pause search): say so (6Q). */}
        {mine.length === 0 && handDrawn.length === 0 && !webShown && (
          <div className="image-studio__state">
            {/* Enter searches the web from 2 letters only (6S). */}
            Nothing of yours matches “{query.trim()}”.{webOn && query.trim().length >= MIN_QUERY ? ' Press Enter to search the web.' : ''}
          </div>
        )}
      </>
    )
  } else if (chip === 'all') {
    body = (
      <>
        {row('Favorites', favoriteItems, 'favorites')}
        {recentItems.length > 0 &&
          section('Recent', recentOpen ? recentItems : recentItems.slice(0, ROW), recentItems.length > ROW ? { label: recentOpen ? 'Show less' : 'Show all', onClick: () => set({ recentOpen: !recentOpen }) } : undefined)}
        {componentItems.length > 0 && section('Components', componentItems.slice(0, ROW), componentItems.length > ROW ? { label: 'Show all', onClick: () => pickChip('components') } : undefined, importMenu)}
        <p className="image-studio__hint">{PASTE_HINT}</p>
        {row('Shapes', shapes, 'shapes')}
      </>
    )
  } else if (chip === 'icons' || chip === 'photos') {
    body = <div className="image-studio__state">Type to search {chip}.</div>
  } else {
    const items = chip === 'favorites' ? favoriteItems : chip === 'components' ? componentItems : shapes
    body =
      items.length > 0 || chip === 'components' ? (
        <>
          {section(chipTitle, items, undefined, chip === 'components' ? importMenu : undefined)}
          {items.length === 0 && <div className="image-studio__state">No saved components yet. Select something on the board, then click Save selection.</div>}
          {chip === 'components' && <p className="image-studio__hint">{PASTE_HINT}</p>}
        </>
      ) : (
        <div className="image-studio__state">Star an item and it stays here for every drawing.</div>
      )
  }

  return (
    <div
      className="image-studio"
      // Focusable, so a click anywhere in the tab makes ⌘V a paste HERE (demo 6M).
      tabIndex={-1}
      onPaste={(event) => {
        // Text pasted into a text field stays text, even when the clipboard ALSO holds a picture of it (an Excel
        // cell, a copied slide); a Finder file's name is no text to type (6P, 6R, `isTextPaste`).
        const target = event.target as HTMLElement
        const intoText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
        if (intoText && isTextPaste(event.clipboardData)) return
        takeFrom(event, event.clipboardData)
      }}
      onDragOver={(event) => {
        if ([...event.dataTransfer.items].some((item) => item.kind === 'file' && PASTE_IMAGE_TYPES.includes(item.type))) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onDrop={(event) => takeFrom(event, event.dataTransfer)}
    >
      <div className="image-studio__search" inert={saving} hidden={pack !== null}>
        <input
          ref={fieldRef}
          type="search"
          aria-label="Search shapes, icons, and components"
          placeholder="Search shapes, icons, and components"
          value={query}
          onChange={(event) => typeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              searchNow()
            } else if (event.key === 'ArrowDown') {
              const first = listRef.current?.querySelector<HTMLButtonElement>('.image-studio__add')
              if (first) {
                event.preventDefault()
                first.focus()
              }
            }
          }}
        />
        <FilterMenu
          show={chip}
          shows={STUDIO_CHIPS.filter((c) => c !== 'photos' || pixabayAvailable)}
          onShow={pickChip}
          filters={filters}
          onChange={changeFilters}
          onClear={clearFilters}
          pinned={pinned}
          loadPacks={loadPackList}
          groupSimilar={groupSimilar}
          onGroupSimilar={changeGroupSimilar}
        />
        {hasSelection && library.canCapture && (
          <button
            type="button"
            className="image-studio__save"
            onClick={() => {
              setComponentName('')
              library.startSave()
            }}
          >
            Save selection
          </button>
        )}
      </div>

      {library.captured !== null && (
        <form
          className="image-studio__naming"
          aria-label="Save to your library"
          onSubmit={(event) => {
            event.preventDefault()
            void library.commitSave(componentName)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            library.cancelSave()
          }}
        >
          <h3 className="image-studio__naming-title">Save to your library</h3>
          <div className="image-studio__naming-preview">{savingPreview !== null ? <img src={savingPreview} alt="" /> : <span className="image-studio__placeholder" />}</div>
          {/* Autofocused: the button that opened this form is the only way here. */}
          <input autoFocus value={componentName} maxLength={MAX_COMPONENT_NAME_LENGTH} required aria-label="Component name" placeholder="Name this component" onChange={(event) => setComponentName(event.target.value)} />
          <div className="image-studio__naming-actions">
            <button type="button" onClick={library.cancelSave}>
              Cancel
            </button>
            <button type="submit" disabled={componentName.trim() === '' || library.saving}>
              {library.saving ? 'Saving…' : `Save ${library.captured.elements.length} element${library.captured.elements.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      )}

      <div className={saving ? 'image-studio__rest is-dimmed' : 'image-studio__rest'} inert={saving}>
        {line !== null && (
          <div className="image-studio__line" role="status">
            <span>{line.text}</span>
            {line.undo && (
              <button type="button" onClick={() => void undoAutoFavorite(line.undo!)}>
                Undo
              </button>
            )}
          </div>
        )}
        {notice !== null && (
          <div className="image-studio__notice" role="status">
            {notice}
          </div>
        )}
        {error && <div className="image-studio__error">{error}</div>}

        <div
          className="image-studio__list"
          ref={listRef}
          onKeyDown={(event) => moveBetweenTiles(event, listRef.current, fieldRef.current, ROW)}
          onScroll={(event) => {
            // The pack page has its own scroll; the search under it keeps the place Back returns to.
            if (imageStudioSession.getState().pack === null) scrollTops[chip] = event.currentTarget.scrollTop
          }}
        >
          {body}
        </div>
        <footer className="image-studio__footer">
          <span>Graphics via Pixabay · icons via Iconify · drawings from Excalidraw libraries.</span>
          {/* YAZ-4348 demo: the packs download sits in the footer, beside Google Images */}
          <IconPacksFooter
            google={
              <button type="button" className="image-studio__google" disabled={query.trim() === ''} onClick={() => void api.shell.openLink({ href: googleImagesUrl(query) })} title="Search Google Images for this text, in your browser">
                Google Images ↗
              </button>
            }
          />
        </footer>
      </div>
    </div>
  )
}
