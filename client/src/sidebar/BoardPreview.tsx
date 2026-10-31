/**
 * THE HOVER PREVIEW PANEL (Draw's YAZ-1800, ported by YAZ-3028 D11): a big picture of the whole board, beside the sidebar, while
 * the mouse rests on its row. Portalled to `<body>` and `pointer-events: none` — it is a glance,
 * never a surface: nothing in it can be clicked, and it never steals the hover from the row.
 *
 * The Sidebar decides WHEN (the dwell and every close); this decides WHAT, and `previewPlacement`
 * WHERE. A note's panel (`NotePreview`, YAZ-3075 D2) takes the same box, in its taller `'note'` shape.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { basename, boardFolder } from '../lib/paths'
import { boardPreviews } from './boardPreviewCache'
import { portalTarget, usePlacement, type PreviewAnchor } from './previewPlacement'
import './boardPreview.css'

interface BoardPreviewProps {
  root: string
  /** The hovered board: the panel names it as the tree does, with its extension. */
  node: { path: string }
  /** `boardPreviewKey(root, node, theme, darkColors)` — a new key (a save, a theme flip) swaps the picture in place. */
  cacheKey: string
  /** One quiet line under the header: how to open the board (a link's card, YAZ-3935). Absent → none. */
  hint?: string
  /** What the panel sits beside: the `<aside className="sidebar">`, or a card of the tab board (YAZ-3343). */
  anchor: PreviewAnchor
}

export default function BoardPreview({ root, node, cacheKey, hint, anchor }: BoardPreviewProps) {
  const placement = usePlacement(anchor, 'board')
  // The last settled picture. Mounted `key={path}` by the Sidebar, so a stale one is always THIS board's —
  // shown while a new key (a save, a theme flip) draws, instead of flashing "Loading".
  // What the cache answered: undefined = still drawing, '' = an empty board, null = it could not be drawn.
  const [picture, setPicture] = useState<string | null | undefined>(undefined)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void boardPreviews.load(cacheKey).then((value) => {
      if (live) setPicture(value)
    })
    return () => {
      live = false
    }
  }, [cacheKey])

  if (placement === null) return null
  const name = basename(node.path)
  const src = picture || null // '' (empty) and null (failed) have no picture, like undefined (drawing)
  const message = picture === undefined ? 'Loading preview…' : picture === '' ? 'Empty board' : picture === null ? 'Preview unavailable' : null
  return createPortal(
    <div className="board-preview" role="status" aria-live="polite" aria-label={`Preview of ${name}`} style={placement}>
      <div className="board-preview__header">
        <span className="board-preview__name">{name}</span>
        <span className="board-preview__folder">{boardFolder(root, node.path)}</span>
      </div>
      {hint !== undefined && <div className="board-preview__hint">{hint}</div>}
      <div className="board-preview__body">
        {src !== null && (
          <img
            className={`board-preview__img${loadedSrc === src ? ' board-preview__img--loaded' : ''}`}
            src={src}
            alt=""
            onLoad={() => setLoadedSrc(src)}
          />
        )}
        {message !== null && <p className="board-preview__msg">{message}</p>}
      </div>
    </div>,
    // The page's body, or a Files window's floating popup (YAZ-3357 D9).
    portalTarget(anchor),
  )
}
