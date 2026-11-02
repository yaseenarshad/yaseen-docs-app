/**
 * THE ADD TAB (YAZ-4157; before it, the Images tab of 🔒 YAZ-1775 D4 / YAZ-1818 and the Components tab of YAZ-1819):
 * ONE field over everything a board can take — your favorites, your recent adds, your saved components, the shapes,
 * and the web (Iconify, Pixabay, over the providers MAIN owns). The renderer never holds an API key and never reaches
 * a provider.
 *
 * WHAT IT SHOWS (D7). An empty field shows Favorites, Recent, Components and Shapes, one row each. A typed field shows
 * "Yours" — every local item, in the ONE order of `rankItems` (D4) — then "From the web". The chips (D8) narrow both.
 *
 * WHAT IT LEARNS (D1, D5, D9). Each add is one `media:used` write: the MRU, the count, the text it was found by as a
 * word, and at the third add a favorite — said once, quietly, with Undo. A removed favorite never comes back on its
 * own. "Add a word…" teaches a word by hand.
 *
 * A PREVIEW IS ASKED FOR, NOT LINKED TO. Every media tile asks `media:preview` for its bytes as a dataURL, because the
 * renderer may not fetch from a provider; a favorite's stored `previewUrl` is never read. A component's picture is
 * `components:preview`. Both caches are bounded (`lib/previewCache.ts`).
 *
 * NO KEY IS NOT AN ERROR (🔒 YAZ-1775 D4): with no Pixabay key there is no Photos chip, and nothing explains why.
 * OFFLINE IS A STATE, NOT A BANNER: the web half says so in one line; everything local keeps working.
 *
 * THE SMART SHAPES ARRIVE LATE ON PURPOSE. `@excalidraw/element` is a second ~300 kB download (`engine.ts`'s lazy
 * rule), so the seven basic shapes render immediately and the twelve Smart Shapes join when it lands.
 *
 * WHAT IT REMEMBERS LIVES ELSEWHERE (🔒 YAZ-1990). Closing the canvas panel unmounts this tab, so the chip, the query,
 * the results and the scroll are `imageStudioSession.ts`'s; this component renders them and keeps what one click has
 * in flight.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { PIXABAY_SECRET, type ComponentItem, type MediaBytesProvider, type MediaLibraryFile, type StudioItem } from '@shared/types'
import { api } from '../api'
import { createPreviewCache } from '../lib/previewCache'
import type { PreviewEngine } from '../lib/scenePreview'
import { loadExcalidrawElement } from '../drawings/engine'
import type { ComponentEngine, ComponentTarget } from '../components-library/componentData'
import { componentItem, componentPreviews, useComponentLibrary } from '../components-library/useComponentLibrary'
import { insertImage, insertShape, fileFromImport, type InsertEngine, type InsertTarget } from './insertShape'
import { buildShapeCatalog, getShape, shapeAliases, type ShapeCatalogItem, type ShapePreview, type SmartShapeApi } from './shapes'
import { rankItems } from './rankItems'
import {
  chipSource,
  getErrorMessage,
  imageStudioSession,
  OFFLINE_NOTICE,
  pickChip,
  runSearch,
  scrollTops,
  searchNow,
  STUDIO_CHIPS,
  typeQuery,
  wasRequested,
  type StudioChip,
} from './imageStudioSession'
import './imageStudio.css'

const CHIP_LABELS: Record<StudioChip, string> = { all: 'All', favorites: 'Favorites', components: 'Components', shapes: 'Shapes', icons: 'Icons', photos: 'Photos' }

/** One row of the 4-column grid: what a section shows before "Show all" (D7). */
const ROW = 4
/** How many of your own matches a typed field shows at a time; "Show more" grows it. */
const MATCH_PAGE = 48

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
export const clearPreviewMemo = () => {
  previews.clear()
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

/** What the ⋯ menu of one tile has open: the menu itself, or one of the three inline rows it leads to. */
type OpenTile = { key: string; mode: 'menu' | 'word' | 'rename' | 'confirm' } | null

/** The quiet line under the field (D9): one sentence, and the item Undo takes back out of the favorites. */
type Line = { text: string; undo?: StudioItem } | null

/**
 * Arrow keys between tiles (D7). Left and right walk the tiles in reading order; up and down keep the column, and
 * cross into the next or the previous section. ArrowUp from the first row goes back to the field.
 */
function moveBetweenTiles(event: KeyboardEvent<HTMLElement>, list: HTMLElement | null, field: HTMLInputElement | null) {
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

export function ImageStudio({ engine, excalidrawAPI, hasSelection, searchFocusPending = false, onSearchFocused }: ImageStudioProps) {
  // The session outlives this component (🔒 YAZ-1990 D2): closing the panel unmounts it, reopening reads it back.
  const session = useSyncExternalStore(imageStudioSession.subscribe, imageStudioSession.getState)
  const { chip, query, searchedQuery, results, cursor, warnings, isSearching, offline, pageError, error, pixabayAvailable, favorites, recent, used, components, recentOpen, smart } = session
  const { set } = imageStudioSession
  const [insertingKey, setInsertingKey] = useState<string | null>(null)
  const [busyFavoriteKey, setBusyFavoriteKey] = useState<string | null>(null)
  const [openTile, setOpenTile] = useState<OpenTile>(null)
  const [draft, setDraft] = useState('')
  const [line, setLine] = useState<Line>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [componentName, setComponentName] = useState('')
  const [shownMatches, setShownMatches] = useState(MATCH_PAGE)
  const [importMenuOpen, setImportMenuOpen] = useState(false)

  const fieldRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const report = (kind: 'error' | 'notice', message: string) => (kind === 'error' ? set({ error: message }) : setNotice(message))
  const library = useComponentLibrary(engine, excalidrawAPI, report)

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

  const favoriteItems = useMemo(() => liveList(favorites), [favorites, live])
  const recentItems = useMemo(() => liveList(recent), [recent, live])
  /** Everything local, once each: the pool "Yours" ranks. */
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
  const yours = useMemo(
    () => (typed ? rankItems(pool.filter((item) => inChip(chip, item, favoriteKeys)), usedByKey, query, aliases) : []),
    // `aliases` reads `catalog`, which is listed.
    [typed, pool, chip, favoriteKeys, usedByKey, query, catalog],
  )
  useEffect(() => setShownMatches(MATCH_PAGE), [query, chip])
  const yourKeys = useMemo(() => new Set(yours.map((item) => item.itemKey)), [yours])
  const webOn = chipSource(chip) !== null
  const webItems = typed && webOn ? results.filter((item) => !yourKeys.has(item.itemKey)) : []

  // The infinite scroll of the web results: one observer on a sentinel at their end, re-armed whenever the cursor
  // moves. It is never armed for a cursor already asked for, so a page cannot load twice.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!typed || !webOn || !cursor || pageError || isSearching || wasRequested(cursor) || !sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void runSearch({ append: true })
      },
      { root: listRef.current, rootMargin: '160px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [typed, webOn, cursor, isSearching, pageError, chip])

  // The tile buttons are disabled while one is in flight; these re-check the same fact, because a keyboard
  // activation can land in the frame before React has re-rendered them.
  const addItem = async (item: StudioItem) => {
    if (insertingKey !== null) return
    setInsertingKey(item.itemKey)
    set({ error: null })
    setLine(null)
    setNotice(null)
    try {
      let recorded = item
      if (item.provider === 'shape') {
        const shape = getShape(catalog, item.providerId)
        if (shape === undefined) throw new Error('That shape is not available yet.')
        insertShape(engine, excalidrawAPI, shape)
      } else if (item.provider === 'component') {
        await library.insert(item.providerId)
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
      }
    } catch (cause) {
      set({ error: getErrorMessage(cause, `${item.title || 'That item'} could not be added`) })
    } finally {
      setInsertingKey(null)
    }
  }

  const toggleFavorite = async (item: StudioItem) => {
    if (busyFavoriteKey !== null) return
    setBusyFavoriteKey(item.itemKey)
    set({ error: null })
    setLine(null)
    try {
      set({ favorites: favoriteKeys.has(item.itemKey) ? await api.media.favorites({ op: 'remove', itemKey: item.itemKey }) : await api.media.favorites({ op: 'add', item }) })
    } catch (cause) {
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

  const saveWord = async (item: StudioItem) => {
    const word = draft
    setOpenTile(null)
    if (word.trim() === '') return
    try {
      setLibrary(await api.media.used({ op: 'add-word', item, word }))
      setLine({ text: `“${item.title}” now comes first for “${word.trim().toLowerCase()}”.` })
    } catch (cause) {
      set({ error: getErrorMessage(cause, 'Could not add the word') })
    }
  }

  const openRow = (key: string, mode: 'word' | 'rename' | 'confirm', value = '') => {
    setDraft(value)
    setOpenTile({ key, mode })
  }

  /** One tile, with its star and its ⋯ menu (D10). */
  const tile = (item: StudioItem): ReactNode => {
    const shape = item.provider === 'shape' ? getShape(catalog, item.providerId) : undefined
    const component: ComponentItem | undefined = item.provider === 'component' ? componentsBySlug.get(item.providerId) : undefined
    const favorited = favoriteKeys.has(item.itemKey)
    const menuOpen = openTile?.key === item.itemKey && openTile.mode === 'menu'
    const busy = insertingKey !== null || (component !== undefined && library.busySlug === component.slug)
    return (
      <article className="image-studio__card" key={item.itemKey} aria-busy={busy || undefined}>
        <button type="button" className="image-studio__add" disabled={busy} onClick={() => void addItem(item)} aria-label={`Add ${item.title}`} title={item.title}>
          <span className="image-studio__preview">
            {item.provider === 'shape' ? (
              shape ? <ShapeTile preview={shape.preview} /> : <span className="image-studio__placeholder" />
            ) : item.provider === 'component' ? (
              <componentPreviews.Preview cacheKey={item.providerId} placeholderClass="image-studio__placeholder" />
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
          onClick={() => void toggleFavorite(item)}
        >
          {favorited ? '★' : '☆'}
        </button>
        <button
          type="button"
          className="image-studio__more"
          aria-label={`More for ${item.title}`}
          aria-expanded={menuOpen}
          onClick={() => setOpenTile(menuOpen ? null : { key: item.itemKey, mode: 'menu' })}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="image-studio__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => openRow(item.itemKey, 'word', query.trim())}>
              Add a word…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenTile(null)
                void toggleFavorite(item)
              }}
            >
              {favorited ? 'Remove from favorites' : 'Add to favorites'}
            </button>
            {component !== undefined && (
              <>
                <button type="button" role="menuitem" onClick={() => openRow(item.itemKey, 'rename', component.name)}>
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setOpenTile(null)
                    // 🔒 confirmDelete off = delete straight away; the files go to the Trash either way.
                    if (library.confirmDelete) openRow(item.itemKey, 'confirm')
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

  /** The full-width row that "Add a word…", Rename or Delete opens under the tile's row. */
  const inlineRow = (item: StudioItem): ReactNode => {
    if (openTile?.key !== item.itemKey || openTile.mode === 'menu') return null
    const component = item.provider === 'component' ? componentsBySlug.get(item.providerId) : undefined
    if (openTile.mode === 'confirm' && component) {
      return (
        <div className="image-studio__inline" key={`${item.itemKey}:row`} role="alertdialog" aria-label={`Delete ${component.name}?`}>
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
      <form
        className="image-studio__inline"
        key={`${item.itemKey}:row`}
        onSubmit={(event) => {
          event.preventDefault()
          if (renaming && component) {
            setOpenTile(null)
            library.rename(component, draft)
          } else void saveWord(item)
        }}
      >
        {/* Autofocused: the menu item above is the only way here. */}
        <input
          autoFocus
          value={draft}
          maxLength={renaming ? 120 : 60}
          aria-label={renaming ? `Rename ${item.title}` : `A word for ${item.title}`}
          placeholder={renaming ? 'Name' : 'A word that finds it'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && setOpenTile(null)}
        />
        <button type="submit">Save</button>
        <button type="button" onClick={() => setOpenTile(null)}>
          Cancel
        </button>
      </form>
    )
  }

  /** A grid of tiles; an open inline row goes after the row its tile is on. */
  const grid = (items: readonly StudioItem[]) => {
    const cells: ReactNode[] = []
    items.forEach((item, i) => {
      cells.push(tile(item))
      const rowEnd = i % ROW === ROW - 1 || i === items.length - 1
      if (rowEnd) for (const other of items.slice(i - (i % ROW), i + 1)) cells.push(inlineRow(other))
    })
    return <div className="image-studio__grid">{cells}</div>
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
      {grid(items)}
    </section>
  )
  const row = (title: string, items: readonly StudioItem[], to: StudioChip) => items.length > 0 && section(title, items.slice(0, ROW), items.length > ROW ? { label: 'Show all', onClick: () => pickChip(to) } : undefined)

  const importMenu = (
    <span className="image-studio__section-menu">
      <button type="button" className="image-studio__more-inline" aria-label="More for Components" aria-expanded={importMenuOpen} onClick={() => setImportMenuOpen(!importMenuOpen)}>
        ⋯
      </button>
      {importMenuOpen && (
        <div className="image-studio__menu" role="menu">
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

  const chipTitle = CHIP_LABELS[chip]
  let body: ReactNode
  if (typed) {
    const mine = yours.slice(0, shownMatches)
    body = (
      <>
        {mine.length > 0 && section('Yours', mine, yours.length > shownMatches ? { label: 'Show more', onClick: () => setShownMatches(shownMatches + MATCH_PAGE) } : undefined)}
        {/* The web half appears once the web is asked: during the pause it would be an empty heading. */}
        {webOn && (isSearching || offline || searchedQuery !== '' || pageError !== null) && (
          <section className="image-studio__section" aria-label="From the web">
            <header className="image-studio__section-head">
              <h3>From the web</h3>
            </header>
            {offline && (
              <div className="image-studio__notice" role="status">
                {OFFLINE_NOTICE}
              </div>
            )}
            {warnings.length > 0 && <div className="image-studio__warning">{warnings.join(' ')}</div>}
            {webItems.length > 0 && grid(webItems)}
            {query.trim().length < 2 ? null : isSearching && results.length === 0 ? (
              <div className="image-studio__state" role="status">
                Searching…
              </div>
            ) : !isSearching && !offline && searchedQuery !== '' && webItems.length === 0 && results.length === 0 ? (
              <div className="image-studio__state">No graphics match “{searchedQuery}”</div>
            ) : null}
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
        {mine.length === 0 && !webOn && <div className="image-studio__state">Nothing of yours matches “{query.trim()}”</div>}
      </>
    )
  } else if (chip === 'all') {
    body = (
      <>
        {row('Favorites', favoriteItems, 'favorites')}
        {recentItems.length > 0 &&
          section('Recent', recentOpen ? recentItems : recentItems.slice(0, ROW), recentItems.length > ROW ? { label: recentOpen ? 'Show less' : 'Show all', onClick: () => set({ recentOpen: !recentOpen }) } : undefined)}
        {componentItems.length > 0 && section('Components', componentItems.slice(0, ROW), componentItems.length > ROW ? { label: 'Show all', onClick: () => pickChip('components') } : undefined, importMenu)}
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
        </>
      ) : (
        <div className="image-studio__state">Star an item and it stays here for every drawing.</div>
      )
  }

  return (
    <div className="image-studio">
      <div className="image-studio__search">
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
          onSubmit={(event) => {
            event.preventDefault()
            void library.commitSave(componentName)
          }}
        >
          {/* Autofocused: the button that opened this form is the only way here. */}
          <input autoFocus value={componentName} maxLength={120} required aria-label="Component name" placeholder="Name this component" onChange={(event) => setComponentName(event.target.value)} />
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

      <div className="image-studio__chips" role="group" aria-label="Show">
        {STUDIO_CHIPS.filter((c) => c !== 'photos' || pixabayAvailable).map((c) => (
          <button type="button" key={c} className={chip === c ? 'is-active' : undefined} aria-pressed={chip === c} onClick={() => pickChip(c)}>
            {CHIP_LABELS[c]}
          </button>
        ))}
      </div>

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
        onKeyDown={(event) => moveBetweenTiles(event, listRef.current, fieldRef.current)}
        onScroll={(event) => {
          scrollTops[chip] = event.currentTarget.scrollTop
        }}
      >
        {body}
      </div>
      <footer className="image-studio__footer">Graphics via Pixabay · icons via Iconify.</footer>
    </div>
  )
}
