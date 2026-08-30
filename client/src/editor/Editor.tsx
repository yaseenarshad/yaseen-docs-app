import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileResponse, GithubSyncStatus, PropertiesResponse } from '@shared/types'
import { api } from '../api'
import { createDrawing } from '../drawings/createDrawing'
import { DrawingModal } from '../drawings/DrawingModal'
import { createDrawingFeed } from '../drawings/drawingFeed'
import { FolderPageContents } from '../views/FolderPageContents'
import { createCrepe, focusEditor, getMarkdownForSave, setMarkdown } from './createCrepe'
import { FindBar } from './find/FindBar'
import { createFindChannel } from './find/findChannel'
import { FrontmatterPanel } from './FrontmatterPanel'
import { PageTitle } from './PageTitle'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import './outline/outlineFolding.css'
import './outline/headingFolding.css'
import './outline/bullets.css'
import './outline/zoom.css'
import './outline/guideLines.css'
import './outline/bulletThreading.css'
import { splitFrontmatter } from '@shared/frontmatter'
import { SaveIndicator } from './SaveIndicator'
import { SyncIndicator } from './SyncIndicator'
import { useAutosave } from '../hooks/useAutosave'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { BacklinksSection } from '../links/BacklinksSection'
import { basename } from '../lib/paths'
import { takeRenameBuffer } from '../lib/renameContinuity'
import { appliedTheme } from '../lib/theme'
import { storage } from '../lib/storage'
import { HOME_LINK } from '../sidebar/ensureHome'

interface EditorProps {
  /** Open root folder; fold state is persisted per root + file. */
  root: string
  path: string | null
  watch: WatchSource
  /** Bases open their row links through this (GRO-2135); App passes `openFile`. */
  onOpenFile: (path: string) => void
  /** Folder-page Table/Board actions open a member in the window's right panel. */
  onOpenFileRight?: (path: string) => void
  /**
   * ⌘-click on an editor wiki link (Links C, GRO-2192) opens a background tab; App passes
   * the tabs API's `openBackground`. Absent → wiki-link clicks stay plain editing.
   */
  onOpenFileBackground?: (path: string) => void
  /** Wiki-link create failures surface here (passive link-notice style); App passes `setNotice`. */
  onNotice?: (message: string) => void
  /**
   * Root-relative folder where a bare unresolved `[[link]]` creates its page (C2-, GRO-2240);
   * App passes a STABLE getter over the Files & Links setting + the active tab (`newNoteBase`).
   * Absent → the vault root, exactly the setting's default.
   */
  createBase?: () => string
  /** Wikilink resolve source (GRO-2190): App owns ONE per window, fed by WikilinkIndexBridge. */
  wikilinks?: WikilinkResolveSource
  /** `[[` picker candidates (GRO-2191): same ownership and feed as `wikilinks`. */
  wikilinkCandidates?: WikilinkCandidateSource
  /** The vault's property declarations (YAZ-835), App-owned like `wikilinks`: typing rung 2 for a folder page's contents block (YAZ-846). */
  properties?: PropertiesResponse | null
  /**
   * A title commit (⚡ YAZ-888) goes to App's ONE rename door — the same prop the sidebar's
   * inline rename and drag-move reach, so the name-change confirm and every failure notice come
   * with it. Absent → the title renders and edits, but commits nothing (decoration-only mounts).
   */
  onRenameFile?: (oldPath: string, newPath: string) => void
  /**
   * This vault's GitHub sync status (YAZ-1081 3A, 🔒 D5), App-owned like `wikilinks`: ONE
   * `useGithubSync` per window feeds every mounted tab. null while the first fetch is in
   * flight — and undefined for mounts with no sync at all — so the chip simply does not render.
   */
  sync?: GithubSyncStatus | null
  /** The chip's click (it IS the sync button); App passes `useGithubSync`'s `syncNow`. */
  onSyncNow?: () => void
}

export function Editor({ root, path, watch, onOpenFile, onOpenFileRight, onOpenFileBackground, onNotice, createBase, wikilinks, wikilinkCandidates, properties, onRenameFile, sync, onSyncNow }: EditorProps) {
  const state = useFile(path)
  const file = state.status === 'ready' ? state.file : state.status === 'loading' ? state.prev : null
  return (
    <section className="editor">
      {state.status === 'idle' && <p className="editor-msg">Select a file from the sidebar.</p>}
      {state.status === 'loading' && file === null && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="editor-msg editor-msg--error">{state.message}</p>}
      {file !== null && (
        <CrepeHost key={file.path} root={root} file={file} watch={watch} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} onNotice={onNotice} createBase={createBase} wikilinks={wikilinks} wikilinkCandidates={wikilinkCandidates} properties={properties} onRenameFile={onRenameFile} sync={sync} onSyncNow={onSyncNow} />
      )}
    </section>
  )
}

/** Mounts exactly one Crepe instance for `file`; remounted (via `key`) when the path changes. */
function CrepeHost({
  root,
  file,
  watch,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  onNotice,
  createBase,
  wikilinks,
  wikilinkCandidates,
  properties,
  onRenameFile,
  sync,
  onSyncNow,
}: {
  root: string
  file: FileResponse
  watch: WatchSource
  onOpenFile: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  onNotice?: (message: string) => void
  createBase?: () => string
  wikilinks?: WikilinkResolveSource
  wikilinkCandidates?: WikilinkCandidateSource
  properties?: PropertiesResponse | null
  onRenameFile?: (oldPath: string, newPath: string) => void
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // The live Crepe instance, for ArrowDown out of the title (⚡ YAZ-888) — the same
  // `focusEditor` the mount runs when the sidebar walk is not standing in the tree (YAZ-921),
  // so the caret lands where a click would put it.
  const crepeRef = useRef<ReturnType<typeof createCrepe> | null>(null)
  const autosave = useAutosave(file.path)
  const { attach, markReloaded, reportConflict, absorbFrontmatterOnly } = autosave
  const reloadRef = useRef<() => void>(() => {})
  /**
   * The drawing wiring (YAZ-879), ONE per host: the preview plugin subscribes to this feed and the
   * modal's save pokes it, so a scene written back re-renders every preview of it in this editor
   * without a remount. Stable identity — a new feed would silently orphan the subscription.
   */
  const drawingFeed = useMemo(() => createDrawingFeed(), [])
  /**
   * The CMD+F wiring (YAZ-968/969), ONE per host on the drawing feed's terms: the engine binds
   * itself to this channel at view creation and the bar below drives it. Stable identity — a new
   * channel would remount the editor and leave the bar talking to nothing.
   */
  const findChannel = useMemo(() => createFindChannel(), [])
  /** The target whose modal is open; the preview's click sets it, close clears it. */
  const [openDrawing, setOpenDrawing] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // Own wrapper per instance so StrictMode's mount/unmount/mount never leaves two editors in the DOM.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)
    const { frontmatter, body } = splitFrontmatter(file.content)
    const storedFolds = storage.getFolds(root, file.path)
    let bulletFoldKeys: readonly string[] = storedFolds.filter((k) => !k.startsWith('h:'))
    let headingFoldKeys: readonly string[] = storedFolds.filter((k) => k.startsWith('h:'))
    // One bucket, two writers (D3): each plugin reports its own keys; the union write means neither
    // can wipe the other's. Heading keys are 'h:'-prefixed by the plugin itself, so they can't collide.
    const writeFolds = () => storage.setFolds(root, file.path, [...bulletFoldKeys, ...headingFoldKeys])
    const crepe = createCrepe({
      root: el,
      defaultValue: body,
      onMarkdownUpdated: (md) => controller?.update(md),
      folding: {
        initialCollapsedKeys: new Set(bulletFoldKeys),
        onCollapsedKeysChange: (keys) => {
          bulletFoldKeys = keys
          writeFolds()
        },
      },
      headingFolding: {
        initialCollapsedKeys: new Set(headingFoldKeys),
        onCollapsedKeysChange: (keys) => {
          headingFoldKeys = keys
          writeFolds()
        },
      },
      zoom: { fileName: basename(file.path) },
      // Stable per window (App-owned): index updates flow INSIDE the sources, never remounting us.
      wikilinks,
      wikilinkCandidates,
      // Wiki-link click navigation (Links C, GRO-2192): plain click → current tab, ⌘ → background
      // tab, unresolved → create (bare targets under App's createBase getter — the Files & Links
      // location setting, C2- GRO-2240; absent → the vault root) then open. Wired only when App
      // threads the background opener — mounts without it keep clicks as plain editing.
      wikilinkNav:
        onOpenFileBackground === undefined
          ? undefined
          : { root, createBase: createBase ?? (() => ''), openCurrent: onOpenFile, openBackground: onOpenFileBackground, onNotice: onNotice ?? (() => undefined) },
      // Standard Markdown links (YAZ-1309) leave through one typed host boundary. The active
      // note path travels with the untouched href so main—not the renderer—owns relative-file
      // resolution, protocol validation, and the choice of OS API.
      markdownLinkNav: {
        open: (href) => api.openLink({ href, sourcePath: file.path }),
        onNotice: onNotice ?? (() => undefined),
      },
      // The slash menu's Drawing row (YAZ-877): this window's root is the only thing the creator
      // needs; failures ride the same passive notice as a failed link create.
      drawing: { create: () => createDrawing(root), onNotice },
      // Drawing previews (YAZ-878): the root is all a preview needs — the embed's own target
      // carries the rest and `readAsset` resolves it. Both live wires are YAZ-879's: the feed
      // the modal's save pokes, and the click that opens that modal.
      drawingPreview: { root, feed: drawingFeed, onOpenDrawing: setOpenDrawing },
      find: findChannel,
    })
    crepeRef.current = crepe
    let controller: ReturnType<typeof attach> | null = null
    let cancelled = false
    const ready = crepe.create().then(() => {
      if (cancelled) return
      controller = attach(() => getMarkdownForSave(crepe), file.mtime, frontmatter, body)
      // An in-app rename carried another window's (or this window's) DIRTY buffer into this
      // path (Links E1, GRO-2194): apply it OVER the fresh disk baseline as an unsaved
      // change, so autosave writes it to the NEW path — the buffer survives the rename.
      const buf = takeRenameBuffer(file.path)
      if (buf !== null && buf.body !== body) {
        setMarkdown(crepe, buf.body)
        controller.update(getMarkdownForSave(crepe))
      }
      // The mount's caret grab (⚡ YAZ-888) YIELDS to the sidebar walk (YAZ-921): a page opened
      // while focus stands on a tree row is a PREVIEW — stealing the caret would strand the
      // arrows mid-walk. Every other door (tabs, wikilinks, boot) still lands in the text.
      if (!(document.activeElement instanceof HTMLElement && document.activeElement.closest('.tree') !== null)) focusEditor(crepe)
    })

    const reload = async () => {
      const fresh = await api.readFile(file.path)
      if (cancelled) return
      const split = splitFrontmatter(fresh.content)
      setMarkdown(crepe, split.body)
      markReloaded(() => getMarkdownForSave(crepe), fresh.mtime, split.frontmatter, split.body)
    }
    reloadRef.current = () => void reload()

    const unsubscribe = watch.subscribe((ev) => {
      if (ev.type !== 'change' || ev.path !== file.path || controller === null) return
      const c = controller
      // On slow filesystems (e.g. NFS vaults) the watcher event for our own write can arrive
      // before the `writeFile` response carries the new mtime; settle the in-flight save first
      // so echo suppression compares against the mtime of the write that caused the event.
      void c.settled().then(async () => {
        if (cancelled) return
        if (ev.mtime === c.mtime) return // echo of our own write
        // A base's property write (GRO-2141) rewrites only the frontmatter block; absorb it
        // silently so unsaved body edits and the caret survive (GRO-2186).
        const fresh = await api.readFile(file.path)
        if (cancelled) return
        if (absorbFrontmatterOnly(fresh.content, fresh.mtime)) return
        // The listener plugin debounces markdownUpdated by 200ms, so pull the live content
        // before deciding whether in-progress typing would be lost by a silent reload.
        c.update(getMarkdownForSave(crepe))
        if (c.dirty) reportConflict(ev.mtime)
        else void reload()
      })
    })

    return () => {
      cancelled = true
      crepeRef.current = null
      unsubscribe()
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [root, file, watch, attach, markReloaded, reportConflict, absorbFrontmatterOnly, wikilinks, wikilinkCandidates, onOpenFile, onOpenFileBackground, onNotice, createBase, drawingFeed, findChannel])

  // The Home guard's fact (⚡ YAZ-888): Home is whatever `[[Home]]` RESOLVES to (🔒 D1, YAZ-821)
  // — the window's own resolver, never a path check, so an aliased or nested Home is still Home.
  // The live-feed idiom the backlinks section uses: subscribe once, re-read on each poke.
  const [homePath, setHomePath] = useState<string | null>(() => wikilinks?.resolve?.(HOME_LINK) ?? null)
  useEffect(() => {
    if (wikilinks === undefined) return
    const read = () => setHomePath(wikilinks.resolve?.(HOME_LINK) ?? null)
    read()
    return wikilinks.subscribe(read)
  }, [wikilinks])

  return (
    <>
      {/* Two chips, one row (YAZ-1081 🔒 D5): the vault-wide sync chip sits immediately LEFT of
          the per-tab save state. The row owns the top-right placement; each chip only styles
          itself. The tab bar is not touched. */}
      <div className="status-chips">
        {sync != null && onSyncNow !== undefined && <SyncIndicator status={sync} onSyncNow={onSyncNow} />}
        <SaveIndicator status={autosave.status} />
      </div>
      {autosave.conflictMtime !== null && (
        <div className="conflict-bar" role="alert">
          <span>File changed on disk.</span>
          <button type="button" onClick={() => reloadRef.current()}>
            Reload
          </button>
          <button type="button" onClick={autosave.keepMine}>
            Keep mine
          </button>
        </div>
      )}
      {/* The scroller holds FIVE stacked blocks, in this order. Block ZERO is the page title
          (⚡ YAZ-888) — the file's own name, React-side and never a ProseMirror node; block ONE is
          the properties panel (⚡ YAZ-883), the note's frontmatter as raw YAML; then the Crepe
          mount; then two blocks of the note's own: the folder page's contents when this page
          carries the flag (YAZ-819, 🔒 D1 — nothing at all when it does not), then "Linked
          mentions" (Links D, GRO-2193). All of it scrolls WITH the note, never in a panel. */}
      <div className="editor-host">
        {/* Title and properties share ONE header row (YAZ-918): the panel sits to
            the title's right and wraps under it when the title runs long. */}
        <div className="page-header">
          <PageTitle
            path={file.path}
            isHome={homePath === file.path}
            onRename={(newPath) => onRenameFile?.(file.path, newPath)}
            onNotice={onNotice}
            onArrowDown={() => {
              const crepe = crepeRef.current
              if (crepe !== null) focusEditor(crepe)
            }}
          />
          {/* Typed rows (⚡ YAZ-884) read the vault-wide declarations App already threads here for
              the contents block below — ONE registry, so a type declared in a row types the same
              column in every folder page's views. */}
          <FrontmatterPanel file={file} root={root} properties={properties} wikilinks={wikilinks} />
        </div>
        <div className="editor-mount" ref={hostRef} />
        {wikilinks !== undefined && (
          <FolderPageContents path={file.path} root={root} source={wikilinks} properties={properties} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} wikilinkCandidates={wikilinkCandidates} createBase={createBase} onNotice={onNotice} fileContent={file.content} />
        )}
        {wikilinks !== undefined && (
          <BacklinksSection path={file.path} source={wikilinks} openCurrent={onOpenFile} openBackground={onOpenFileBackground} />
        )}
      </div>
      {/* CMD+F (YAZ-969) floats OVER that scroller rather than in it: `section.editor` is the
          positioned ancestor, so the bar holds its corner while the note scrolls under it. */}
      <FindBar channel={findChannel} scope="note" hostRef={hostRef} />
      {/* The drawing editor (YAZ-879) — a MODAL over the window, never a node view inside the
          note. Keyed by target so reopening a different drawing is a fresh canvas, and the
          appearance is App's already-resolved one, read once (`appliedTheme`). */}
      {openDrawing !== null && (
        <DrawingModal key={openDrawing} root={root} target={openDrawing} theme={appliedTheme()} feed={drawingFeed} onClose={() => setOpenDrawing(null)} />
      )}
    </>
  )
}
