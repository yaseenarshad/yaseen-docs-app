/**
 * AN IMAGE'S OR A PDF'S HOVER CARD (YAZ-3746 13R, 2026-11-08: Yaseen overturned YAZ-3075 D6, "a PDF or image row
 * never does"): the picture fitted to the board card's frame, or the PDF's first page in the same frame. The places,
 * their switches and the dwell are the hover preview's own (YAZ-3403): `PreviewPanel` mounts this for a `pdf` or an
 * `image` kind file, `key={path}`.
 *
 * LIGHT. Nothing loads until the dwell ends: one read of the file's bytes (`api.readImage`, `api.readPdf`, the viewers'
 * own reads), a Blob URL, and the browser's own decoder — an `<img>` for the picture, and for the PDF the same Chromium
 * PDF plugin the PDF tab uses (`PdfViewer`), in a frame with its toolbar, side panel and scrollbar hidden and the first
 * page fitted. The URL is revoked when the card goes. Its own chunk, loaded on the first dwell of its kind.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileKind } from '@shared/fileKind'
import { api } from '../api'
import { boardFolder } from '../lib/paths'
import { portalTarget, usePlacement, type PreviewAnchor } from './previewPlacement'
import './boardPreview.css'

/** The line a file that cannot be read shows: the hover preview's words for every unreadable file. */
const UNREADABLE = 'Preview unavailable'

/** Structured-cloned bridge bytes are ArrayBuffer-backed; retain their exact view for Blob (the viewers' rule). */
function blobPart(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

/** Chromium's PDF open parameters: the first page fitted to the frame, no toolbar, no side panel, no scrollbar. */
const PDF_FIRST_PAGE = '#page=1&toolbar=0&navpanes=0&scrollbar=0&view=Fit'

export interface MediaHoverPreviewProps {
  /** The vault that holds the file: the header names its folder relative to it. */
  root: string
  path: string
  /** The file's name as the tree shows it. */
  name: string
  /** One quiet line under the header (a link's card, YAZ-3935). Absent → none. */
  hint?: string
  anchor: PreviewAnchor
}

type Card = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'gone' }

export default function MediaHoverPreview({ root, path, name, hint, anchor }: MediaHoverPreviewProps) {
  const placement = usePlacement(anchor, 'board')
  const [card, setCard] = useState<Card>({ kind: 'loading' })
  const pdf = fileKind(path) === 'pdf'
  useEffect(() => {
    let live = true
    let url: string | null = null
    const read = pdf ? api.readPdf(path).then((file) => new Blob([blobPart(file.data)], { type: 'application/pdf' })) : api.readImage(path).then((file) => new Blob([blobPart(file.data)], { type: file.mime }))
    read.then(
      (blob) => {
        if (!live) return
        url = URL.createObjectURL(blob)
        setCard({ kind: 'ready', url })
      },
      () => {
        if (live) setCard({ kind: 'gone' })
      },
    )
    return () => {
      live = false
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [path, pdf])
  if (placement === null) return null
  return createPortal(
    <div className="board-preview media-hover" role="group" aria-label={`Preview of ${name}`} style={placement}>
      <div className="board-preview__header" role="status">
        <span className="board-preview__name">{name}</span>
        <span className="board-preview__folder">{boardFolder(root, path)}</span>
      </div>
      {hint !== undefined && <div className="board-preview__hint">{hint}</div>}
      <div className="board-preview__body">
        {card.kind === 'ready' && !pdf && <img className="board-preview__img board-preview__img--loaded" src={card.url} alt="" draggable={false} />}
        {card.kind === 'ready' && pdf && <iframe className="media-hover__pdf" src={`${card.url}${PDF_FIRST_PAGE}`} title={name} tabIndex={-1} />}
        {card.kind === 'gone' && <p className="board-preview__msg">{UNREADABLE}</p>}
      </div>
    </div>,
    portalTarget(anchor),
  )
}
