/**
 * THE PREVIEW PANEL OF THE SEARCH (YAZ-2662 D5): Space on a highlighted file of the search tree
 * holds that file up over the page area, as Quick Look does on a Mac. It is no tab and no page: it
 * opens nothing, writes nothing and stores nothing (S42), and it takes no focus — the caret stays
 * in the search bar, whose keys show, move and close it (`useSidebarSearch`).
 *
 * READ, NEVER OPEN: a note's body comes from `api.readFile` — the saved text (S44) — into the
 * read-only render that the hover card of Table and Board uses; never `Editor`, which would start
 * an autosave, store folds and take the caret. Each other kind is the read-only viewer of its page.
 */
import { useEffect, useRef, useState } from 'react'
import { fileKind } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { api } from '../api'
import { useReadOnlyNote } from '../editor/useReadOnlyNote'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { ImageViewer } from '../viewers/ImageViewer'
import { PdfViewer } from '../viewers/PdfViewer'
import { TextViewer } from '../viewers/TextViewer'
import './quickLook.css'

type Content = { kind: 'loading' } | { kind: 'body'; body: string } | { kind: 'empty' } | { kind: 'gone' }

/** A note, read one time for each mount (R3): the panel keys it by its path, so a read that lands after the highlight moved finds it gone. */
function Note({ path, title, wikilinks }: { path: string; title: string; wikilinks: WikilinkResolveSource }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState<Content>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    api.readFile(path).then(
      (file) => {
        if (!live) return
        const body = splitFrontmatter(file.content).body
        setContent(body.trim() === '' ? { kind: 'empty' } : { kind: 'body', body })
      },
      () => live && setContent({ kind: 'gone' }),
    )
    return () => {
      live = false
    }
  }, [path])

  useReadOnlyNote(hostRef, content.kind === 'body' ? content.body : null, wikilinks)

  return (
    <div className="quicklook__note" ref={hostRef}>
      {/* A note that is gone, or that the app cannot read (S41), named as the tree names it. */}
      {content.kind === 'gone' && <p className="editor-msg">Can&apos;t preview &quot;{title}&quot; — it is no longer there</p>}
      {content.kind === 'empty' && <p className="editor-msg">Empty page</p>}
    </div>
  )
}

interface QuickLookProps {
  /** The file on preview. */
  path: string
  /** That file as the tree names it: the header, and the line of a note that is gone. */
  title: string
  /** The watcher and the link source of the vault that holds the file. */
  watch: WatchSource
  wikilinks: WikilinkResolveSource
  /** The ✕ (S43), and Esc with the keyboard focus inside the panel (S66). */
  onClose: () => void
}

export function QuickLook({ path, title, watch, wikilinks, onClose }: QuickLookProps) {
  // The kinds are the ones `Editor` shows as a page (S39); a file with no viewer gets one line (S40).
  const kind = fileKind(path)
  return (
    // The panel takes no focus when it shows. A click in it — to select text — puts the keyboard
    // focus on it (no Tab stop), so the search bar's Esc is out of reach: Esc here closes the panel (S66).
    <section
      className="quicklook"
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
          <Note key={path} path={path} title={title} wikilinks={wikilinks} />
        ) : kind === 'text' ? (
          <TextViewer path={path} watch={watch} />
        ) : kind === 'pdf' ? (
          <PdfViewer path={path} watch={watch} />
        ) : kind === 'image' ? (
          <ImageViewer key={path} path={path} watch={watch} />
        ) : (
          <p className="editor-msg">No preview for this file.</p>
        )}
      </div>
    </section>
  )
}
