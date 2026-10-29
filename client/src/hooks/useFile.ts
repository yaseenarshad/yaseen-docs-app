import { useEffect, useState } from 'react'
import type { FileResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { savedFirst } from '../lib/renameContinuity'

export type FileState =
  | { status: 'idle' }
  /** `prev` is the previously open file, kept on screen until the new one is ready (no blank flash). */
  | { status: 'loading'; path: string; prev: FileResponse | null }
  | { status: 'ready'; path: string; file: FileResponse }
  | { status: 'error'; path: string; message: string; prev: FileResponse | null }

/**
 * THE ONE DOOR Markdown and supported text bytes come through: each eligible `Editor` mount reads
 * here, and a read is only a read — opening a file never rewrites it (YAZ-2290).
 * Loads once per path/revision; a revision refresh retains the last readable snapshot. A read waits for a flush of the
 * same path that is under way (`savedFirst`, YAZ-3685 F5).
 */
export function useFile(path: string | null, revision = 0): FileState {
  const [state, setState] = useState<FileState>({ status: 'idle' })
  useEffect(() => {
    if (path === null) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState((current) => ({
      status: 'loading',
      path,
      prev: current.status === 'ready' ? current.file : current.status === 'loading' || current.status === 'error' ? current.prev : null,
    }))
    // A save of this path under way (a switch to a copy starts one) lands first (YAZ-3685 F5): the copy reads the source's
    // latest text, so a bullet typed just now is found. With none, the read starts at once, as before.
    const pending = savedFirst(path)
    ;(pending === null ? api.readFile(path) : pending.then(() => api.readFile(path))).then(
      (file) => {
        if (!cancelled) setState({ status: 'ready', path, file })
      },
      (err: unknown) => {
        if (cancelled) return
        const message = err instanceof BridgeRequestError ? `${err.code}: ${err.message}` : 'Failed to load file'
        setState((current) => ({
          status: 'error',
          path,
          message,
          prev: current.status === 'loading' && current.path === path ? current.prev : null,
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [path, revision])
  return state
}
