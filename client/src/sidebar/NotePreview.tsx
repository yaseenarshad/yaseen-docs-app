/**
 * A NOTE'S HOVER PREVIEW (YAZ-3075 D1, D2): the top of the note, in the board panel's box beside the
 * sidebar — the same place and width, 70% of the window tall (`usePlacement(anchor, 'note')`), the
 * same header. Portalled to `<body>` and `pointer-events: none`, as the board's: a glance, never a
 * surface — no click and no scroll (C21); the last 64 px fade out instead (C17).
 *
 * The note is the Space preview's own `ReadOnlyNote`, read with `api.readFile` on each open and cut
 * to its first `NOTE_PREVIEW_CHARS` at a line end, so a rest on a 10 MB note stays fast. The host
 * mounts this `key={path}`, so a read that lands after the row changed is dropped (C25), and the
 * Crepe instance goes with it on close (C28). Lazy, with its CSS, like the board's panel.
 */
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ReadOnlyNote } from '../editor/ReadOnlyNote'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { boardFolder } from '../lib/paths'
import { usePlacement, type PreviewAnchor } from './previewPlacement'
import './boardPreview.css'

/** How much of a note's body the hover preview draws (YAZ-3075 D1, C17): about 25 lines need far less. */
export const NOTE_PREVIEW_CHARS = 4000

interface NotePreviewProps {
  root: string
  /** The hovered note. */
  node: { path: string }
  /** The note as the tree names it, by its title (`pageName`): the header says it the same way (YAZ-3075 checker round 1). */
  name: string
  /** The link source of the note's vault: a `[[<id>]]` link shows its title (C21). */
  wikilinks: WikilinkResolveSource
  /** The text formatting of the note's vault (YAZ-3067 D12, C20): `--text-size` and the `--hN-*` variables. */
  textVars: CSSProperties
  /** What the panel sits beside: the `<aside className="sidebar">`, or a card of the tab board (YAZ-3343). */
  anchor: PreviewAnchor
}

export default function NotePreview({ root, node, name, wikilinks, textVars, anchor }: NotePreviewProps) {
  const placement = usePlacement(anchor, 'note')
  if (placement === null) return null
  return createPortal(
    // No live region on the frame: it would read the whole note out on each rest. The header says which note.
    <div className="board-preview note-preview" role="group" aria-label={`Preview of ${name}`} style={{ ...textVars, ...placement }}>
      <div className="board-preview__header" role="status">
        <span className="board-preview__name">{name}</span>
        <span className="board-preview__folder">{boardFolder(root, node.path)}</span>
      </div>
      <ReadOnlyNote className="note-preview__body" path={node.path} wikilinks={wikilinks} maxChars={NOTE_PREVIEW_CHARS} unreadable="Preview unavailable" />
    </div>,
    document.body,
  )
}
