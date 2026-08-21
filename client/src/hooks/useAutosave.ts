import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiRequestError } from '../api'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'

export interface AutosaveHandle {
  status: SaveStatus
  /** Disk mtime reported by a CONFLICT / watcher while the editor had unsaved changes; null when no conflict. */
  conflictMtime: number | null
  /**
   * Start autosaving; returns the Autosave controller. `getContent` returns the current body
   * markdown (without frontmatter) and is re-read on every flush so nothing in flight is lost.
   */
  attach: (getContent: () => string, mtime: number, frontmatter: string) => Autosave
  /** Overwrite the on-disk version with the editor content. */
  keepMine: () => void
  /** Called after the editor content was replaced from disk; `getContent` returns the reloaded body. */
  markReloaded: (getContent: () => string, mtime: number, frontmatter: string) => void
  /** Report an external change detected by the watcher while dirty. */
  reportConflict: (diskMtime: number) => void
}

/** Owns the Autosave controller for one open file (`path`): debounce, flush on unmount and window close. */
export function useAutosave(path: string): AutosaveHandle {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflictMtime, setConflictMtime] = useState<number | null>(null)
  const ref = useRef<{ autosave: Autosave; getContent: () => string } | null>(null)
  /** Raw frontmatter block re-prepended on every save; updated when the file is reloaded from disk. */
  const frontmatterRef = useRef('')

  const attach = useCallback(
    (getContent: () => string, mtime: number, frontmatter: string) => {
      frontmatterRef.current = frontmatter
      const autosave = new Autosave({
        markdown: getContent(),
        mtime,
        delayMs: 500,
        save: async (content, expectedMtime) => {
          try {
            return await api.writeFile({ path, content: frontmatterRef.current + content, expectedMtime })
          } catch (err) {
            if (err instanceof ApiRequestError && err.mtime !== undefined) throw new SaveConflict(err.mtime)
            throw err
          }
        },
        onStatus: setStatus,
        onConflict: setConflictMtime,
      })
      ref.current = { autosave, getContent }
      setStatus('saved')
      setConflictMtime(null)
      return autosave
    },
    [path],
  )

  const flushNow = useCallback(() => {
    const s = ref.current
    if (s === null) return
    // The listener plugin debounces markdownUpdated by 200ms; pull the live content so nothing is lost.
    s.autosave.update(s.getContent())
    void s.autosave.flush()
  }, [])

  useEffect(() => {
    // The close/quit handshake (GRO-2160): main holds the window open until this settles (5s cap in main).
    const offFlush = window.yaseenDocs.window.onFlush(async () => {
      const s = ref.current
      if (s === null) return
      s.autosave.update(s.getContent())
      await s.autosave.flush()
    })
    return () => {
      offFlush()
      flushNow()
      ref.current?.autosave.dispose()
      ref.current = null
    }
  }, [flushNow])

  const keepMine = useCallback(() => {
    const s = ref.current
    if (s === null || conflictMtime === null) return
    setConflictMtime(null)
    void s.autosave.adopt(conflictMtime)
  }, [conflictMtime])

  const markReloaded = useCallback((getContent: () => string, mtime: number, frontmatter: string) => {
    frontmatterRef.current = frontmatter
    ref.current?.autosave.reset(getContent(), mtime)
    setConflictMtime(null)
  }, [])

  return { status, conflictMtime, attach, keepMine, markReloaded, reportConflict: setConflictMtime }
}
