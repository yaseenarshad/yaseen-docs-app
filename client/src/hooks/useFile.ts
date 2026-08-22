import { useEffect, useState } from 'react'
import type { FileResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'

export type FileState =
  | { status: 'idle' }
  /** `prev` is the previously open file, kept on screen until the new one is ready (no blank flash). */
  | { status: 'loading'; path: string; prev: FileResponse | null }
  | { status: 'ready'; path: string; file: FileResponse }
  | { status: 'error'; path: string; message: string }

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
    api.readFile(path).then(
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
