/**
 * A note layer of the explore stack (YAZ-2571). It opens for READING: the saved text in the read-only render the
 * preview panel uses (`useReadOnlyNote`'s Crepe, read only, no caret), with the note's links live: a click on a
 * `[[link]]` or a Markdown link to a note opens that note in a layer on top (`onOpenLink`); a link to a drawing, a
 * PDF or the web goes where it always goes. **E** or the Edit button turns the SAME layer into the editor: the
 * folder pages' mini window editor (App's `renderNoteEditor`), so saving, renames and conflicts are the app's own.
 * In edit a link opens a layer on top too. The head's ↗ opens the note in a tab, as ⌘↵ does.
 */
import { UnitContext, useVaultUnit } from '../vault/unitWord'
import { useNoteId } from '../search/showIds'
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { notePageSwitches, type PageSwitches } from '@shared/pageSwitches'
import type { CommentsOrder } from '@shared/types'
import { api } from '../api'
import { CommentsSection } from '../comments/CommentsSection'
import { createCrepe, editorViewOf } from '../editor/createCrepe'
import { DocumentZoom } from '../editor/DocumentZoom'
import { CrepeFeature } from '../editor/crepe'
import { features } from '../editor/featureConfig'
import { FindBar } from '../editor/find/FindBar'
import { createFindChannel } from '../editor/find/findChannel'
import { FoldAllButton } from '../editor/FoldAllButton'
import type { LinkActions } from '../editor/linkMenu'
import { NoteMenu } from '../editor/noteMenu'
import { FOLDS_CHANGED_EVENT, nextDocumentFold, setAllDocumentFolds } from '../editor/outline/foldAllHotkeys'
import type { MenuSection } from '../sidebar/menuSections'
import { hrefTarget } from '../editor/pathPaste'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { fileIconDecoration, IconsContext } from '../sidebar/FileIcon'
import { BacklinksSection } from '../links/BacklinksSection'
import { savedFirst } from '../lib/renameContinuity'
import { storage } from '../lib/storage'

/** The vault the note is in: what its links resolve against. */
export interface ExploreVault {
  root: string
  wikilinks: WikilinkResolveSource
  wikilinkCandidates: WikilinkCandidateSource
  /** The vault's catalog of files that are no notes: a board embed and a link to a drawing resolve through it. */
  viewOnlyLinks?: ViewOnlyLinkSource
}

interface ExploreNoteProps {
  path: string
  mode: 'read' | 'edit'
  /** Bumped by the stack when the note was deleted under the layer: read again, and say it is gone. */
  gone?: number
  title: string
  /** YAZ-4940: the vault's "Show IDs in the title"; On draws the note's ID after the title, small and muted. */
  idInTitle?: boolean
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
  /** Edit (reading) / Done (editing): the layer's mode flips; E and Esc reach it too (`ExploreStack`). */
  onToggleEdit: () => void
  /**
   * ‹ › (round 3): the note's place among the rows of the search under it ("2/3"), whether a step each way exists,
   * and the step. A note opened from a link has no search under it, so no ‹ ›.
   */
  steps?: LayerSteps
  /** The head's drag (round 3): the layer moves with the pointer; a double click puts it back in its stack place. */
  onHeadDown?: (event: ReactMouseEvent) => void
  onHeadReset?: (event: ReactMouseEvent) => void
  /** The zoom of every note layer (round 4): the page zoom's pill in the head, and `--document-zoom` on the body, as a note tab's scroller carries it. */
  zoom: number
  onZoom: (zoom: number) => void
  /** The comment stream's order (YAZ-1515), the setting, and its toggle: as every page layer has them. */
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
  onOpenInTab: () => void
  /** The note menu (round 1, items 6 and 7): a right-click on the head opens it at the pointer; in the text it follows the text menu. */
  onHeadMenu: (x: number, y: number) => void
  noteMenu: () => MenuSection[]
  onClose: () => void
  /** This layer is the top one: the body takes the focus, so E and Esc are heard. */
  active: boolean
}

/** ‹ n/m › of a layer opened from a search (round 3): its place among the rows, whether a step each way exists, the step. */
export interface LayerSteps {
  place: number
  count: number
  prev: boolean
  next: boolean
  onStep: (dir: -1 | 1) => void
}

/** A press on a head button keeps the keyboard where it is (the reading body, the editor, the board). */
export const keepFocus = (event: ReactMouseEvent) => event.preventDefault()

/** ‹ n/m › in a layer's head (a note's, a board's: YAZ-4943). */
export function ExploreSteps({ steps }: { steps: LayerSteps }) {
  return (
    <span className="explore__steps">
      <button type="button" className="explore__step" title="Previous search result (← or ⌘⌥↑)" aria-label="Previous search result" disabled={!steps.prev} onMouseDown={keepFocus} onClick={() => steps.onStep(-1)}>
        ‹
      </button>
      <span className="explore__count">{steps.place === 0 ? '' : `${steps.place}/${steps.count}`}</span>
      <button type="button" className="explore__step" title="Next search result (→ or ⌘⌥↓)" aria-label="Next search result" disabled={!steps.next} onMouseDown={keepFocus} onClick={() => steps.onStep(1)}>
        ›
      </button>
    </span>
  )
}

/** The note editor's features minus the two that exist to edit blocks (the preview panel's set). */
const readFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

type Content = { kind: 'loading' } | { kind: 'body'; body: string; switches: PageSwitches } | { kind: 'empty' } | { kind: 'gone' }

export function ExploreNote({ path, mode, gone = 0, title, idInTitle = false, vault, style, onOpenLink, renderEditor, createFolder, linkActions, onNotice, onToggleEdit, steps, onHeadDown, onHeadReset, zoom, onZoom, commentsOrder, onChangeCommentsOrder, onOpenInTab, onHeadMenu, noteMenu, onClose, active }: ExploreNoteProps) {
  // The layer's vault's word for a note (YAZ-4938), for its own words and for every panel inside it.
  const unit = useVaultUnit(vault.root)
  const noteId = useNoteId(idInTitle ? vault.wikilinks : undefined, path)
  const bodyRef = useRef<HTMLDivElement>(null)
  /** Where the read-only Crepe mounts: its own box ABOVE the comment stream and the mentions, as the note tab stacks them. */
  const mountRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState<Content>({ kind: 'loading' })
  /** The read-only Crepe once it is up, for the fold-all button (round 1, item 4); null while loading or editing. */
  const [ready, setReady] = useState<ReturnType<typeof createCrepe> | null>(null)
  const icons = useContext(IconsContext)
  /** ⌘F in the reading layer finds in THIS note (check 11): the note's own find plugin on this Crepe, and its bar. */
  const findChannel = useMemo(() => createFindChannel(), [])
  // The doors, read at click time: a layer's Crepe is built once, and the stack's callbacks may change identity.
  const doors = useRef({ onOpenLink, createFolder, linkActions, onNotice })
  doors.current = { onOpenLink, createFolder, linkActions, onNotice }

  /** The whole file as read, frontmatter included: the comment stream's truth. */
  const readRef = useRef('')
  // Reading: the saved text, read once per mount (the preview panel's rule). Back from edit, it is read again: the editor saved.
  useEffect(() => {
    if (mode !== 'read') return
    let live = true
    setContent({ kind: 'loading' })
    // A save of this note still on its way (an editor's flush, YAZ-3685 F5) lands first: the read sees the typed text.
    Promise.resolve(savedFirst(path))
      .then(() => api.readFile(path))
      .then(
      (file) => {
        if (!live) return
        readRef.current = file.content
        const body = splitFrontmatter(file.content).body
        setContent(body.trim() === '' ? { kind: 'empty' } : { kind: 'body', body, switches: notePageSwitches(file.content) })
      },
      () => live && setContent({ kind: 'gone' }),
    )
    return () => {
      live = false
    }
  }, [path, mode, gone])

  const body = mode === 'read' && content.kind === 'body' ? content.body : null
  const switches = content.kind === 'body' ? content.switches : undefined
  // The vault's three parts, not the object: App hands a new object each render, and the Crepe is built once per body.
  const { root, wikilinks, wikilinkCandidates, viewOnlyLinks } = vault
  useEffect(() => {
    const parent = mountRef.current
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
      find: findChannel,
      // A board embed, a link to a drawing or a PDF: the vault's view-only catalog, as in the note tab (else "Missing drawing").
      viewOnlyLinks,
      // The pills' icons, and a board embed as its window, read only (round 1, item 2): what the note tab draws.
      linkLook: { icon: (target, folder) => fileIconDecoration(icons, target, folder) },
      boardEmbeds: { root },
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
    let live = true
    const up = crepe.create().then(() => {
      crepe.setReadonly(true)
      if (live) setReady(crepe)
    })
    return () => {
      live = false
      setReady(null)
      void up.then(() => crepe.destroy()).finally(() => el.remove())
    }
    // `icons` is read at each link draw; a change of the icon rules redraws no preview (the preview panel's rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, switches, path, root, wikilinks, wikilinkCandidates, viewOnlyLinks, findChannel])

  // The fold-all button (round 1, item 4): the note tab's own button and command on this layer's Crepe.
  const subscribeFolds = useCallback(
    (changed: () => void) => {
      if (ready === null) return () => {}
      const dom = editorViewOf(ready).dom
      dom.addEventListener(FOLDS_CHANGED_EVENT, changed)
      return () => dom.removeEventListener(FOLDS_CHANGED_EVENT, changed)
    },
    [ready],
  )
  const foldAll = ready !== null && mode === 'read' && (
    <FoldAllButton
      read={() => (ready === null ? 'none' : nextDocumentFold(editorViewOf(ready).state))}
      run={(collapse) => {
        if (ready === null) return
        const view = editorViewOf(ready)
        setAllDocumentFolds(collapse)(view.state, view.dispatch)
      }}
      subscribe={subscribeFolds}
      keys={{ collapse: 'note.foldAll', expand: 'note.unfoldAll' }}
    />
  )
  /** The saved text for the comment stream (round 1, item 3): what was read, until the block's own write moves it. */
  const file = content.kind === 'body' || content.kind === 'empty' ? { path, content: readRef.current } : null

  // The top layer's body takes the focus, so E and Esc work with no click; a layer uncovered again takes it back.
  useEffect(() => {
    if (active && mode === 'read') bodyRef.current?.focus()
  }, [active, mode])

  const note = fileKind(path) === 'markdown'
  /** The text formatting of the vault, and the zoom as the note tab's scroller carries it (`--document-zoom`, app.css): the same rules scale the note's content. */
  const bodyStyle = { ...style, '--document-zoom': zoom / 100 } as CSSProperties
  return (
    <UnitContext.Provider value={unit}>
      <div
        className="explore__head"
        onMouseDown={onHeadDown}
        onDoubleClick={onHeadReset}
        onContextMenu={(e) => {
          e.preventDefault()
          onHeadMenu(e.clientX, e.clientY)
        }}
      >
        <span className="explore__title" title={path}>
          {title}
        </span>
        {noteId !== undefined && <span className="explore__id">{noteId}</span>}
        {steps !== undefined && <ExploreSteps steps={steps} />}
        {/* The page zoom's pill (round 4): one value for every note layer; a press on it is the pill's, not a drag. */}
        <DocumentZoom value={zoom} onChange={onZoom} />
        {foldAll}
        {/* No "Reading" label (YAZ-4944): reading is the normal state; "Edit E" says what you can do. */}
        {mode === 'read' ? (
          <>
            {note && (
              <button type="button" className="explore__button" onClick={onToggleEdit} title={unit('Edit this note here (E)')}>
                Edit<kbd>E</kbd>
              </button>
            )}
          </>
        ) : (
          <>
            <span className="explore__mode">Editing</span>
            {/* Done (item 5): back to reading, as Esc does; the note saved as you typed. */}
            <button type="button" className="explore__button" onClick={onToggleEdit} title="Back to reading (Esc)">
              Done<kbd>esc</kbd>
            </button>
          </>
        )}
        <button type="button" className="explore__button" onClick={onOpenInTab} title="Open in a tab and close the stack (⌘↵)" aria-label="Open in a tab">
          ↗
        </button>
        <button type="button" className="explore__button" onClick={onClose} title="Close this layer (Esc)" aria-label="Close this layer">
          ×
        </button>
      </div>
      {mode === 'edit' ? (
        <div className="explore__body explore__body--edit" style={bodyStyle}>
          {/* Keyed by the path: a step while editing saves this note and mounts the editor on the next (the body div stays, with the keyboard). */}
          <Fragment key={path}>{renderEditor(path, onOpenLink)}</Fragment>
        </div>
      ) : (
        <div ref={bodyRef} className="explore__body" style={bodyStyle} tabIndex={-1} data-explore-read>
          <FindBar channel={findChannel} scope="note" hostRef={bodyRef} />
          <div ref={mountRef} className="explore__mount" />
          {content.kind === 'gone' && <p className="editor-msg">Can&apos;t read &quot;{title}&quot; — it is no longer there</p>}
          {content.kind === 'empty' && <p className="editor-msg">Empty page</p>}
          {/* The note's right-click menu (item 7): the text rows (Copy, Copy as; no Cut or Paste while reading), then the note menu. */}
          {ready !== null && <NoteMenu view={editorViewOf(ready)} extra={noteMenu} reading />}
          {/* Under the note, as in its tab (round 1, item 3): the comment stream, then "Linked mentions"; a mention opens on top. */}
          {file !== null && (
            <div className="explore__under">
              <CommentsSection file={file} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} root={root} />
              <BacklinksSection path={path} source={wikilinks} openCurrent={onOpenLink} />
            </div>
          )}
        </div>
      )}
    </UnitContext.Provider>
  )
}
