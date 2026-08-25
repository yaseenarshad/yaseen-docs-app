import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileKind } from '@shared/fileKind'
import type { FileResponse } from '@shared/types'
import { api } from '../api'
import { BaseHost } from '../bases/BaseHost'
import { createBaseCodeBlockSlotStore, type BaseCodeBlockSlot } from './baseCodeBlock/baseCodeBlockView'
import { BaseCodeBlock } from './baseCodeBlock/BaseCodeBlock'
import { createBaseEmbedSlotStore, type BaseEmbedSlot } from './baseEmbed/baseEmbedPlugin'
import { BaseEmbed } from './baseEmbed/BaseEmbed'
import { FolderPageContents } from '../bases/FolderPageContents'
import { createCrepe, focusEditor, getMarkdownForSave, setMarkdown } from './createCrepe'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import './outline/outlineFolding.css'
import './outline/bullets.css'
import './outline/zoom.css'
import './outline/guideLines.css'
import './outline/bulletThreading.css'
import { splitFrontmatter } from '@shared/frontmatter'
import { SaveIndicator } from './SaveIndicator'
import { useAutosave } from '../hooks/useAutosave'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { BacklinksSection } from '../links/BacklinksSection'
import { basename } from '../lib/paths'
import { takeRenameBuffer } from '../lib/renameContinuity'
import { storage } from '../lib/storage'

interface EditorProps {
  /** Open root folder; fold state is persisted per root + file. */
  root: string
  path: string | null
  watch: WatchSource
  /** Bases open their row links through this (GRO-2135); App passes `openFile`. */
  onOpenFile: (path: string) => void
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
}

export function Editor({ root, path, watch, onOpenFile, onOpenFileBackground, onNotice, createBase, wikilinks, wikilinkCandidates }: EditorProps) {
  const state = useFile(path)
  const file = state.status === 'ready' ? state.file : state.status === 'loading' ? state.prev : null
  return (
    <section className="editor">
      {state.status === 'idle' && <p className="editor-msg">Select a file from the sidebar.</p>}
      {state.status === 'loading' && file === null && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="editor-msg editor-msg--error">{state.message}</p>}
      {file !== null &&
        (fileKind(file.path) === 'base' ? (
          <BaseHost key={file.path} root={root} file={file} watch={watch} onOpenFile={onOpenFile} />
        ) : (
          <CrepeHost key={file.path} root={root} file={file} watch={watch} onOpenFile={onOpenFile} onOpenFileBackground={onOpenFileBackground} onNotice={onNotice} createBase={createBase} wikilinks={wikilinks} wikilinkCandidates={wikilinkCandidates} />
        ))}
    </section>
  )
}

/** Mounts exactly one Crepe instance for `file`; remounted (via `key`) when the path changes. */
function CrepeHost({
  root,
  file,
  watch,
  onOpenFile,
  onOpenFileBackground,
  onNotice,
  createBase,
  wikilinks,
  wikilinkCandidates,
}: {
  root: string
  file: FileResponse
  watch: WatchSource
  onOpenFile: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  onNotice?: (message: string) => void
  createBase?: () => string
  wikilinks?: WikilinkResolveSource
  wikilinkCandidates?: WikilinkCandidateSource
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const autosave = useAutosave(file.path)
  const { attach, markReloaded, reportConflict, absorbFrontmatterOnly } = autosave
  const reloadRef = useRef<() => void>(() => {})

  // Base embeds (6A, GRO-2145): the plugin keeps one widget slot per `![[X.base]]` paragraph;
  // React stays the owner of what renders inside — a portal per slot, keyed so typing around
  // the embed never remounts it.
  const [embedStore] = useState(createBaseEmbedSlotStore)
  const [embedSlots, setEmbedSlots] = useState<readonly BaseEmbedSlot[]>([])
  useEffect(() => {
    setEmbedSlots(embedStore.list())
    return embedStore.subscribe(() => setEmbedSlots(embedStore.list()))
  }, [embedStore])

  // `base` code blocks (6B, GRO-2146): same pattern — the node view keeps one slot per
  // ```base fence; a portal per slot renders <BaseCodeBlock> over the block's own YAML.
  const [codeStore] = useState(createBaseCodeBlockSlotStore)
  const [codeSlots, setCodeSlots] = useState<readonly BaseCodeBlockSlot[]>([])
  useEffect(() => {
    setCodeSlots(codeStore.list())
    return codeStore.subscribe(() => setCodeSlots(codeStore.list()))
  }, [codeStore])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // Own wrapper per instance so StrictMode's mount/unmount/mount never leaves two editors in the DOM.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)
    const { frontmatter, body } = splitFrontmatter(file.content)
    const crepe = createCrepe({
      root: el,
      defaultValue: body,
      onMarkdownUpdated: (md) => controller?.update(md),
      folding: {
        initialCollapsedKeys: new Set(storage.getFolds(root, file.path)),
        onCollapsedKeysChange: (keys) => storage.setFolds(root, file.path, keys),
      },
      zoom: { fileName: basename(file.path) },
      baseEmbeds: embedStore,
      baseCodeBlocks: codeStore,
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
    })
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
      focusEditor(crepe)
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
      unsubscribe()
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [root, file, watch, attach, markReloaded, reportConflict, absorbFrontmatterOnly, embedStore, codeStore, wikilinks, wikilinkCandidates, onOpenFile, onOpenFileBackground, onNotice, createBase])

  return (
    <>
      <SaveIndicator status={autosave.status} />
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
      {/* The scroller holds the Crepe mount and, after it, two blocks of the note's own: the
          folder page's contents when this page carries the flag (YAZ-819, 🔒 D1 — nothing at all
          when it does not), then "Linked mentions" (Links D, GRO-2193). Both scroll WITH the note
          instead of floating in a panel. `.base` files get neither: what "mentions" (or contents)
          means for a base is a Bases question — BaseHost stays untouched. */}
      <div className="editor-host">
        <div className="editor-mount" ref={hostRef} />
        {wikilinks !== undefined && (
          <FolderPageContents path={file.path} root={root} source={wikilinks} onOpenFile={onOpenFile} onOpenFileBackground={onOpenFileBackground} />
        )}
        {wikilinks !== undefined && (
          <BacklinksSection path={file.path} source={wikilinks} openCurrent={onOpenFile} openBackground={onOpenFileBackground} />
        )}
      </div>
      {embedSlots.map((slot) =>
        createPortal(
          <BaseEmbed
            key={slot.key}
            root={root}
            watch={watch}
            thisFile={file.path}
            target={slot.target}
            viewName={slot.viewName}
            onOpenFile={onOpenFile}
          />,
          slot.dom,
          slot.key,
        ),
      )}
      {codeSlots.map((slot) =>
        createPortal(
          <BaseCodeBlock
            key={slot.key}
            root={root}
            watch={watch}
            thisFile={file.path}
            text={slot.text}
            onCommit={slot.commit}
            onOpenFile={onOpenFile}
          />,
          slot.dom,
          slot.key,
        ),
      )}
    </>
  )
}
