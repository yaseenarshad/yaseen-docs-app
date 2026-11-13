/**
 * THE EXPLORE STACK (YAZ-2571): ⌘⇧F opens a search panel in the middle of the window; Enter opens the note ON TOP
 * of the search, for reading; ⌘⇧F again adds a search on top of that; a link in a note adds that note on top; Esc
 * removes ONE layer, the top one. Every layer stays mounted while it is covered, so each keeps its own scroll
 * place exactly: the defining requirement (no jump, no flash of the top). The workspace under the stack never moves.
 *
 * One stack per window, in its own chunk (App lazy-loads it on the first ⌘⇧F). The list of layers is state
 * (`layers.ts`); the DOM keeps each layer's scroll. The rows of every search layer come from ONE candidate
 * feed (`useSearchCandidates`): a nested search adds no index read. The keys are read on the stack's root: Esc,
 * E (read → edit), ⌘↵ (the top note in a tab, the stack closes; on a search, its highlighted row, YAZ-4984), and ‹ › (round 3: a note opened from a search
 * steps through that search's rows in place, ← / → while reading, ⌘⌥↑ / ⌘⌥↓ in any mode; `shared/keys/explore.ts`).
 * A menu, a picker or a pop-up that takes Esc keeps it (the mini window's rule, YAZ-4547). At most 12 layers; a
 * 13th says so and opens nothing. Each layer moves like a cell note (round 3, `layerBoxes.ts`). The layers act like
 * windows (round 6): a press on a layer behind brings it to the front (`frontOrder`); the keys and Esc go to the front one.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { rootOfPath, type CommentsOrder, type OpenStat, type ZoomStep } from '@shared/types'
import type { GestureAction } from '@shared/keys'
import { stepZoomByKey } from '../editor/DocumentZoom'
import type { LinkActions } from '../editor/linkMenu'
import { isNoteKey } from '../editor/noteKeys'
import { ZOOM_EVENT } from '../editor/zoomRequest'
import { focusOpenDocument } from '../lib/focusHandoff'
import { flushRenamedPath } from '../lib/renameContinuity'
import { storage } from '../lib/storage'
import type { SearchCandidate } from '../search/searchCandidates'
import { useSearchCandidates, type SearchVault } from '../search/useSearchResults'
import { ContextMenu } from '../sidebar/ContextMenu'
import { ExploreBoard } from './ExploreBoard'
import { ExploreCard } from './ExploreCard'
import { ExploreNote, type ExploreVault } from './ExploreNote'
import { exploreNoteSections } from './exploreMenu'
import { exploreRecents, onExploreMove, rememberExploreRecent } from './exploreRecents'
import { ExploreSearch, type SearchLink } from './ExploreSearch'
import { textCandidates } from './exploreRows'
import { recentSections } from './recentSections'
import { ExploreArrange } from './ExploreArrange'
import { GRIPS, useLayerBoxes } from './layerBoxes'
import { layoutForCount, pickRecent, TILE_MS, TILE_PLACES, tileBoxes, tileOrder, type ArrangeLayout, type TileLayout } from './tile'
import { frontOrder, layerKindOf, MAX_LAYERS, NOTE_MS, newLayerId, pushLayer, raiseLayer, saveExploreZoom, savedExploreZoom, SEARCH_MS, stepCount, stepPlace, stepResult, topNote, type ExploreLayer, type ExploreRequest } from './layers'
import './explore.css'

export interface ExploreStackProps {
  /**
   * Bumped by each ask while the stack shows: one more layer on top (a search, or `requestLayer`). The Explore key
   * again adds a NEW search on top (YAZ-4994 decision: "CMD SHIFT F again should open a new search").
   */
  request: number
  /**
   * With the ask: a layer to open instead of a search — a page for reading ("Open in Explore", YAZ-4936), landed on a
   * note card or in edit mode (the Inbox's O and E, YAZ-4962), or a card window (`mdapp:note-card-open`, D13).
   */
  requestLayer?: ExploreRequest | null
  /** The window's vaults for the search: root, watcher, folders; no other files (the stack reads notes). */
  vaults: readonly SearchVault[]
  vaultOf: (path: string) => ExploreVault
  nameOf: (path: string) => string
  textVarsFor: (path: string) => CSSProperties
  /** `unlocked` (YAZ-4939): the layer's timed "Allow edits" runs, so the vault's Read only does not lock this editor. */
  renderEditor: (path: string, openLink: (path: string) => void, unlocked: boolean) => ReactNode
  createFolder: (sourcePath: string) => string
  /** App's read-only door (YAZ-4985), for a reading layer's link to a missing page. */
  onFileAction?: (root: string) => Promise<boolean>
  linkActions?: LinkActions
  /** A note in a normal tab (⌘↵, ↗), a folder's page or another file (a drawing, a PDF): the stack closes. */
  openInTab: (path: string) => void
  /** A link's bound gesture in a card window (⌘-click, YAZ-4962): App's link door; a background tab keeps the stack. */
  openLinkIn?: (path: string, where: GestureAction) => void
  onNotice: (message: string) => void
  /** The tab menu's "Rename file" (App's `renameInSidebar`): the note menu's row (round 1, items 6 and 7). */
  onRenameFile?: (path: string) => void
  /** The comment stream's order and its toggle (YAZ-1515): a note layer shows the stream as its tab does (round 1, item 3). */
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
  /** The last Esc, ⌘↵ and the click outside: App unmounts the stack and the keyboard goes back where it was. */
  onClose: () => void
  /** The empty box (YAZ-4945): a vault's open history (`storage.getOpens`) and its save log (`storage.getEdits`). */
  opensOf?: (root: string) => Readonly<Record<string, OpenStat>>
  editsOf?: (root: string) => Readonly<Record<string, number>>
}

const noLog = () => ({})

/** The layer a note or a board opens as (YAZ-4943): a note for reading, a board (a drawing or a diagram) for reading. */
const fileLayer = (path: string, from?: { search: number; at: number }): ExploreLayer =>
  layerKindOf(path) === 'board' ? { id: newLayerId(), kind: 'board', path, ...(from !== undefined && { from }) } : { id: newLayerId(), kind: 'note', path, mode: 'read', ...(from !== undefined && { from }) }

/** The layer App's ask opens (YAZ-4962): a card window, or a page, landed on a card and in edit mode when asked. */
const requestedLayer = (ask: ExploreRequest): ExploreLayer => {
  if (ask.kind === 'card') return { id: newLayerId(), kind: 'card', path: ask.path, cardId: ask.cardId, index: ask.index }
  const layer = fileLayer(ask.path)
  return layer.kind === 'note' ? { ...layer, ...(ask.edit === true && { mode: 'edit' }), ...(ask.card !== undefined && { card: ask.card }) } : layer
}

/** The Tile keys (YAZ-4944, `shared/keys/explore.ts`) and their layouts. */
const TILE_KEYS: ReadonlyArray<readonly [string, ArrangeLayout]> = [
  ['explore.tileTwo', 'two'],
  ['explore.tileThree', 'three'],
  ['explore.tileGrid', 'grid'],
  ['explore.tileGridCentre', 'gridCentre'],
  ['explore.tileStack', 'stack'],
]

/** The notice of a 13th layer. */
export const FULL_NOTICE = `The explore stack holds ${MAX_LAYERS} layers. Close some first (Esc).`

/** The window's size, for the places: read on mount and on each resize, never per render. */
function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** A key typed into a field, an editor or a menu belongs to it, never to the stack's letters. */
const inField = (target: EventTarget | null): boolean => target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]') !== null

/** What Tab can reach: the trail's chips and the front layer (round 6). */
const TABBABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function ExploreStack({ request, requestLayer = null, vaults, vaultOf, nameOf, textVarsFor, renderEditor, createFolder, onFileAction, linkActions, openInTab, openLinkIn, onNotice, onRenameFile, commentsOrder, onChangeCommentsOrder, onClose, opensOf, editsOf }: ExploreStackProps) {
  const [layers, setLayers] = useState<readonly ExploreLayer[]>([])
  const layersRef = useRef(layers)
  layersRef.current = layers
  /** The front order as of the last raise (round 6), by id: the list keeps the open order, this says which layer is in front. */
  const [order, setOrder] = useState<readonly number[]>([])
  const ordered = useMemo(() => frontOrder(layers, order), [layers, order])
  /**
   * A layer in edit on its way out (a close, ⌘↵, a menu row that closes the stack): its editor's pending save goes
   * through the one flush door first, so a read of the note anywhere (`savedFirst`) waits for it. The unmount's own
   * flush writes too, but tells no reader.
   */
  const flushEdits = useCallback(() => {
    for (const l of layersRef.current) if (l.kind === 'note' && l.mode === 'edit') void flushRenamedPath(l.path)
  }, [])

  /** The layers on their way out (the exit motion), by id: still drawn, no keys, gone after the motion. */
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const windowSize = useWindowSize()
  // Where each layer stands (round 3): written to the layers' style, never rendered; the head drags, the grips resize.
  const gestures = useLayerBoxes(rootRef, layers, windowSize.width, windowSize.height)
  /** The one zoom of every note layer (round 4): the page zoom's pill and keys, kept in localStorage; a note tab's zoom is its own. */
  const [zoom, setZoomState] = useState(savedExploreZoom)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setZoom = useCallback((next: number) => {
    zoomRef.current = next
    setZoomState(next)
    saveExploreZoom(next)
  }, [])
  /** Each search layer's rows (round 3), by layer id: what the note over it steps through. Dropped with the layer. */
  const links = useRef(new Map<number, SearchLink>())
  /** Bumped when a search's rows change under a note from it (YAZ-2571 bug): the note's ‹ n/m › is drawn again with the new rows. */
  const [, setRowsSeen] = useState(0)
  const linkOf = (id: number): SearchLink => {
    let link = links.current.get(id)
    if (link === undefined) {
      link = { rows: [], changed: () => setRowsSeen((n) => n + 1) }
      links.current.set(id, link)
    }
    return link
  }
  useEffect(() => {
    const ids = new Set(layers.map((l) => l.id))
    for (const id of [...links.current.keys()]) if (!ids.has(id)) links.current.delete(id)
  }, [layers])
  /** Each board layer's zoom door (YAZ-4943), by layer id: the menu's ⌘+ / ⌘− / ⌘0 reach the board in front. The layer removes it. */
  const boardZooms = useRef(new Map<number, (step: ZoomStep) => void>())
  const zoomDoors = useRef(new Map<number, (zoom: ((step: ZoomStep) => void) | null) => void>())
  const zoomDoorOf = (id: number) => {
    let door = zoomDoors.current.get(id)
    if (door === undefined) {
      door = (zoom) => {
        if (zoom === null) {
          boardZooms.current.delete(id)
          zoomDoors.current.delete(id)
        } else boardZooms.current.set(id, zoom)
      }
      zoomDoors.current.set(id, door)
    }
    return door
  }
  // One feed for every search layer; the text rows (tags, frontmatter values) ride with the records.
  const candidates = useSearchCandidates(vaults, true, textCandidates)
  const roots = useMemo(() => vaults.map((v) => v.root), [vaults])
  /** The vault's "Show IDs in search" for a row (YAZ-4940); a path in no vault reads Always. */
  const idsInTitle = useCallback((path: string) => vaults[roots.indexOf(rootOfPath(roots, path) ?? '')]?.idsInTitle?.() ?? true, [vaults, roots])
  const idsInSearch = useCallback((path: string) => vaults[roots.indexOf(rootOfPath(roots, path) ?? '')]?.idsInSearch?.() ?? 'always', [vaults, roots])
  // The empty box (YAZ-4945): Opened and Edited, of this window's vaults (a folder of a vault: under it, `inPlace`).
  // Read again at each open or step (a new list) and each ⌘⇧F (`request`), never per keystroke.
  const recentAll = exploreRecents()
  const recent = useMemo(
    () => recentSections({ vaults, explore: recentAll, opensOf: opensOf ?? noLog, editsOf: editsOf ?? noLog }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentAll, vaults, opensOf, editsOf, request],
  )
  /** Each file's own search row (its title and ID), for the empty box's rows: built once per index snapshot. */
  const rowByPath = useMemo(() => {
    const by = new Map<string, SearchCandidate>()
    for (const c of candidates) if (c.kind === 'file' && c.snippet === undefined && !by.has(c.path)) by.set(c.path, c)
    return by
  }, [candidates])
  const rowOf = useCallback((path: string) => rowByPath.get(path), [rowByPath])

  const doors = useRef({ onNotice, onClose, openInTab, openLinkIn, onRenameFile, linkActions })
  doors.current = { onNotice, onClose, openInTab, openLinkIn, onRenameFile, linkActions }
  /** The note menu on show (round 1, items 6 and 7): where, and for which note. */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const noteSections = useCallback(
    (path: string) =>
      exploreNoteSections(path, {
        openInTab: (p) => doors.current.openInTab(p),
        linkActions: doors.current.linkActions,
        onRenameFile: doors.current.onRenameFile,
        onNotice: (m) => doors.current.onNotice(m),
        closeStack: () => {
          flushEdits()
          doors.current.onClose()
        },
      }),
    [flushEdits],
  )

  /**
   * A layer on top, or the full notice. Decided on the list as it is NOW (`layersRef`, moved on at once so two pushes
   * in one tick count both): React may run a state updater later, so a flag set inside one read false and said
   * "full" for a push that happened (YAZ-4943 gotcha: a click on a link from outside React).
   */
  const push = useCallback((layer: ExploreLayer): boolean => {
    const next = pushLayer(layersRef.current, layer)
    if (next === null) {
      doors.current.onNotice(FULL_NOTICE)
      return false
    }
    layersRef.current = next
    setLayers((prev) => pushLayer(prev, layer) ?? prev)
    return true
  }, [])

  // A note of a layer renamed elsewhere (App's `file:renamed`) moves the layer to the new path: its title, chip and
  // read follow, and an editor mounts there (as the mini window's does). Deleted: the layer reads again and says so.
  useEffect(
    () =>
      onExploreMove((from, to) => {
        const at = (path: string) => path === from || path.startsWith(`${from}/`)
        setLayers((prev) =>
          prev.map((l) => {
            if (l.kind === 'search' || !at(l.path)) return l
            // A board that is gone says so itself (its window's "Missing …"); a card reads its page again from the index.
            if (l.kind === 'board' || l.kind === 'card') return to === null ? l : { ...l, path: to + l.path.slice(from.length) }
            return to === null ? { ...l, mode: 'read', gone: (l.gone ?? 0) + 1 } : { ...l, path: to + l.path.slice(from.length) }
          }),
        )
      }),
    [],
  )

  // Each ask: a search layer on top (the first one opens the stack), or the asked layer.
  const served = useRef(0)
  useEffect(() => {
    if (request === served.current) return
    served.current = request
    if (requestLayer === null) push({ id: newLayerId(), kind: 'search' })
    else if (push(requestedLayer(requestLayer)) && requestLayer.kind === 'note') rememberExploreRecent(requestLayer.path)
  }, [request, requestLayer, push])

  /** A note or a board (YAZ-4943) goes on top for reading; a folder or another file opens in a tab and the stack closes. */
  const openPath = useCallback(
    (path: string) => {
      if (layerKindOf(path) === null) {
        doors.current.openInTab(path)
        doors.current.onClose()
        return
      }
      if (push(fileLayer(path))) rememberExploreRecent(path)
    },
    [push],
  )
  /** A card window's page (YAZ-4962): on top, landed on the card. */
  const openPageAt = useCallback((path: string, card: number) => {
    const layer = fileLayer(path)
    if (layer.kind === 'note' && push({ ...layer, card })) rememberExploreRecent(path)
  }, [push])
  /** A card window's link with a bound gesture: a background tab keeps the stack; any other tab closes it. */
  const openTabFromCard = useCallback((path: string, where: GestureAction) => {
    const { openLinkIn: linkIn, openInTab: inTab, onClose: closeAll } = doors.current
    if (where === 'backgroundTab' && linkIn !== undefined) return linkIn(path, where)
    flushEdits()
    inTab(path)
    closeAll()
  }, [flushEdits])
  /** A row of search layer `search` at `at` (round 3): the layer remembers them, so ‹ › step through that search. */
  const openRow = useCallback(
    (search: number, row: SearchCandidate, at: number) => {
      if (layerKindOf(row.path) === null) return openPath(row.path)
      if (push(fileLayer(row.path, { search, at }))) rememberExploreRecent(row.path)
    },
    [push, openPath],
  )

  /**
   * ‹ › (round 3): the note layer `id` goes to the next (`dir` 1) or the previous note row of the search under it,
   * in place: no layer is added. In edit the note's pending save flushes first (a cell note's step), and the editor
   * mounts on the next note. False at the end of the rows, or for a note that came from a link.
   */
  const step = useCallback((id: number, dir: -1 | 1): boolean => {
    const layer = layersRef.current.find((l) => l.id === id)
    if (layer === undefined || layer.kind === 'search' || layer.kind === 'card' || layer.from === undefined) return false
    const search = layer.from.search
    const to = stepResult(links.current.get(search)?.rows ?? [], layer.from.at, layer.path, dir)
    if (to === null) return false
    if (layer.kind === 'note' && layer.mode === 'edit') void flushRenamedPath(layer.path)
    // A step may cross between a note and a board (YAZ-4943): the SAME layer (its id, box and place) shows the next
    // file in its kind; a note keeps its mode, a board reads.
    const from = { search, at: to.at }
    setLayers((prev) =>
      prev.map((l): ExploreLayer => {
        if (l.id !== id || l.kind === 'search' || l.kind === 'card') return l
        if (layerKindOf(to.path) === 'board') return { id, kind: 'board', path: to.path, from }
        return { id, kind: 'note', path: to.path, mode: l.kind === 'note' ? l.mode : 'read', from }
      }),
    )
    rememberExploreRecent(to.path)
    return true
  }, [])

  /** A layer leaves (the front one by default: Esc, the backdrop): the exit motion, then it is gone; the last one closes the stack. */
  const close = useCallback((id?: number) => {
    const live = ordered.filter((l) => !leaving.has(l.id))
    const gone = id === undefined ? live[live.length - 1] : live.find((l) => l.id === id)
    if (gone === undefined) return
    if (gone.kind === 'note' && gone.mode === 'edit') void flushRenamedPath(gone.path)
    if (live.length === 1) {
      doors.current.onClose()
      return
    }
    const ms = reducedMotion() ? 0 : gone.kind === 'search' ? SEARCH_MS : NOTE_MS
    const remove = () => {
      setLayers((prev) => prev.filter((l) => l.id !== gone.id))
      setLeaving((prev) => {
        const next = new Set(prev)
        next.delete(gone.id)
        return next
      })
    }
    if (ms === 0) return remove()
    setLeaving((prev) => new Set(prev).add(gone.id))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      remove()
    }, ms)
    timers.current.add(timer)
  }, [ordered, leaving])
  const pop = useCallback(() => close(), [close])

  /** The live layers from back to front: the last one is the front layer, the one the keys go to. */
  const live = useMemo(() => ordered.filter((l) => !leaving.has(l.id)), [ordered, leaving])
  const top = live[live.length - 1]
  const topRef = useRef(top)
  topRef.current = top

  // ⌘+ / ⌘− / ⌘0 while Explore is open (round 4): the menu's step (`requestZoom`, App) zooms the TOP note layer, on the
  // page zoom's key ladder; on a search layer it does nothing. Caught on the document first, so neither the tab behind
  // nor the editor inside a layer (its own `.editor` listener) takes it, and the sidebar's fallback never runs.
  useEffect(() => {
    const onZoom = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      const layer = topRef.current
      const step = (event as CustomEvent<ZoomStep>).detail
      // A board on top (YAZ-4943): its own zoom.
      if (layer?.kind === 'board') return boardZooms.current.get(layer.id)?.(step)
      if (layer === undefined || layer.kind !== 'note') return
      setZoom(step === 0 ? 100 : (stepZoomByKey(zoomRef.current, step) ?? zoomRef.current))
    }
    document.addEventListener(ZOOM_EVENT, onZoom, true)
    return () => document.removeEventListener(ZOOM_EVENT, onZoom, true)
  }, [setZoom])

  /**
   * A layer comes to the front (round 6): a press on it, or its chip in the trail. It keeps its box, scroll, search and
   * mode; only the draw and key order change. The front layer takes the keyboard (its `active` effects).
   */
  const raise = useCallback((id: number) => setOrder((prev) => raiseLayer(layersRef.current, prev, id)), [])

  const setMode = useCallback((id: number, mode: 'read' | 'edit') => setLayers((prev) => prev.map((l) => (l.id === id && l.kind === 'note' && l.mode !== mode ? { ...l, mode } : l))), [])
  /**
   * A note layer's mode flips (item 5): Edit / E to edit; Done / Esc back to reading. Leaving edit FIRST flushes the
   * editor's pending save (`flushRenamedPath`: the flush a tab close and a mini-window step take) and waits for it, THEN
   * reads: the reading view shows what was typed, never the file from before the save.
   */
  const toggleEdit = useCallback(
    (id: number) => {
      const layer = layersRef.current.find((l) => l.id === id)
      if (layer === undefined || layer.kind !== 'note') return
      if (layer.mode === 'read') return setMode(id, 'edit')
      void flushRenamedPath(layer.path).finally(() => setMode(id, 'read'))
    },
    [setMode],
  )

  /** Notes and boards open now: what the Tile button arranges. */
  const fileCount = live.filter((l) => l.kind !== 'search').length
  /**
   * Tile (YAZ-4944): `ids` (the most recently used first; by default the layout's places of notes and boards, the
   * front order's newest) to the layout's cells, in the window under the top bar; the others stay where they stand,
   * behind. Stack: every layer back to its stack place. The windows glide there (`explore--gliding`, the CSS
   * transition of their box; none with reduced motion): style writes only, plus one render for the front order.
   */
  const tile = useCallback(
    (layout: ArrangeLayout, ids?: readonly number[]) => {
      const root = rootRef.current
      if (root === null) return
      if (!reducedMotion()) {
        root.classList.add('explore--gliding')
        const timer = setTimeout(() => {
          timers.current.delete(timer)
          root.classList.remove('explore--gliding')
        }, TILE_MS + 50)
        timers.current.add(timer)
      }
      if (layout === 'stack') return gestures.restack()
      const picked = ids ?? pickRecent(live, TILE_PLACES[layout], false)
      if (picked.length === 0) return
      const bar = root.querySelector('.explore__trail')?.getBoundingClientRect().bottom ?? 0
      gestures.arrange(tileBoxes(layout, picked, { x: 0, y: bar, width: windowSize.width, height: windowSize.height - bar }))
      setOrder(tileOrder(live, picked))
    },
    [live, gestures, windowSize],
  )
  /** The ▦ Tile button: the layout by how many notes and boards are open. */
  const tileAuto = () => {
    const layout = layoutForCount(fileCount)
    if (layout !== null) tile(layout)
  }
  /** The Arrange popover (▾), and where the keyboard was when it opened: it goes back there when it closes. */
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const arrangeFrom = useRef<Element | null>(null)
  const openArrange = () => {
    arrangeFrom.current = document.activeElement
    setArrangeOpen(true)
  }
  const closeArrange = useCallback(() => {
    setArrangeOpen(false)
    const from = arrangeFrom.current
    arrangeFrom.current = null
    if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true })
  }, [])

  /** ⌘↵ on a search row (YAZ-4984): that row in a tab (a note, a board, a folder's page), and the stack closes. */
  const rowToTab = useCallback(
    (row: SearchCandidate) => {
      flushEdits()
      doors.current.openInTab(row.path)
      doors.current.onClose()
    },
    [flushEdits],
  )
  const toTab = useCallback(() => {
    const note = topNote(live)
    if (note === null) return
    flushEdits()
    doors.current.openInTab(note.path)
    doors.current.onClose()
  }, [live, flushEdits])

  // The editor of the top layer takes the caret when it mounts (E); the stack's root otherwise, so the keys are heard.
  useEffect(() => {
    if (top === undefined) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-layer="${top.id}"]`)
    if (el === null || el === undefined) return
    if (top.kind === 'note' && top.mode === 'edit') {
      // The editor mounts its document a tick later: ask until it is there, a few frames at most.
      let tries = 0
      const tick = () => {
        if (focusOpenDocument(el) || ++tries > 20) return
        timer = setTimeout(tick, 16)
        timers.current.add(timer)
      }
      let timer = setTimeout(tick, 0)
      timers.current.add(timer)
    }
  }, [top])

  /**
   * ⌘↵ in an edit layer (YAZ-4988, Yaseen: "CMD enter kinda acts as your way to put it back into read mode"): back to
   * reading, locked again at once in a Read only vault; the next ⌘↵ opens the tab. Heard in the capture phase, ahead of
   * the editor's own ⌘↵ (a task box, a line below a table or an embed, Open card): the layer's key wins in the text and
   * on a note card. Inside a code block's editor the key stays the code's (a new line): a key typed into code keeps its meaning.
   */
  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (top === undefined || top.kind !== 'note' || top.mode !== 'edit') return
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return
    const target = event.target instanceof Element ? event.target : null
    const layer = rootRef.current?.querySelector(`[data-layer="${top.id}"]`) ?? null
    if (target === null || layer === null || !layer.contains(target)) return
    if (target.closest('.cm-editor') !== null && target.closest('.note-card') === null) return
    event.preventDefault()
    event.stopPropagation()
    setLayers((prev) => prev.map((l) => (l.id === top.id && l.kind === 'note' ? { ...l, leaveAsk: (l.leaveAsk ?? 0) + 1 } : l)))
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (top === undefined) return
    // A key inside an IME composition (Japanese input; keyCode 229 on some keyboards) is the composition's: Esc cancels it, nothing else.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-layer="${top.id}"]`) ?? null
    // Tab (round 6): the layers behind take the pointer, not the keyboard. Tab goes round the trail and the front layer only.
    if (event.key === 'Tab' && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.altKey && el !== null) {
      const chips = rootRef.current?.querySelectorAll<HTMLElement>('.explore__trail button') ?? []
      // A part that CSS hides (⋯ of a full head, the parts a narrow head folds, YAZ-4956) takes no focus: Tab passes it.
      const reach = [...chips, ...el.querySelectorAll<HTMLElement>(TABBABLE)].filter((e) => e.closest('[hidden]') === null && e.checkVisibility?.() !== false)
      const from = document.activeElement
      if (reach.length === 0 || from === null) return
      event.preventDefault()
      const after = reach.filter((e) => (from.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
      const before = reach.filter((e) => (from.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING) !== 0)
      const next = event.shiftKey ? (before[before.length - 1] ?? reach[reach.length - 1]) : (after[0] ?? reach[0])
      next.focus()
      return
    }
    if (event.key === 'Escape') {
      // The note menu's own Esc (the `ContextMenu` closes itself) and a menu's: nothing else closes.
      if (event.target instanceof Element && event.target.closest('.ctx-menu') !== null) return
      // ⇧Esc closes every layer in one key (YAZ-4926): a note in edit saves first; App gives the keyboard back.
      if (event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        flushEdits()
        doors.current.onClose()
        return
      }
      // A pop-up of the editor (the `[[` picker, a menu) took this Esc while the caret stays in the layer: it closed
      // the pop-up, nothing more. The editor's own Esc (to the sidebar) moves the focus out: the layer closes then.
      if (event.defaultPrevented && el !== null && el.contains(document.activeElement)) return
      event.preventDefault()
      event.stopPropagation()
      // Esc goes back ONE step (item 5): out of edit first (the note saved as you typed, the scroll place stays), then the layer.
      // In a Read only vault, out of edit also locks the page again at once (YAZ-4997, Yaseen: "CMD Enter and/or esc to go
      // back to read only mode"), as ⌘↵ does: the layer's `leaveAsk`.
      if (top.kind === 'note' && top.mode === 'edit') setLayers((prev) => prev.map((l) => (l.id === top.id && l.kind === 'note' ? { ...l, leaveAsk: (l.leaveAsk ?? 0) + 1 } : l)))
      else pop()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey) {
      // In edit, the layer's ⌘↵ went back to reading (`onKeyDownCapture`); a code block's ⌘↵ is the code's.
      if (topNote(live) === null || (top.kind === 'note' && top.mode === 'edit')) return
      event.preventDefault()
      event.stopPropagation()
      toTab()
      return
    }
    // Tile (YAZ-4944): ⌥⌘2 … ⌥⌘5, ⌥⌘0. A key the editor took (a heading in edit) is left to it.
    if (!event.defaultPrevented) {
      const overrides = storage.getSettings()?.hotkeys
      const hit = TILE_KEYS.find(([id]) => isNoteKey(event, id, overrides))
      if (hit !== undefined) {
        event.preventDefault()
        event.stopPropagation()
        tile(hit[1])
        return
      }
    }
    // ‹ › (round 3): a bare key (← / →) is the caret's while a field or the editor has the keyboard, so it steps only
    // while reading; a chord (⌘⌥↓ / ⌘⌥↑) steps in any mode. A key the editor took (a cell note's own step) is left.
    if ((top.kind === 'note' || top.kind === 'board') && top.from !== undefined && !event.defaultPrevented) {
      const overrides = storage.getSettings()?.hotkeys
      const dir = isNoteKey(event, 'explore.nextResult', overrides) ? 1 : isNoteKey(event, 'explore.previousResult', overrides) ? -1 : 0
      if (dir !== 0) {
        const bare = !event.metaKey && !event.ctrlKey && !event.altKey
        if (bare && ((top.kind === 'note' && top.mode === 'edit') || inField(event.target))) return
        if (step(top.id, dir)) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
    }
    // E on the reading surface edits (item 5); Esc and Done leave edit. No ⌘E: it is the note's Inline code, and
    // Yaseen's own ⌘E goes to his emoji app ("i thought leaving edit was esc?").
    if ((event.key === 'e' || event.key === 'E') && !event.metaKey && !event.ctrlKey && !event.altKey && top.kind === 'note' && top.mode === 'read' && !inField(event.target)) {
      event.preventDefault()
      // In a Read only vault (YAZ-4939) the layer decides: it asks with its timed "Allow edits", or edits while unlocked.
      if (vaultOf(top.path).readOnly === true) setLayers((prev) => prev.map((l) => (l.id === top.id && l.kind === 'note' ? { ...l, editAsk: (l.editAsk ?? 0) + 1 } : l)))
      else toggleEdit(top.id)
    }
  }

  // A press on a layer behind brings it to the front (round 6), before the press does its own thing (a focus, ×, a drag).
  const onPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const layer = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-layer]') : null
    if (layer === null || top === undefined) return
    const id = Number(layer.dataset.layer)
    if (id !== top.id && !leaving.has(id)) raise(id)
  }

  /** A layer's name in the trail and in Arrange: Search, the page's name, or the card's ID (YAZ-4962). */
  const trailName = (layer: ExploreLayer): string => (layer.kind === 'search' ? 'Search' : layer.kind === 'card' ? (layer.cardId ?? 'Note card') : nameOf(layer.path))

  /** For each search layer, the note from it nearest the front (round 3, round 6): its row is the one marked. */
  const markedOf = new Map<number, { path: string; at: number }>()
  for (const l of live) if ((l.kind === 'note' || l.kind === 'board') && l.from !== undefined) markedOf.set(l.from.search, { path: l.path, at: l.from.at })

  // A click on the dim outside every layer: the front layer closes, as Esc does.
  const onBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      // A press on a blank part of a layer (a search's footer, its empty list) takes no focus away (round 6): the
      // keyboard stays in the layer, where its raise put it, and the stack's keys are still heard.
      const target = event.target instanceof Element ? event.target : null
      const layer = target?.closest('[data-layer]') ?? null
      const taker = target?.closest('input, textarea, select, button, a[href], [tabindex], [contenteditable="true"]') ?? null
      if (layer !== null && (taker === null || !layer.contains(taker))) event.preventDefault()
      return
    }
    event.preventDefault()
    pop()
  }

  return (
    <div ref={rootRef} className="explore" role="dialog" aria-modal="true" aria-label="Explore the vault" onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture} onMouseDown={onBackdropMouseDown} onPointerDownCapture={onPointerDownCapture}>
      {/* The trail (YAZ-4925): one chip per layer from two layers on, in the open order, the front one bold; a click brings that layer to the front (round 6). */}
      {live.length > 1 && (
        <nav className="explore__trail" aria-label="Layers">
          {layers.filter((l) => !leaving.has(l.id)).map((layer, i) => (
            <span key={layer.id} className="explore__trail-step">
              {i > 0 && <span className="explore__trail-sep">›</span>}
              <button type="button" className={`explore__chip${layer === top ? ' explore__chip--top' : ''}`} aria-current={layer === top ? 'true' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => raise(layer.id)}>
                {trailName(layer)}
              </button>
            </span>
          ))}
          {/* Tile (YAZ-4944): arrange the windows; ▾ opens Arrange (the layouts and which windows). */}
          <span className="explore__trail-tools">
            <button type="button" className="explore__tile" disabled={fileCount < 2} title={fileCount < 2 ? 'Open two or more notes or boards to tile them' : 'Tile the notes and boards (⌥⌘2 … ⌥⌘5; ⌥⌘0: back to the stack)'} onMouseDown={(e) => e.preventDefault()} onClick={tileAuto}>
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <rect x="0.5" y="0.5" width="4.75" height="4.75" rx="1" />
                <rect x="6.75" y="0.5" width="4.75" height="4.75" rx="1" />
                <rect x="0.5" y="6.75" width="4.75" height="4.75" rx="1" />
                <rect x="6.75" y="6.75" width="4.75" height="4.75" rx="1" />
              </svg>
              Tile
            </button>
            <button type="button" className="explore__tile-more" aria-label="Arrange…" title="Arrange: pick a layout and the windows" aria-expanded={arrangeOpen} onMouseDown={(e) => e.preventDefault()} onClick={() => (arrangeOpen ? closeArrange() : openArrange())}>
              ▾
            </button>
          </span>
        </nav>
      )}
      {arrangeOpen && live.length > 1 && (
        <ExploreArrange
          windows={[...live].reverse().map((l) => ({ id: l.id, kind: l.kind, name: trailName(l) }))}
          initial={(layoutForCount(fileCount) ?? 'two') satisfies TileLayout}
          onApply={(layout, ids) => {
            closeArrange()
            tile(layout, ids)
          }}
          onClose={closeArrange}
        />
      )}
      {layers.map((layer) => {
        const covered = layer !== top
        const out = leaving.has(layer.id)
        // The place and size come from `useLayerBoxes`, written to the style; only the motion's length is rendered.
        // The draw order is the front order (round 6): the DOM keeps the open order, so no layer moves in it (a move would lose its scroll).
        const style = { '--explore-ms': `${layer.kind === 'search' ? SEARCH_MS : NOTE_MS}ms`, zIndex: ordered.indexOf(layer) + 1 } as CSSProperties
        /** A search layer: the note that came from it nearest the front, whose row stays marked (round 3). */
        const marked = layer.kind === 'search' ? markedOf.get(layer.id) ?? null : null
        /** A note layer from a search: its place among that search's rows, and whether a step each way exists. */
        const rows = (layer.kind === 'note' || layer.kind === 'board') && layer.from !== undefined ? (links.current.get(layer.from.search)?.rows ?? []) : null
        const steps =
          (layer.kind === 'note' || layer.kind === 'board') && layer.from !== undefined && rows !== null
            ? { place: stepPlace(rows, layer.from.at, layer.path), count: stepCount(rows), prev: stepResult(rows, layer.from.at, layer.path, -1) !== null, next: stepResult(rows, layer.from.at, layer.path, 1) !== null, onStep: (dir: -1 | 1) => void step(layer.id, dir) }
            : undefined
        return (
          <div
            key={layer.id}
            data-layer={layer.id}
            data-kind={layer.kind}
            className={`explore__layer explore__layer--${layer.kind}${covered ? ' explore__layer--covered' : ''}${out ? ' explore__layer--out' : ' explore__layer--in'}`}
            style={style}
            // A covered layer stays on screen, at its scroll; a press brings it to the front (round 6). Until then no key
            // reaches it (the stack's keys go to the front layer, Tab goes round the front layer) and assistive tech skips it.
            // A layer on its way out takes nothing.
            inert={out}
            aria-hidden={covered}
          >
            {layer.kind === 'search' ? (
              <>
                {/* The search moves by its top edge (round 3): the input keeps its text selection. */}
                <div className="explore__grab" title="Drag to move; double-click to put back" onMouseDown={(e) => gestures.onHeadDown(layer.id, e)} onDoubleClick={(e) => gestures.reset(layer.id, e)} />
                <ExploreSearch candidates={candidates} link={linkOf(layer.id)} markedRow={marked} recent={recent} rowOf={rowOf} roots={roots} nameOf={nameOf} onOpen={(row, at) => openRow(layer.id, row, at)} onOpenInTab={rowToTab} onRowMenu={(row, x, y) => setMenu({ x, y, path: row.path })} idsInSearch={idsInSearch} active={!covered} />
              </>
            ) : layer.kind === 'card' ? (
              <ExploreCard
                path={layer.path}
                cardId={layer.cardId}
                index={layer.index}
                pageName={nameOf(layer.path)}
                vault={vaultOf(layer.path)}
                onOpenPage={(index) => openPageAt(layer.path, index)}
                onOpenLink={openPath}
                onOpenTab={openTabFromCard}
                onOpenInTab={toTab}
                onNotice={onNotice}
                onHeadDown={(e) => gestures.onHeadDown(layer.id, e)}
                onHeadReset={(e) => gestures.reset(layer.id, e)}
                onClose={() => close(layer.id)}
                active={!covered}
              />
            ) : layer.kind === 'board' ? (
              <ExploreBoard
                path={layer.path}
                title={nameOf(layer.path)}
                idInTitle={idsInTitle(layer.path)}
                vault={vaultOf(layer.path)}
                steps={steps}
                onOpenLink={openPath}
                onNotice={onNotice}
                onHeadDown={(e) => gestures.onHeadDown(layer.id, e)}
                onHeadReset={(e) => gestures.reset(layer.id, e)}
                onOpenInTab={toTab}
                onHeadMenu={(x, y) => setMenu({ x, y, path: layer.path })}
                onClose={() => close(layer.id)}
                registerZoom={zoomDoorOf(layer.id)}
                active={!covered}
              />
            ) : (
              <ExploreNote
                path={layer.path}
                mode={layer.mode}
                gone={layer.gone ?? 0}
                title={nameOf(layer.path)}
                idInTitle={idsInTitle(layer.path)}
                vault={vaultOf(layer.path)}
                style={textVarsFor(layer.path)}
                onOpenLink={openPath}
                renderEditor={renderEditor}
                createFolder={createFolder}
                onFileAction={onFileAction}
                linkActions={linkActions}
                onNotice={onNotice}
                onToggleEdit={() => toggleEdit(layer.id)}
                editAsk={layer.editAsk}
                leaveAsk={layer.leaveAsk}
                card={layer.card}
                steps={steps}
                zoom={zoom}
                onZoom={setZoom}
                onHeadDown={(e) => gestures.onHeadDown(layer.id, e)}
                onHeadReset={(e) => gestures.reset(layer.id, e)}
                commentsOrder={commentsOrder}
                onChangeCommentsOrder={onChangeCommentsOrder}
                onOpenInTab={toTab}
                onHeadMenu={(x, y) => setMenu({ x, y, path: layer.path })}
                noteMenu={() => noteSections(layer.path)}
                onClose={() => close(layer.id)}
                active={!covered}
              />
            )}
            {GRIPS.map((grip) => (
              <span key={grip.name} className="explore__grip" data-grip={grip.name} onMouseDown={(e) => gestures.onGripDown(layer.id, grip, e)} />
            ))}
          </div>
        )
      })}
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} sections={noteSections(menu.path)} onClose={() => setMenu(null)} />}
    </div>
  )
}

/** For App: the stack opens with a vault; a path outside every vault of the window has no explore (a Welcome window). */
export const exploreVaultOf = (roots: readonly string[], path: string): string | null => rootOfPath(roots, path)
