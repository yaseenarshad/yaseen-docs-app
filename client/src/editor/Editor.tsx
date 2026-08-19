import { useEffect, useRef } from 'react'
import type { FileResponse } from '@shared/types'
import { api } from '../api'
import { createCrepe, focusEditor, getMarkdownForSave, setMarkdown } from './createCrepe'
import './outline/outlineFolding.css'
import './outline/bullets.css'
import { splitFrontmatter } from './frontmatter'
import { SaveIndicator } from './SaveIndicator'
import { useAutosave } from '../hooks/useAutosave'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { storage } from '../lib/storage'

interface EditorProps {
  /** Open root folder; fold state is persisted per root + file. */
  root: string
  path: string | null
  watch: WatchSource
}

export function Editor({ root, path, watch }: EditorProps) {
  const state = useFile(path)
  const file = state.status === 'ready' ? state.file : state.status === 'loading' ? state.prev : null
  return (
    <section className="editor">
      {state.status === 'idle' && <p className="editor-msg">Select a file from the sidebar.</p>}
      {state.status === 'loading' && file === null && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="editor-msg editor-msg--error">{state.message}</p>}
      {file !== null && <CrepeHost key={file.path} root={root} file={file} watch={watch} />}
    </section>
  )
}

/** Mounts exactly one Crepe instance for `file`; remounted (via `key`) when the path changes. */
function CrepeHost({ root, file, watch }: { root: string; file: FileResponse; watch: WatchSource }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const autosave = useAutosave(file.path)
  const { attach, markReloaded, reportConflict } = autosave
  const reloadRef = useRef<() => void>(() => {})

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
    })
    let controller: ReturnType<typeof attach> | null = null
    let cancelled = false
    const ready = crepe.create().then(() => {
      if (cancelled) return
      controller = attach(crepe, file.mtime, frontmatter)
      focusEditor(crepe)
    })

    const reload = async () => {
      const fresh = await api.readFile(file.path)
      if (cancelled) return
      const split = splitFrontmatter(fresh.content)
      setMarkdown(crepe, split.body)
      markReloaded(crepe, fresh.mtime, split.frontmatter)
    }
    reloadRef.current = () => void reload()

    const unsubscribe = watch.subscribe((ev) => {
      if (ev.type !== 'change' || ev.path !== file.path || controller === null) return
      const c = controller
      // On slow filesystems (e.g. NFS vaults) the watcher event for our own PUT can arrive
      // before the PUT response carries the new mtime; settle the in-flight save first so
      // echo suppression compares against the mtime of the write that caused the event.
      void c.settled().then(() => {
        if (cancelled) return
        if (ev.mtime === c.mtime) return // echo of our own PUT
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
  }, [root, file, watch, attach, markReloaded, reportConflict])

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
    </>
  )
}
