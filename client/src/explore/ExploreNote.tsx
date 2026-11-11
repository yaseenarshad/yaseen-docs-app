/**
 * A note layer of the explore stack (YAZ-2571). It opens for READING: the saved text in the read-only render the
 * preview panel uses (`useReadOnlyNote`'s Crepe, read only, no caret), with the note's links live: a click on a
 * `[[link]]` or a Markdown link to a note opens that note in a layer on top (`onOpenLink`); a link to a drawing, a
 * PDF or the web goes where it always goes. **E** or the Edit button turns the SAME layer into the editor: the
 * folder pages' mini window editor (App's `renderNoteEditor`), so saving, renames and conflicts are the app's own.
 * In edit a link opens a layer on top too. The head's ↗ opens the note in a tab, as ⌘↵ does.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { notePageSwitches, type PageSwitches } from '@shared/pageSwitches'
import { api } from '../api'
import { createCrepe } from '../editor/createCrepe'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import type { LinkActions } from '../editor/linkMenu'
import { hrefTarget } from '../editor/pathPaste'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { storage } from '../lib/storage'

/** The vault the note is in: what its links resolve against. */
export interface ExploreVault {
  root: string
  wikilinks: WikilinkResolveSource
  wikilinkCandidates: WikilinkCandidateSource
}

interface ExploreNoteProps {
  path: string
  mode: 'read' | 'edit'
  title: string
  vault: ExploreVault
  /** The text formatting of the note's vault (`--text-size` and the heading variables), as every page layer wears it. */
  style?: CSSProperties
  /** A link in the note to a page of the window's vaults: a note goes on top of the stack; another file opens in a tab. */
  onOpenLink: (path: string) => void
  /** The editor of a note, with `openLink` as its link door (App's `renderNoteEditor` with the stack's door). */
  renderEditor: (path: string, openLink: (path: string) => void) => ReactNode
  /** Where a bare unresolved `[[link]]` makes its note (App's `newNoteFolderFor`), root-relative. */
  createFolder: (sourcePath: string) => string
  linkActions?: LinkActions
  onNotice: (message: string) => void
  onEdit: () => void
  onOpenInTab: () => void
  onClose: () => void
  /** This layer is the top one: the body takes the focus, so E and Esc are heard. */
  active: boolean
}

/** The note editor's features minus the two that exist to edit blocks (the preview panel's set). */
const readFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

type Content = { kind: 'loading' } | { kind: 'body'; body: string; switches: PageSwitches } | { kind: 'empty' } | { kind: 'gone' }

export function ExploreNote({ path, mode, title, vault, style, onOpenLink, renderEditor, createFolder, linkActions, onNotice, onEdit, onOpenInTab, onClose, active }: ExploreNoteProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState<Content>({ kind: 'loading' })
  // The doors, read at click time: a layer's Crepe is built once, and the stack's callbacks may change identity.
  const doors = useRef({ onOpenLink, createFolder, linkActions, onNotice })
  doors.current = { onOpenLink, createFolder, linkActions, onNotice }

  // Reading: the saved text, read once per mount (the preview panel's rule). Back from edit, it is read again: the editor saved.
  useEffect(() => {
    if (mode !== 'read') return
    let live = true
    setContent({ kind: 'loading' })
    api.readFile(path).then(
      (file) => {
        if (!live) return
        const body = splitFrontmatter(file.content).body
        setContent(body.trim() === '' ? { kind: 'empty' } : { kind: 'body', body, switches: notePageSwitches(file.content) })
      },
      () => live && setContent({ kind: 'gone' }),
    )
    return () => {
      live = false
    }
  }, [path, mode])

  const body = mode === 'read' && content.kind === 'body' ? content.body : null
  const switches = content.kind === 'body' ? content.switches : undefined
  // The vault's three parts, not the object: App hands a new object each render, and the Crepe is built once per body.
  const { root, wikilinks, wikilinkCandidates } = vault
  useEffect(() => {
    const parent = bodyRef.current
    if (body === null || parent === null) return
    const el = document.createElement('div')
    el.className = 'editor-instance'
    if (switches?.['guide-lines'] !== undefined) el.dataset.guideLines = switches['guide-lines'] ? 'on' : 'off'
    if (switches?.folding !== undefined) el.dataset.folding = switches.folding ? 'on' : 'off'
    if (switches?.['bullet-threading'] !== undefined) el.dataset.threading = switches['bullet-threading'] ? 'on' : 'off'
    parent.appendChild(el)
    const foldingOn = switches?.folding ?? storage.getSettings().foldingOnByDefault
    const open = (target: string) => doors.current.onOpenLink(target)
    const place = { root, notePath: path, candidates: wikilinkCandidates }
    const crepe = createCrepe({
      root: el,
      defaultValue: body,
      features: readFeatures,
      wikilinks,
      foldingOn: () => foldingOn,
      // The note's links, live (the read-only rule: a plain click opens, YAZ-3879 point 6). An unresolved link is made first, as everywhere.
      wikilinkNav: { ...doors.current.linkActions, root, createFolder: () => doors.current.createFolder(path), openCurrent: open, openNewTab: open, openBackground: open, onNotice: (m) => doors.current.onNotice(m) },
      markdownLinkNav: {
        ...doors.current.linkActions,
        open: (href) => api.shell.openLink({ href, sourcePath: path }),
        inApp: (href) => hrefTarget(href, place),
        openPath: open,
        onNotice: (m) => doors.current.onNotice(m),
      },
      // Pictures resolve against the note's folder, as in its page (YAZ-1656).
      image: { root, notePath: path },
    })
    const ready = crepe.create().then(() => crepe.setReadonly(true))
    return () => {
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [body, switches, path, root, wikilinks, wikilinkCandidates])

  // The top layer's body takes the focus, so E and Esc work with no click; a layer uncovered again takes it back.
  useEffect(() => {
    if (active && mode === 'read') bodyRef.current?.focus()
  }, [active, mode])

  const note = fileKind(path) === 'markdown'
  return (
    <>
      <div className="explore__head">
        <span className="explore__title" title={path}>
          {title}
        </span>
        {mode === 'read' ? (
          <>
            <span className="explore__mode">Reading</span>
            {note && (
              <button type="button" className="explore__button" onClick={onEdit} title="Edit this note here (E)">
                Edit<kbd>E</kbd>
              </button>
            )}
          </>
        ) : (
          <span className="explore__mode">Editing</span>
        )}
        <button type="button" className="explore__button" onClick={onOpenInTab} title="Open in a tab and close the stack (⌘↵)" aria-label="Open in a tab">
          ↗
        </button>
        <button type="button" className="explore__button" onClick={onClose} title="Close this layer (Esc)" aria-label="Close this layer">
          ×
        </button>
      </div>
      {mode === 'edit' ? (
        <div className="explore__body explore__body--edit" style={style}>
          {renderEditor(path, onOpenLink)}
        </div>
      ) : (
        <div ref={bodyRef} className="explore__body" style={style} tabIndex={-1} data-explore-read>
          {content.kind === 'gone' && <p className="editor-msg">Can&apos;t read &quot;{title}&quot; — it is no longer there</p>}
          {content.kind === 'empty' && <p className="editor-msg">Empty page</p>}
        </div>
      )}
    </>
  )
}
