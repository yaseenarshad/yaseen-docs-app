import { useEffect, useState } from 'react'
import { fileKind } from '@shared/fileKind'
import type { FileResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { migrateFolderBody } from '../views/migrateFolderBody'

export type FileState =
  | { status: 'idle' }
  /** `prev` is the previously open file, kept on screen until the new one is ready (no blank flash). */
  | { status: 'loading'; path: string; prev: FileResponse | null }
  | { status: 'ready'; path: string; file: FileResponse }
  | { status: 'error'; path: string; message: string }

/**
 * THE ONE DOOR a file comes through (YAZ-919): every tab open, sidebar click and wikilink click
 * ends in an `Editor` mount, and every `Editor` mount reads its bytes here — so the folder-page
 * body migration is asked here, ONCE, and no surface has to remember to run it.
 *
 * The migrated bytes go to disk BEFORE the editor sees them, and the editor is handed the mtime
 * of THAT write: autosave attaches to `file.mtime` and suppresses the watcher echo by comparing
 * against it, so a stale one would surface our own write as a "file changed on disk" conflict.
 * A failed write hands back the file exactly as read — nothing is lost, the body is still there,
 * and the next open tries again. Unchanged is free: no write, no second read.
 */
async function migrateOnOpen(file: FileResponse): Promise<FileResponse> {
  if (fileKind(file.path) !== 'markdown') return file
  const { content, changed } = migrateFolderBody(file.content)
  if (!changed) return file
  try {
    const written = await api.writeFile({ path: file.path, content, expectedMtime: file.mtime })
    return { ...file, content, mtime: written.mtime, size: written.size }
  } catch {
    return file
  }
}

/** Loads a file once per `path` (reloads after an external change are handled by the editor itself). */
export function useFile(path: string | null): FileState {
  const [state, setState] = useState<FileState>({ status: 'idle' })
  useEffect(() => {
    if (path === null) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState((s) => ({ status: 'loading', path, prev: s.status === 'ready' ? s.file : s.status === 'loading' ? s.prev : null }))
    api.readFile(path).then(migrateOnOpen).then(
      (file) => {
        if (!cancelled) setState({ status: 'ready', path, file })
      },
      (err: unknown) => {
        if (cancelled) return
        const message = err instanceof BridgeRequestError ? `${err.code}: ${err.message}` : 'Failed to load file'
        setState({ status: 'error', path, message })
      },
    )
    return () => {
      cancelled = true
    }
  }, [path])
  return state
}
