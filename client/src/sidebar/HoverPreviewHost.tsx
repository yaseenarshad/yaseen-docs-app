/**
 * THE HOVER PREVIEW (Draw's YAZ-1800, ported by YAZ-3028 D11): a drawing or diagram row rested on
 * for the dwell opens a picture of the whole board beside the sidebar; a note row opens the top of
 * the note in the same box (YAZ-3075 D1); a code or text row the top of the file with its colours
 * (YAZ-3508, `code/CodeHoverPreview.tsx`). A PDF or image row never does (D6; `hasHoverPreview`). The row is
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
 * The panels themselves (`BoardPreview` with its picture cache, `NotePreview`, `CodeHoverPreview`, and their
 * CSS) load lazily, on the first dwell of their kind; a note's or a code file's chunk starts loading when its
 * dwell STARTS (a code file's is Monaco's, so a window that never rests on one never loads it).
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
import { hasHoverPreview, isCodeHover } from './hoverPreviewKinds'
import type { AnchorRect, PreviewAnchor, PreviewPopup } from './previewPlacement'

const BoardPreview = lazy(() => import('./BoardPreview'))
/**
 * The note panel's chunk (YAZ-3087 A1): a note's dwell starts this load, so the chunk arrives during
 * the wait, and the module is kept once it lands. The host then renders it DIRECTLY: `lazy` suspends
 * on its first render even with the chunk loaded, and React holds a suspended reveal up to 300 ms
 * (`FALLBACK_THROTTLE_MS`) — the whole of the slow first hover. `lazy` stays for a chunk still on its
 * way at the dwell's end.
 */
let notePreviewModule: typeof import('./NotePreview') | null = null
export const loadNotePreview = () => import('./NotePreview').then((module) => (notePreviewModule = module))
const LazyNotePreview = lazy(loadNotePreview)

/** A code file's card (YAZ-3508), the same way as the note's: its dwell starts the load of Monaco's chunk. */
let codeHoverModule: typeof import('../code/CodeHoverPreview') | null = null
export const loadCodeHoverPreview = () => import('../code/CodeHoverPreview').then((module) => (codeHoverModule = module))
const LazyCodeHoverPreview = lazy(loadCodeHoverPreview)

/** The panel's chunk of `path`'s kind starts loading with the dwell. A failed load is the lazy panel's to meet. */
export function preloadPreview(path: string): void {
  if (isMarkdown(path)) loadNotePreview().catch(() => undefined)
  else if (isCodeHover(path)) loadCodeHoverPreview().catch(() => undefined)
}

/** The row the pointer (or focus) rests on — pending until the dwell ends, then shown; `path` null = none. */
export interface HoverState {
  path: string | null
  shown: boolean
}

/** How long the pointer (or focus) rests on a board or note row before its preview opens (Draw's YAZ-1800; one wait for both, YAZ-3075 D3). */
export const HOVER_PREVIEW_DWELL_MS = 400

export function useHoverPreview(blocked: boolean, activeFile: string | null) {
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
      // A board, a note or a code file previews (YAZ-3075 D6, YAZ-3508); a PDF or an image row has none.
      if (node === null || blockedRef.current || !hasHoverPreview(node.path)) return
      const id = hoverRequest.current
      const { path } = node
      hover.set({ path, shown: false })
      preloadPreview(path)
      hoverTimer.current = setTimeout(() => {
        hoverTimer.current = null
        if (id === hoverRequest.current) hover.set({ shown: true })
      }, HOVER_PREVIEW_DWELL_MS)
    },
    [hover, closePreview],
  )
  // Everything else that ends a glance: a menu opening, a Space panel, the place's switch off, another file opening.
  useEffect(() => {
    if (blocked) closePreview()
  }, [blocked, closePreview])
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
  /** The place's switch is on (Settings › Preview on hover › Sidebar, or › Search results while the Search tab shows). */
  enabled: boolean
  diagramDarkColors: DiagramDarkColors
  /** The sidebar, which the panel sits beside. */
  anchor: RefObject<HTMLElement | null>
  /** A Files window's (YAZ-3357 D9): the floating popup the panel goes in, beside its row, or `'overlay'` where there is none. */
  float?: PreviewPopup | 'overlay'
  onClose: () => void
}

/**
 * The row of `path` a Files window's floating preview stands beside (YAZ-3357 D9): the one under the pointer, else the one
 * with the keyboard focus, else the first; with none on show, the middle of the sidebar. In this page's coordinates.
 */
function previewRowRect(aside: HTMLElement | null, path: string): AnchorRect {
  const rows = aside === null ? [] : [...aside.querySelectorAll<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)]
  const row = rows.find((el) => el.matches(':hover')) ?? rows.find((el) => el === document.activeElement) ?? rows[0]
  const rect = (row ?? aside)?.getBoundingClientRect()
  if (rect === undefined) return { left: 0, top: window.innerHeight / 2, right: 0, bottom: window.innerHeight / 2 }
  return row === undefined ? { left: rect.left, top: rect.top + rect.height / 2, right: rect.right, bottom: rect.top + rect.height / 2 } : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/** What a shown preview sits beside: the sidebar, or a Files window's popup or overlay (YAZ-3357 D9). One object per shown path. */
function useFloatAnchor(anchor: RefObject<HTMLElement | null>, float: PreviewPopup | 'overlay' | undefined, path: string | null): PreviewAnchor {
  return useMemo<PreviewAnchor>(() => {
    if (float === undefined || path === null) return anchor
    if (float === 'overlay') return { overlay: true }
    return { popup: float, rect: previewRowRect(anchor.current, path) }
  }, [anchor, float, path])
}

export function HoverPreviewHost({ hover, forest, rootOf, watchOf, wikilinksOf, nameOf, textVarsOf, enabled, diagramDarkColors, anchor, float, onClose }: HoverPreviewHostProps) {
  const { path, shown } = useSyncExternalStore(hover.subscribe, hover.getState)
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
  const placeBy = useFloatAnchor(anchor, float, visible ? node.path : null)
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
  if (!visible) return null
  return <PreviewPanel key={node.path} path={node.path} root={rootOf(node.path)} name={nameOf(node.path)} wikilinks={wikilinksOf(node.path)} textVars={textVarsOf(node.path)} knownMtime={node.mtime} watch={watchOf?.(node.path)} diagramDarkColors={diagramDarkColors} anchor={placeBy} />
}

export interface PreviewPanelProps {
  path: string
  /** The vault that holds the file: the header names its folder relative to it. */
  root: string
  /** A note's name as the app shows it (its title): the note panel's header. */
  name: string
  /** One quiet line under the header: how to open it (a note's link, YAZ-3935: "⌘-click to open"). Absent → none. */
  hint?: string
  wikilinks: WikilinkResolveSource
  textVars: CSSProperties
  /** The mtime the caller knows (the tree's); the board head's read can only make it newer. 0 = none. */
  knownMtime?: number
  /** The vault's watch feed (A41): a board saved while its panel shows is drawn again. */
  watch?: WatchSource
  diagramDarkColors: DiagramDarkColors
  anchor: PreviewAnchor
}

/**
 * ONE PREVIEW PANEL for a shown file (YAZ-3075, shared with the tab board by YAZ-3343): a note's top, or a board's
 * picture, the kind by its path; anything else shows nothing. The caller decides WHEN (a dwell, Space on the board)
 * and mounts it `key={path}`. A board reads its head once on open and follows the watch feed (see the module doc).
 */
export function PreviewPanel({ path, root, name, hint, wikilinks, textVars, knownMtime = 0, watch, diagramDarkColors, anchor }: PreviewPanelProps) {
  const theme = useAppliedTheme()
  // The board's mtime as its file says now (see the module doc); the tree's until the read answers.
  // A note has no head and no watch (C27): only a BOARD gets a `boardPath`.
  const [head, setHead] = useState<{ path: string; mtime: number } | null>(null)
  const boardPath = isBoard(path) ? path : null
  useEffect(() => {
    if (boardPath === null) return
    let live = true
    void api.boardHead(boardPath).then(
      (res) => {
        if (live) setHead({ path: boardPath, mtime: res.mtime })
      },
      // YAZ-3044 A6: the panel still opens on the tree's mtime (0 never beats it), and the
      // picture's own read then shows why it cannot be drawn ("Preview unavailable").
      () => {
        if (live) setHead({ path: boardPath, mtime: 0 })
      },
    )
    // A41: a write while the panel shows moves the key; the event's mtime is the file's own.
    const off = watch?.subscribe((ev) => {
      if (live && ev.type === 'change' && ev.path === boardPath) setHead({ path: boardPath, mtime: ev.mtime })
    })
    return () => {
      live = false
      off?.()
    }
  }, [boardPath, watch])
  const node = useMemo(() => ({ path }), [path])
  if (isCodeHover(path)) {
    const CodeHoverPreview = codeHoverModule?.default ?? LazyCodeHoverPreview
    return (
      <Suspense fallback={null}>
        <CodeHoverPreview root={root} path={path} name={name} anchor={anchor} />
      </Suspense>
    )
  }
  if (isMarkdown(path)) {
    const NotePreview = notePreviewModule?.default ?? LazyNotePreview
    return (
      <Suspense fallback={null}>
        <NotePreview root={root} node={node} name={name} hint={hint} wikilinks={wikilinks} textVars={textVars} anchor={anchor} />
      </Suspense>
    )
  }
  if (boardPath === null || head === null || head.path !== path) return null
  const mtime = Math.max(knownMtime, head.mtime)
  return (
    <Suspense fallback={null}>
      <BoardPreview root={root} node={node} hint={hint} cacheKey={boardPreviewKey(root, { path, mtime }, theme, diagramDarkColors)} anchor={anchor} />
    </Suspense>
  )
}

/**
 * Space on a row of a Files window (YAZ-3357 D9): the same panel as the hover's, in the floating popup beside the row
 * (or over the window's lower part where there is no popup), instead of the search's panel over a page the window does not have.
 */
export function FloatingPreview({ aside, float, ...panel }: Omit<PreviewPanelProps, 'anchor'> & { aside: RefObject<HTMLElement | null>; float: PreviewPopup | 'overlay' }) {
  const anchor = useFloatAnchor(aside, float, panel.path)
  return <PreviewPanel {...panel} anchor={anchor} />
}
