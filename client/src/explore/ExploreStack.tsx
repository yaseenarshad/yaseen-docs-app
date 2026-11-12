/**
 * THE EXPLORE STACK (YAZ-2571): ⌘⇧F opens a search panel in the middle of the window; Enter opens the note ON TOP
 * of the search, for reading; ⌘⇧F again adds a search on top of that; a link in a note adds that note on top; Esc
 * removes ONE layer, the top one. Every layer stays mounted while it is covered, so each keeps its own scroll
 * place exactly: the defining requirement (no jump, no flash of the top). The workspace under the stack never moves.
 *
 * One stack per window, in its own chunk (App lazy-loads it on the first ⌘⇧F). The list of layers is state
 * (`layers.ts`); the DOM keeps each layer's scroll. The rows of every search layer come from ONE candidate
 * feed (`useSearchCandidates`): a nested search adds no index read. The keys are read on the stack's root: Esc,
 * E (read → edit), ⌘↵ (the top note in a tab, the stack closes), and ‹ › (round 3: a note opened from a search
 * steps through that search's rows in place, ← / → while reading, ⌘⌥↑ / ⌘⌥↓ in any mode; `shared/keys/explore.ts`).
 * A menu, a picker or a pop-up that takes Esc keeps it (the mini window's rule, YAZ-4547). At most 12 layers; a
 * 13th says so and opens nothing. Each layer moves like a cell note (round 3, `layerBoxes.ts`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { rootOfPath, type CommentsOrder } from '@shared/types'
import type { LinkActions } from '../editor/linkMenu'
import { isNoteKey } from '../editor/noteKeys'
import { focusOpenDocument } from '../lib/focusHandoff'
import { flushRenamedPath } from '../lib/renameContinuity'
import { storage } from '../lib/storage'
import type { SearchCandidate } from '../search/searchCandidates'
import { useSearchCandidates, type SearchVault } from '../search/useSearchResults'
import { ContextMenu } from '../sidebar/ContextMenu'
import { inPlace } from '../vault/placeScope'
import { ExploreNote, type ExploreVault } from './ExploreNote'
import { exploreNoteSections } from './exploreMenu'
import { exploreRecents, onExploreMove, rememberExploreRecent } from './exploreRecents'
import { ExploreSearch, type SearchLink } from './ExploreSearch'
import { textCandidates } from './exploreRows'
import { GRIPS, useLayerBoxes } from './layerBoxes'
import { MAX_LAYERS, NOTE_MS, newLayerId, pushLayer, SEARCH_MS, stepPlace, stepResult, topNote, type ExploreLayer } from './layers'
import './explore.css'

export interface ExploreStackProps {
  /** Bumped by each ⌘⇧F while the stack shows: one more search layer on top. */
  request: number
  /** With the ask: a note to open as a reading layer instead of a search ("Open in Explore", YAZ-4936). */
  requestNote?: string | null
  /** The window's vaults for the search: root, watcher, folders; no other files (the stack reads notes). */
  vaults: readonly SearchVault[]
  vaultOf: (path: string) => ExploreVault
  nameOf: (path: string) => string
  textVarsFor: (path: string) => CSSProperties
  renderEditor: (path: string, openLink: (path: string) => void) => ReactNode
  createFolder: (sourcePath: string) => string
  linkActions?: LinkActions
  /** A note in a normal tab (⌘↵, ↗), a folder's page or another file (a drawing, a PDF): the stack closes. */
  openInTab: (path: string) => void
  onNotice: (message: string) => void
  /** The tab menu's "Rename file" (App's `renameInSidebar`): the note menu's row (round 1, items 6 and 7). */
  onRenameFile?: (path: string) => void
  /** The comment stream's order and its toggle (YAZ-1515): a note layer shows the stream as its tab does (round 1, item 3). */
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
  /** The last Esc, ⌘↵ and the click outside: App unmounts the stack and the keyboard goes back where it was. */
  onClose: () => void
}

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

export function ExploreStack({ request, requestNote = null, vaults, vaultOf, nameOf, textVarsFor, renderEditor, createFolder, linkActions, openInTab, onNotice, onRenameFile, commentsOrder, onChangeCommentsOrder, onClose }: ExploreStackProps) {
  const [layers, setLayers] = useState<readonly ExploreLayer[]>([])
  const layersRef = useRef(layers)
  layersRef.current = layers
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
  /** Each search layer's rows (round 3), by layer id: what the note over it steps through. Dropped with the layer. */
  const links = useRef(new Map<number, SearchLink>())
  const linkOf = (id: number): SearchLink => {
    let link = links.current.get(id)
    if (link === undefined) {
      link = { rows: [] }
      links.current.set(id, link)
    }
    return link
  }
  useEffect(() => {
    const ids = new Set(layers.map((l) => l.id))
    for (const id of [...links.current.keys()]) if (!ids.has(id)) links.current.delete(id)
  }, [layers])
  // One feed for every search layer; the text rows (tags, frontmatter values) ride with the records.
  const candidates = useSearchCandidates(vaults, true, textCandidates)
  const roots = useMemo(() => vaults.map((v) => v.root), [vaults])
  /** The vault's "Show IDs in search" for a row (YAZ-4940); a path in no vault reads Always. */
  const idsInTitle = useCallback((path: string) => vaults[roots.indexOf(rootOfPath(roots, path) ?? '')]?.idsInTitle?.() ?? true, [vaults, roots])
  const idsInSearch = useCallback((path: string) => vaults[roots.indexOf(rootOfPath(roots, path) ?? '')]?.idsInSearch?.() ?? 'always', [vaults, roots])
  // A folder of a vault (YAZ-4922 🔒 D3): the empty search's recents are the notes under the folder only (`inPlace`).
  const recentAll = exploreRecents()
  const recent = useMemo(() => recentAll.filter((path) => inPlace(vaults[roots.indexOf(rootOfPath(roots, path) ?? '')]?.folder, path)), [recentAll, vaults, roots])

  const doors = useRef({ onNotice, onClose, openInTab, onRenameFile, linkActions })
  doors.current = { onNotice, onClose, openInTab, onRenameFile, linkActions }
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

  const push = useCallback((layer: ExploreLayer): boolean => {
    let pushed = false
    setLayers((prev) => {
      const next = pushLayer(prev, layer)
      if (next === null) return prev
      pushed = true
      return next
    })
    if (!pushed) doors.current.onNotice(FULL_NOTICE)
    return pushed
  }, [])

  // A note of a layer renamed elsewhere (App's `file:renamed`) moves the layer to the new path: its title, chip and
  // read follow, and an editor mounts there (as the mini window's does). Deleted: the layer reads again and says so.
  useEffect(
    () =>
      onExploreMove((from, to) => {
        const at = (path: string) => path === from || path.startsWith(`${from}/`)
        setLayers((prev) =>
          prev.map((l) => {
            if (l.kind !== 'note' || !at(l.path)) return l
            return to === null ? { ...l, mode: 'read', gone: (l.gone ?? 0) + 1 } : { ...l, path: to + l.path.slice(from.length) }
          }),
        )
      }),
    [],
  )

  // Each ⌘⇧F: a search layer on top (the first one opens the stack).
  const served = useRef(0)
  useEffect(() => {
    if (request === served.current) return
    served.current = request
    if (requestNote === null) push({ id: newLayerId(), kind: 'search' })
    else if (push({ id: newLayerId(), kind: 'note', path: requestNote, mode: 'read' })) rememberExploreRecent(requestNote)
  }, [request, requestNote, push])

  /** A note goes on top for reading; a folder or another file opens in a tab and the stack closes. */
  const openPath = useCallback(
    (path: string) => {
      if (fileKind(path) !== 'markdown') {
        doors.current.openInTab(path)
        doors.current.onClose()
        return
      }
      if (push({ id: newLayerId(), kind: 'note', path, mode: 'read' })) rememberExploreRecent(path)
    },
    [push],
  )
  /** A row of search layer `search` at `at` (round 3): the note layer remembers them, so ‹ › step through that search. */
  const openRow = useCallback(
    (search: number, row: SearchCandidate, at: number) => {
      if (fileKind(row.path) !== 'markdown') return openPath(row.path)
      if (push({ id: newLayerId(), kind: 'note', path: row.path, mode: 'read', from: { search, at } })) rememberExploreRecent(row.path)
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
    if (layer === undefined || layer.kind !== 'note' || layer.from === undefined) return false
    const search = layer.from.search
    const to = stepResult(links.current.get(search)?.rows ?? [], layer.from.at, layer.path, dir)
    if (to === null) return false
    if (layer.mode === 'edit') void flushRenamedPath(layer.path)
    setLayers((prev) => prev.map((l) => (l.id === id && l.kind === 'note' ? { ...l, path: to.path, from: { search, at: to.at } } : l)))
    rememberExploreRecent(to.path)
    return true
  }, [])

  /** The top layer leaves: the exit motion, then it is gone; the last one closes the stack. */
  const pop = useCallback(() => {
    const live = layers.filter((l) => !leaving.has(l.id))
    const top = live[live.length - 1]
    if (top === undefined) return
    if (top.kind === 'note' && top.mode === 'edit') void flushRenamedPath(top.path)
    if (live.length === 1) {
      doors.current.onClose()
      return
    }
    const ms = reducedMotion() ? 0 : top.kind === 'search' ? SEARCH_MS : NOTE_MS
    const remove = () => {
      setLayers((prev) => prev.filter((l) => l.id !== top.id))
      setLeaving((prev) => {
        const next = new Set(prev)
        next.delete(top.id)
        return next
      })
    }
    if (ms === 0) return remove()
    setLeaving((prev) => new Set(prev).add(top.id))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      remove()
    }, ms)
    timers.current.add(timer)
  }, [layers, leaving])

  const live = useMemo(() => layers.filter((l) => !leaving.has(l.id)), [layers, leaving])
  const top = live[live.length - 1]

  /** The trail's click (YAZ-4925): back to `id`; the layers above it close at once, a note in edit among them saved first. */
  const backTo = useCallback(
    (id: number) => {
      const at = layersRef.current.findIndex((l) => l.id === id)
      if (at === -1 || at === layersRef.current.length - 1) return
      for (const l of layersRef.current.slice(at + 1)) if (l.kind === 'note' && l.mode === 'edit') void flushRenamedPath(l.path)
      setLayers((prev) => prev.slice(0, prev.findIndex((l) => l.id === id) + 1))
    },
    [],
  )

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

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (top === undefined) return
    // A key inside an IME composition (Japanese input; keyCode 229 on some keyboards) is the composition's: Esc cancels it, nothing else.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-layer="${top.id}"]`) ?? null
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
      if (top.kind === 'note' && top.mode === 'edit') toggleEdit(top.id)
      else pop()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey) {
      if (topNote(live) === null) return
      event.preventDefault()
      event.stopPropagation()
      toTab()
      return
    }
    // ‹ › (round 3): a bare key (← / →) is the caret's while a field or the editor has the keyboard, so it steps only
    // while reading; a chord (⌘⌥↓ / ⌘⌥↑) steps in any mode. A key the editor took (a cell note's own step) is left.
    if (top.kind === 'note' && top.from !== undefined && !event.defaultPrevented) {
      const overrides = storage.getSettings()?.hotkeys
      const dir = isNoteKey(event, 'explore.nextResult', overrides) ? 1 : isNoteKey(event, 'explore.previousResult', overrides) ? -1 : 0
      if (dir !== 0) {
        const bare = !event.metaKey && !event.ctrlKey && !event.altKey
        if (bare && (top.mode === 'edit' || inField(event.target))) return
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
      toggleEdit(top.id)
    }
  }

  // A click on the dim outside every layer: the top layer closes, as Esc does.
  const onBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    pop()
  }

  return (
    <div ref={rootRef} className="explore" role="dialog" aria-modal="true" aria-label="Explore the vault" onKeyDown={onKeyDown} onMouseDown={onBackdropMouseDown}>
      {/* The trail (YAZ-4925): one chip per layer from two layers on, the top one bold; a click goes back to that layer. */}
      {live.length > 1 && (
        <nav className="explore__trail" aria-label="Layers">
          {live.map((layer, i) => (
            <span key={layer.id} className="explore__trail-step">
              {i > 0 && <span className="explore__trail-sep">›</span>}
              <button type="button" className={`explore__chip${layer === top ? ' explore__chip--top' : ''}`} aria-current={layer === top ? 'true' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => backTo(layer.id)}>
                {layer.kind === 'search' ? 'Search' : nameOf(layer.path)}
              </button>
            </span>
          ))}
        </nav>
      )}
      {layers.map((layer, index) => {
        const covered = layer !== top
        const out = leaving.has(layer.id)
        // The place and size come from `useLayerBoxes`, written to the style; only the motion's length is rendered.
        const style = { '--explore-ms': `${layer.kind === 'search' ? SEARCH_MS : NOTE_MS}ms` } as CSSProperties
        /** A search layer: the note over it that came from it, whose row stays marked (round 3). */
        const above = layers[index + 1]
        const marked = layer.kind === 'search' && above !== undefined && above.kind === 'note' && above.from?.search === layer.id ? { path: above.path, at: above.from.at } : null
        /** A note layer from a search: its place among that search's rows, and whether a step each way exists. */
        const rows = layer.kind === 'note' && layer.from !== undefined ? (links.current.get(layer.from.search)?.rows ?? []) : null
        const steps =
          layer.kind === 'note' && layer.from !== undefined && rows !== null
            ? { place: stepPlace(rows, layer.from.at, layer.path), count: rows.length, prev: stepResult(rows, layer.from.at, layer.path, -1) !== null, next: stepResult(rows, layer.from.at, layer.path, 1) !== null, onStep: (dir: -1 | 1) => void step(layer.id, dir) }
            : undefined
        return (
          <div
            key={layer.id}
            data-layer={layer.id}
            data-kind={layer.kind}
            className={`explore__layer explore__layer--${layer.kind}${covered ? ' explore__layer--covered' : ''}${out ? ' explore__layer--out' : ' explore__layer--in'}`}
            style={style}
            // A covered layer stays on screen, at its scroll, and takes no click and no key.
            inert={covered}
            aria-hidden={covered}
          >
            {layer.kind === 'search' ? (
              <>
                {/* The search moves by its top edge (round 3): the input keeps its text selection. */}
                <div className="explore__grab" title="Drag to move; double-click to put back" onMouseDown={(e) => gestures.onHeadDown(layer.id, e)} onDoubleClick={(e) => gestures.reset(layer.id, e)} />
                <ExploreSearch candidates={candidates} link={linkOf(layer.id)} markedRow={marked} recent={recent} roots={roots} nameOf={nameOf} onOpen={(row, at) => openRow(layer.id, row, at)} onRowMenu={(row, x, y) => setMenu({ x, y, path: row.path })} idsInSearch={idsInSearch} active={!covered} />
              </>
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
                linkActions={linkActions}
                onNotice={onNotice}
                onToggleEdit={() => toggleEdit(layer.id)}
                steps={steps}
                onHeadDown={(e) => gestures.onHeadDown(layer.id, e)}
                onHeadReset={(e) => gestures.reset(layer.id, e)}
                commentsOrder={commentsOrder}
                onChangeCommentsOrder={onChangeCommentsOrder}
                onOpenInTab={toTab}
                onHeadMenu={(x, y) => setMenu({ x, y, path: layer.path })}
                noteMenu={() => noteSections(layer.path)}
                onClose={pop}
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
