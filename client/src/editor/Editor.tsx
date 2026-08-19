import { useEffect, useRef } from 'react'
import type { FileResponse } from '@shared/types'
import { createCrepe } from './createCrepe'
import { splitFrontmatter } from './frontmatter'
import { SaveIndicator } from './SaveIndicator'
import { useAutosave } from '../hooks/useAutosave'
import { useFile } from '../hooks/useFile'

interface EditorProps {
  path: string | null
}

export function Editor({ path }: EditorProps) {
  const state = useFile(path)
  const file = state.status === 'ready' ? state.file : null
  return (
    <section className="editor">
      {state.status === 'idle' && <p className="editor-msg">Select a file from the sidebar.</p>}
      {state.status === 'loading' && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="editor-msg editor-msg--error">{state.message}</p>}
      {file !== null && <CrepeHost key={file.path} file={file} />}
    </section>
  )
}

/** Mounts exactly one Crepe instance for `file`; remounted (via `key`) when the path changes. */
function CrepeHost({ file }: { file: FileResponse }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const autosave = useAutosave(file.path)
  const { attach } = autosave

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // Own wrapper per instance so StrictMode's mount/unmount/mount never leaves two editors in the DOM.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)
    const { frontmatter, body } = splitFrontmatter(file.content)
    const crepe = createCrepe({ root: el, defaultValue: body, onMarkdownUpdated: (md) => controller?.update(md) })
    let controller: ReturnType<typeof attach> | null = null
    let cancelled = false
    const ready = crepe.create().then(() => {
      if (!cancelled) controller = attach(crepe, file.mtime, frontmatter)
    })
    return () => {
      cancelled = true
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [file, attach])

  return (
    <>
      <SaveIndicator status={autosave.status} />
      <div className="editor-host" ref={hostRef} />
    </>
  )
}
