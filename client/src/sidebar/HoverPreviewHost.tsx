/**
 * THE HOVER PREVIEW (Draw's YAZ-1800, ported by YAZ-3028 D11): a drawing or diagram row rested on
 * for the dwell opens a picture of the whole board beside the sidebar. A note row never does. The
 * row is pending until the dwell ends, then shown; only the row leaving the tree closes it. Every
 * close bumps `hoverRequest`, so an earlier row's dwell never fires late.
 *
 * Isolated (Draw's YAZ-2073 5D): the row lives in a tiny store the Sidebar writes and only the panel
 * reads, so a pointer crossing rows re-renders the panel and nothing else — never the Sidebar or the
 * Tree. The Sidebar's half, `useHoverPreview`, lives here beside the panel it feeds.
 *
 * THE PICTURE'S KEY IS READ AT THE DWELL'S END (YAZ-3028): Docs reads the tree again only on a
 * structural change, never on a save (a note saves every 500 ms), so a board's tree `mtime` can be
 * old. So the panel asks `fs:board-head` for the board's mtime when it opens — one small read — and
 * a board saved since its last picture is drawn again. The panel adds no watcher subscription of its own.
 *
 * The panel itself (`BoardPreview`, its picture cache and its CSS) loads lazily, on the first dwell.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { isBoard } from '@shared/fileKind'
import type { DiagramDarkColors, TreeNode } from '@shared/types'
import { api } from '../api'
import { createStore, type Store } from '../lib/store'
import { useAppliedTheme } from '../lib/theme'
import { findNode } from '../lib/treeState'
import { boardPreviewKey } from './boardPreviewKey'

const BoardPreview = lazy(() => import('./BoardPreview'))

/** The row the pointer (or focus) rests on — pending until the dwell ends, then shown; `path` null = none. */
export interface HoverState {
  path: string | null
  shown: boolean
}

/** How long the pointer (or focus) rests on a board row before its preview opens (Draw's YAZ-1800). */
export const BOARD_PREVIEW_DWELL_MS = 400

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
      // A note, a text file or an image row has no board picture (YAZ-3028 D11).
      if (node === null || blockedRef.current || !isBoard(node.path)) return
      const id = hoverRequest.current
      const { path } = node
      hover.set({ path, shown: false })
      hoverTimer.current = setTimeout(() => {
        hoverTimer.current = null
        if (id === hoverRequest.current) hover.set({ shown: true })
      }, BOARD_PREVIEW_DWELL_MS)
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
  /** Previews possible (no search typed, no menu up). */
  enabled: boolean
  diagramDarkColors: DiagramDarkColors
  /** The sidebar, which the panel sits beside. */
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
}

export function HoverPreviewHost({ hover, forest, rootOf, enabled, diagramDarkColors, anchor, onClose }: HoverPreviewHostProps) {
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
  const [head, setHead] = useState<{ path: string; mtime: number } | null>(null)
  const shownPath = visible ? node.path : null
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
    return () => {
      live = false
    }
  }, [shownPath])
  if (!visible || head === null || head.path !== node.path) return null
  const root = rootOf(node.path)
  const mtime = Math.max(node.mtime, head.mtime)
  return (
    <Suspense fallback={null}>
      <BoardPreview key={node.path} root={root} node={node} cacheKey={boardPreviewKey(root, { path: node.path, mtime }, theme, diagramDarkColors)} anchor={anchor} />
    </Suspense>
  )
}
