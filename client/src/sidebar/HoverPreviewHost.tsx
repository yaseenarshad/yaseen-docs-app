/**
 * THE HOVER PREVIEW (Draw's YAZ-1800, ported by YAZ-3028 D11): a drawing or diagram row rested on
 * for the dwell opens a picture of the whole board beside the sidebar; a note row opens the top of
 * the note in the same box (YAZ-3075 D1). A text, PDF or image row never does (D6). The row is
 * pending until the dwell ends, then shown; only the row leaving the tree closes it. Every close
 * bumps `hoverRequest`, so an earlier row's dwell never fires late.
 *
 * Isolated (Draw's YAZ-2073 5D): the row lives in a tiny store the Sidebar writes and only the panel
 * reads, so a pointer crossing rows re-renders the panel and nothing else — never the Sidebar or the
 * Tree. The Sidebar's half, `useHoverPreview`, lives here beside the panel it feeds.
 *
 * THE PICTURE'S KEY IS READ AT THE DWELL'S END (YAZ-3028): Docs reads the tree again only on a
 * structural change, never on a save (a note saves every 500 ms), so a board's tree `mtime` can be
 * old. So the panel asks `fs:board-head` for the board's mtime when it opens — one small read — and
 * a board saved since its last picture is drawn again. While it shows, it listens on the vault's
 * watch feed (YAZ-3044 A41): a `change` of that board — a save, a sync pull, another window's
 * write — takes the event's mtime, and the picture is drawn again.
 *
 * A NOTE needs neither (YAZ-3075 D1, C26, C27): `NotePreview` reads the note itself on each open,
 * and a save while it shows does not draw it again — so no head read and no watch subscription.
 *
 * The panels themselves (`BoardPreview` with its picture cache, `NotePreview`, and their CSS) load
 * lazily, on the first dwell of their kind; a note's chunk starts loading when its dwell STARTS.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react'
import { isBoard, isMarkdown } from '@shared/fileKind'
import type { DiagramDarkColors, TreeNode } from '@shared/types'
import { api } from '../api'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { createStore, type Store } from '../lib/store'
import { useAppliedTheme } from '../lib/theme'
import { findNode } from '../lib/treeState'
import { boardPreviewKey } from './boardPreviewKey'

const BoardPreview = lazy(() => import('./BoardPreview'))
/**
 * The note panel's chunk (YAZ-3087 A1): a note's dwell starts this load, so the chunk arrives during
 * the wait, and the module is kept once it lands. The host then renders it DIRECTLY: `lazy` suspends
 * on its first render even with the chunk loaded, and React holds a suspended reveal up to 300 ms
 * (`FALLBACK_THROTTLE_MS`) — the whole of the slow first hover. `lazy` stays for a chunk still on its
 * way at the dwell's end.
 */
let notePreviewModule: typeof import('./NotePreview') | null = null
const loadNotePreview = () => import('./NotePreview').then((module) => (notePreviewModule = module))
const LazyNotePreview = lazy(loadNotePreview)

/** The row the pointer (or focus) rests on — pending until the dwell ends, then shown; `path` null = none. */
export interface HoverState {
  path: string | null
  shown: boolean
}

/** How long the pointer (or focus) rests on a board or note row before its preview opens (Draw's YAZ-1800; one wait for both, YAZ-3075 D3). */
export const HOVER_PREVIEW_DWELL_MS = 400

export function useHoverPreview(blocked: boolean, enabled: boolean, activeFile: string | null) {
  const [hover] = useState(() => createStore<HoverState>({ path: null, shown: false }))
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverRequest = useRef(0)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const closePreview = useCallback(() => {
    hoverRequest.current++
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    hover.set({ path: null, shown: false })
  }, [hover])
  const hoverFile = useCallback(
    (node: { path: string } | null) => {
      // The same row again (focus after the pointer, or back) keeps its dwell or its panel.
      if (node !== null && hover.getState().path === node.path) return
      closePreview()
      // A board or a note previews (YAZ-3075 D6); a text file, a PDF or an image row has no preview.
      if (node === null || blockedRef.current || !(isBoard(node.path) || isMarkdown(node.path))) return
      const id = hoverRequest.current
      const { path } = node
      hover.set({ path, shown: false })
      // A failed load is the lazy panel's to meet when it renders; here it would be an unhandled rejection.
      if (isMarkdown(path)) loadNotePreview().catch(() => undefined)
      hoverTimer.current = setTimeout(() => {
        hoverTimer.current = null
        if (id === hoverRequest.current) hover.set({ shown: true })
      }, HOVER_PREVIEW_DWELL_MS)
    },
    [hover, closePreview],
  )
  // Everything else that ends a glance: a search, a menu opening, another file opening.
  useEffect(() => {
    if (!enabled || blocked) closePreview()
  }, [enabled, blocked, closePreview])
  useEffect(() => closePreview(), [activeFile, closePreview])
  useEffect(() => closePreview, [closePreview]) // unmount: no dwell timer outlives the sidebar

  return { hover, hoverFile, closePreview }
}

interface HoverPreviewHostProps {
  hover: Store<HoverState>
  /** Every vault's tree of the window: the hovered board is resolved off it, and gone closes the panel. */
  forest: readonly TreeNode[] | null
  /** The vault root that holds a path (the panel names the board's folder relative to it). */
  rootOf: (path: string) => string
  /** The watch feed of the vault that holds a path (A41); undefined when there is none. */
  watchOf?: (path: string) => WatchSource | undefined
  /** The link source of the vault that holds a note (YAZ-3075 C21). */
  wikilinksOf: (path: string) => WikilinkResolveSource
  /** A note's name as the tree shows it, its title (`pageName`): the note panel's header. */
  nameOf: (path: string) => string
  /** The text formatting of the vault that holds a note (YAZ-3067 D12; YAZ-3075 C20). */
  textVarsOf: (path: string) => CSSProperties
  /** Previews possible (no search typed, no menu up). */
  enabled: boolean
  diagramDarkColors: DiagramDarkColors
  /** The sidebar, which the panel sits beside. */
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
}

export function HoverPreviewHost({ hover, forest, rootOf, watchOf, wikilinksOf, nameOf, textVarsOf, enabled, diagramDarkColors, anchor, onClose }: HoverPreviewHostProps) {
  const { path, shown } = useSyncExternalStore(hover.subscribe, hover.getState)
  const theme = useAppliedTheme()
  const node = useMemo(() => {
    if (path === null || forest === null) return null
    const n = findNode(forest, path)
    return n !== null && n.type === 'file' ? n : null
  }, [path, forest])
  useEffect(() => {
    if (path !== null && forest !== null && node === null) onClose()
  }, [path, forest, node, onClose])
  // Escape closes the preview — and ONLY while one shows, so the key is otherwise untouched for the
  // selection, the menus and the canvas. Capture phase, so it wins before the body's own Escape.
  const visible = shown && node !== null && enabled
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [visible, onClose])
  // The board's mtime as its file says now (see the module doc); the tree's until the read answers.
  // A note has no head and no watch (C27): only a shown BOARD gets a `shownPath`.
  const [head, setHead] = useState<{ path: string; mtime: number } | null>(null)
  const shownPath = visible && isBoard(node.path) ? node.path : null
  useEffect(() => {
    if (shownPath === null) return
    let live = true
    void api.boardHead(shownPath).then(
      (res) => {
        if (live) setHead({ path: shownPath, mtime: res.mtime })
      },
      // YAZ-3044 A6: the panel still opens on the tree's mtime (0 never beats it), and the
      // picture's own read then shows why it cannot be drawn ("Preview unavailable").
      () => {
        if (live) setHead({ path: shownPath, mtime: 0 })
      },
    )
    // A41: a write while the panel shows moves the key; the event's mtime is the file's own.
    const off = watchOf?.(shownPath)?.subscribe((ev) => {
      if (live && ev.type === 'change' && ev.path === shownPath) setHead({ path: shownPath, mtime: ev.mtime })
    })
    return () => {
      live = false
      off?.()
    }
  }, [shownPath, watchOf])
  if (!visible) return null
  const root = rootOf(node.path)
  if (isMarkdown(node.path)) {
    const NotePreview = notePreviewModule?.default ?? LazyNotePreview
    return (
      <Suspense fallback={null}>
        <NotePreview key={node.path} root={root} node={node} name={nameOf(node.path)} wikilinks={wikilinksOf(node.path)} textVars={textVarsOf(node.path)} anchor={anchor} />
      </Suspense>
    )
  }
  if (head === null || head.path !== node.path) return null
  const mtime = Math.max(node.mtime, head.mtime)
  return (
    <Suspense fallback={null}>
      <BoardPreview key={node.path} root={root} node={node} cacheKey={boardPreviewKey(root, { path: node.path, mtime }, theme, diagramDarkColors)} anchor={anchor} />
    </Suspense>
  )
}
