/**
 * THE PREVIEW PANEL OF THE SEARCH (YAZ-2662 D5): Space on a highlighted file of the search tree
 * holds that file up over the page area, as Quick Look does on a Mac. It is no tab and no page: it
 * opens nothing, writes nothing and stores nothing (S42), and it takes no focus — the caret stays
 * in the search bar, whose keys show, move and close it (`useSidebarSearch`).
 *
 * READ, NEVER OPEN: a note is `ReadOnlyNote` — the saved text (S44) in the read-only render, the
 * same note the sidebar's hover preview shows (YAZ-3075 D1); never `Editor`, which would start an
 * autosave, store folds and take the caret. Each other kind is the read-only viewer of its page. A
 * code file is the code tab's Monaco, read only (`CodePreview`, YAZ-3450), in its own chunk: Monaco
 * loads only when a code file is held up.
 */
import { lazy, Suspense, type CSSProperties } from 'react'
import { fileKind } from '@shared/fileKind'
import type { DiagramDarkColors } from '@shared/types'
import { ReadOnlyNote } from '../editor/ReadOnlyNote'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { ImageViewer } from '../viewers/ImageViewer'
import { PdfViewer } from '../viewers/PdfViewer'
import './quickLook.css'

/** A board's picture (YAZ-3044 A22), in its own chunk with the preview cache it shares with the hover panel. */
const QuickLookBoard = lazy(() => import('./QuickLookBoard'))
/** A code file (YAZ-3450): Monaco, read only, in its own chunk with Monaco behind it. */
const CodePreview = lazy(() => import('../code/CodePreview'))

interface QuickLookProps {
  /** The file on preview. */
  path: string
  /** That file as the tree names it: the header, and the line of a note that is gone. */
  title: string
  /** The watcher and the link source of the vault that holds the file. */
  watch: WatchSource
  wikilinks: WikilinkResolveSource
  /** The vault that holds the file and the draw.io dark colours: a drawing or diagram shows its picture with them (A22). */
  root?: string | null
  darkColors?: DiagramDarkColors
  /** The text formatting of the vault that holds the file (YAZ-3067 D12): `--text-size` and the `--hN-*` variables. */
  style?: CSSProperties
  /** The ✕ (S43), and Esc with the keyboard focus inside the panel (S66). */
  onClose: () => void
}

export function QuickLook({ path, title, watch, wikilinks, root = null, darkColors = 'adapt', style, onClose }: QuickLookProps) {
  // The kinds are the ones `Editor` shows as a page (S39); a file with no viewer gets one line (S40).
  const kind = fileKind(path)
  return (
    // The panel takes no focus when it shows. A click in it — to select text — puts the keyboard
    // focus on it (no Tab stop), so the search bar's Esc is out of reach: Esc here closes the panel (S66).
    <section
      className="quicklook"
      style={style}
      aria-label="Preview"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
    >
      <header className="quicklook__header">
        <span className="quicklook__title">{title}</span>
        {/* A press on the ✕ takes no focus: the caret stays in the search bar. */}
        <button type="button" className="quicklook__close" aria-label="Close preview" title="Close preview" onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="quicklook__body">
        {kind === 'markdown' ? (
          // A note that is gone, or that the app cannot read (S41), named as the tree names it.
          <ReadOnlyNote key={path} className="quicklook__note" path={path} wikilinks={wikilinks} unreadable={<>Can&apos;t preview &quot;{title}&quot; — it is no longer there</>} />
        ) : kind === 'text' ? (
          <Suspense fallback={null}>
            <CodePreview key={path} path={path} watch={watch} />
          </Suspense>
        ) : kind === 'pdf' ? (
          <PdfViewer path={path} watch={watch} />
        ) : kind === 'image' ? (
          <ImageViewer key={path} path={path} watch={watch} />
        ) : (kind === 'drawing' || kind === 'diagram') && root !== null ? (
          <Suspense fallback={null}>
            <QuickLookBoard key={path} root={root} path={path} darkColors={darkColors} />
          </Suspense>
        ) : (
          <p className="editor-msg">No preview for this file.</p>
        )}
      </div>
    </section>
  )
}
