/**
 * THE EXPLORE STACK (YAZ-2571): ⌘⇧F opens a search panel in the middle of the window; Enter opens the note ON TOP
 * of the search, for reading; ⌘⇧F again adds a search on top of that; a link in a note adds that note on top; Esc
 * removes ONE layer, the top one. Every layer stays mounted while it is covered, so each keeps its own scroll
 * place exactly: the defining requirement (no jump, no flash of the top). The workspace under the stack never moves.
 *
 * One stack per window, in its own chunk (App lazy-loads it on the first ⌘⇧F). The list of layers is state
 * (`layers.ts`); the DOM keeps each layer's scroll. The rows of every search layer come from ONE candidate
 * feed (`useSearchCandidates`): a nested search adds no index read. The keys are read on the stack's root: Esc,
 * E (read → edit), ⌘↵ (the top note in a tab, the stack closes). A menu, a picker or a pop-up that takes Esc keeps
 * it (the mini window's rule, YAZ-4547). At most 12 layers; a 13th says so and opens nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { rootOfPath } from '@shared/types'
import type { LinkActions } from '../editor/linkMenu'
import { focusOpenDocument } from '../lib/focusHandoff'
import type { SearchCandidate } from '../search/searchCandidates'
import { useSearchCandidates, type SearchVault } from '../search/useSearchResults'
import { ExploreNote, type ExploreVault } from './ExploreNote'
import { exploreRecents, rememberExploreRecent } from './exploreRecents'
import { ExploreSearch } from './ExploreSearch'
import { textCandidates } from './exploreRows'
import { layerPlace, MAX_LAYERS, NOTE_MS, newLayerId, pushLayer, SEARCH_MS, topNote, type ExploreLayer } from './layers'
import './explore.css'

export interface ExploreStackProps {
  /** Bumped by each ⌘⇧F while the stack shows: one more search layer on top. */
  request: number
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
  /** The last Esc, ⌘↵ and the click outside: App unmounts the stack and the keyboard goes back where it was. */
  onClose: () => void
}

/** The notice of a 13th layer. */
export const FULL_NOTICE = `The explore stack holds ${MAX_LAYERS} layers. Close some first (Esc).`

/** The window's width, for the offsets: read on mount and on each resize, never per render. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** A key typed into a field, an editor or a menu belongs to it, never to the stack's letters. */
const inField = (target: EventTarget | null): boolean => target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]') !== null

export function ExploreStack({ request, vaults, vaultOf, nameOf, textVarsFor, renderEditor, createFolder, linkActions, openInTab, onNotice, onClose }: ExploreStackProps) {
  const [layers, setLayers] = useState<readonly ExploreLayer[]>([])
  /** The layers on their way out (the exit motion), by id: still drawn, no keys, gone after the motion. */
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const windowWidth = useWindowWidth()
  // One feed for every search layer; the text rows (tags, frontmatter values) ride with the records.
  const candidates = useSearchCandidates(vaults, true, textCandidates)
  const roots = useMemo(() => vaults.map((v) => v.root), [vaults])

  const doors = useRef({ onNotice, onClose, openInTab })
  doors.current = { onNotice, onClose, openInTab }

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

  // Each ⌘⇧F: a search layer on top (the first one opens the stack).
  const served = useRef(0)
  useEffect(() => {
    if (request === served.current) return
    served.current = request
    push({ id: newLayerId(), kind: 'search' })
  }, [request, push])

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
  const openRow = useCallback((row: SearchCandidate) => openPath(row.path), [openPath])

  /** The top layer leaves: the exit motion, then it is gone; the last one closes the stack. */
  const pop = useCallback(() => {
    const live = layers.filter((l) => !leaving.has(l.id))
    const top = live[live.length - 1]
    if (top === undefined) return
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

  const edit = useCallback((id: number) => setLayers((prev) => prev.map((l) => (l.id === id && l.kind === 'note' ? { ...l, mode: 'edit' } : l))), [])

  const toTab = useCallback(() => {
    const note = topNote(live)
    if (note === null) return
    doors.current.openInTab(note.path)
    doors.current.onClose()
  }, [live])

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
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-layer="${top.id}"]`) ?? null
    if (event.key === 'Escape') {
      // A pop-up of the editor (the `[[` picker, a menu) took this Esc while the caret stays in the layer: it closed
      // the pop-up, nothing more. The editor's own Esc (to the sidebar) moves the focus out: the layer closes then.
      if (event.defaultPrevented && el !== null && el.contains(document.activeElement)) return
      event.preventDefault()
      event.stopPropagation()
      pop()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey) {
      if (topNote(live) === null) return
      event.preventDefault()
      event.stopPropagation()
      toTab()
      return
    }
    if ((event.key === 'e' || event.key === 'E') && !event.metaKey && !event.ctrlKey && !event.altKey && top.kind === 'note' && top.mode === 'read' && !inField(event.target)) {
      event.preventDefault()
      edit(top.id)
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
      {layers.map((layer, index) => {
        const place = layerPlace(layer.kind, index, windowWidth)
        const covered = layer !== top
        const out = leaving.has(layer.id)
        const style = { left: place.left, top: `calc(10vh + ${place.top}px)`, width: place.width, '--explore-ms': `${layer.kind === 'search' ? SEARCH_MS : NOTE_MS}ms` } as CSSProperties
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
              <ExploreSearch candidates={candidates} recent={exploreRecents()} roots={roots} nameOf={nameOf} onOpen={openRow} active={!covered} />
            ) : (
              <ExploreNote
                path={layer.path}
                mode={layer.mode}
                title={nameOf(layer.path)}
                vault={vaultOf(layer.path)}
                style={textVarsFor(layer.path)}
                onOpenLink={openPath}
                renderEditor={renderEditor}
                createFolder={createFolder}
                linkActions={linkActions}
                onNotice={onNotice}
                onEdit={() => edit(layer.id)}
                onOpenInTab={toTab}
                onClose={pop}
                active={!covered}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** For App: the stack opens with a vault; a path outside every vault of the window has no explore (a Welcome window). */
export const exploreVaultOf = (roots: readonly string[], path: string): string | null => rootOfPath(roots, path)
