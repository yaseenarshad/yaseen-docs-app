/**
 * A PAGE'S HOVER PREVIEW (YAZ-3075 D1, D2): the top of the page, in the board panel's box beside the
 * sidebar — the same place and width, 70% of the window tall (`usePlacement(anchor, 'page')`), the
 * same header. Portalled to `<body>` and `pointer-events: none`, as the board's: a glance, never a
 * surface — no click and no scroll (C21); the last 64 px fade out instead (C17).
 *
 * The page is the Space preview's own `ReadOnlyPage`, read with `api.readFile` on each open and cut
 * to its first `PAGE_PREVIEW_CHARS` at a line end, so a rest on a 10 MB page stays fast. The host
 * mounts this `key={path}`, so a read that lands after the row changed is dropped (C25), and the
 * Crepe instance goes with it on close (C28). Lazy, with its CSS, like the board's panel. A card file's header has the
 * card icon before its name (YAZ-5037).
 */
import { useContext, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ReadOnlyPage } from '../editor/ReadOnlyPage'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { boardFolder } from '../lib/paths'
import { IconsContext } from './FileIcon'
import { portalTarget, usePlacement, type PreviewAnchor } from './previewPlacement'
import './boardPreview.css'

/** How much of a page's body the hover preview draws (YAZ-3075 D1, C17): about 25 lines need far less. */
export const PAGE_PREVIEW_CHARS = 4000

interface PagePreviewProps {
  root: string
  /** The hovered page. */
  node: { path: string }
  /** The page as the tree names it, by its title (`pageName`): the header says it the same way (YAZ-3075 checker round 1). */
  name: string
  /** One quiet line under the header: how to open the page (a link's card, YAZ-3935). Absent → none. */
  hint?: string
  /** The link source of the page's vault: a `[[<id>]]` link shows its title (C21). */
  wikilinks: WikilinkResolveSource
  /** The text formatting of the page's vault (YAZ-3067 D12, C20): `--text-size` and the `--hN-*` variables. */
  textVars: CSSProperties
  /** What the panel sits beside: the `<aside className="sidebar">`, or a card of the tab board (YAZ-3343). */
  anchor: PreviewAnchor
}

export default function PagePreview({ root, node, name, hint, wikilinks, textVars, anchor }: PagePreviewProps) {
  const placement = usePlacement(anchor, 'page')
  // A card file (YAZ-5037): the card icon before its name, from the index.
  const card = useContext(IconsContext)?.cards?.has(node.path) === true
  if (placement === null) return null
  return createPortal(
    // No live region on the frame: it would read the whole page out on each rest. The header says which page.
    <div className="board-preview page-preview" role="group" aria-label={`Preview of ${name}`} style={{ ...textVars, ...placement }}>
      <div className="board-preview__header" role="status">
        {card && <span className="card-file-icon" aria-hidden />}
        <span className="board-preview__name">{name}</span>
        <span className="board-preview__folder">{boardFolder(root, node.path)}</span>
      </div>
      {hint !== undefined && <div className="board-preview__hint">{hint}</div>}
      <ReadOnlyPage className="page-preview__body" path={node.path} wikilinks={wikilinks} maxChars={PAGE_PREVIEW_CHARS} unreadable="Preview unavailable" />
    </div>,
    // The page's body, or a Files window's floating popup (YAZ-3357 D9).
    portalTarget(anchor),
  )
}
