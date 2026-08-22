import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileKind } from '@shared/fileKind'
import type { FileResponse } from '@shared/types'
import { api } from '../api'
import { BaseHost } from '../bases/BaseHost'
import { createBaseEmbedRegistry, type BaseEmbedSlot } from './baseEmbed/baseEmbedPlugin'
import { BaseEmbed } from './baseEmbed/BaseEmbed'
import { createCrepe, focusEditor, getMarkdownForSave, setMarkdown } from './createCrepe'
import './outline/outlineFolding.css'
import './outline/bullets.css'
import './outline/zoom.css'
import './outline/guideLines.css'
import './outline/bulletThreading.css'
import { splitFrontmatter } from './frontmatter'
import { SaveIndicator } from './SaveIndicator'
import { useAutosave } from '../hooks/useAutosave'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import { storage } from '../lib/storage'

interface EditorProps {
  /** Open root folder; fold state is persisted per root + file. */
  root: string
  path: string | null
  watch: WatchSource
  /** Bases open their row links through this (GRO-2135); App passes `openFile`. */
  onOpenFile: (path: string) => void
}

export function Editor({ root, path, watch, onOpenFile }: EditorProps) {
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
          <CrepeHost key={file.path} root={root} file={file} watch={watch} onOpenFile={onOpenFile} />
        ))}
    </section>
  )
}

/** Mounts exactly one Crepe instance for `file`; remounted (via `key`) when the path changes. */
function CrepeHost({ root, file, watch, onOpenFile }: { root: string; file: FileResponse; watch: WatchSource; onOpenFile: (path: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const autosave = useAutosave(file.path)
  const { attach, markReloaded, reportConflict, absorbFrontmatterOnly } = autosave
  const reloadRef = useRef<() => void>(() => {})

  // Base embeds (6A, GRO-2145): the plugin keeps one widget slot per `![[X.base]]` paragraph;
  // React stays the owner of what renders inside — a portal per slot, keyed so typing around
  // the embed never remounts it.
  const [embedRegistry] = useState(createBaseEmbedRegistry)
  const [embedSlots, setEmbedSlots] = useState<readonly BaseEmbedSlot[]>([])
  useEffect(() => {
    setEmbedSlots(embedRegistry.list())
    return embedRegistry.subscribe(() => setEmbedSlots(embedRegistry.list()))
  }, [embedRegistry])

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
      baseEmbeds: embedRegistry,
    })
    let controller: ReturnType<typeof attach> | null = null
    let cancelled = false
    const ready = crepe.create().then(() => {
      if (cancelled) return
      controller = attach(() => getMarkdownForSave(crepe), file.mtime, frontmatter, body)
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
      // On slow filesystems (e.g. NFS vaults) the watcher event for our own PUT can arrive
      // before the PUT response carries the new mtime; settle the in-flight save first so
      // echo suppression compares against the mtime of the write that caused the event.
      void c.settled().then(async () => {
        if (cancelled) return
        if (ev.mtime === c.mtime) return // echo of our own PUT
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
  }, [root, file, watch, attach, markReloaded, reportConflict, absorbFrontmatterOnly, embedRegistry])

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
      <div className="editor-host" ref={hostRef} />
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
    </>
  )
}
