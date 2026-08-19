import { useCallback, useEffect, useRef, useState } from 'react'
import type { Crepe } from '@milkdown/crepe'
import { api, ApiRequestError } from '../api'
import { getMarkdownForSave } from '../editor/createCrepe'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'

export interface AutosaveHandle {
  status: SaveStatus
  /** Disk mtime reported by a 409 / watcher while the editor had unsaved changes; null when no conflict. */
  conflictMtime: number | null
  /** Attach to a created Crepe instance; returns the Autosave controller. */
  attach: (crepe: Crepe, mtime: number, frontmatter: string) => Autosave
  /** Overwrite the on-disk version with the editor content. */
  keepMine: () => void
  /** Called after the editor content was replaced from disk. */
  markReloaded: (crepe: Crepe, mtime: number, frontmatter: string) => void
  /** Report an external change detected by the watcher while dirty. */
  reportConflict: (diskMtime: number) => void
}

/** Owns the Autosave controller for one open file (`path`): debounce, flush on unmount/beforeunload. */
export function useAutosave(path: string): AutosaveHandle {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflictMtime, setConflictMtime] = useState<number | null>(null)
  const ref = useRef<{ autosave: Autosave; crepe: Crepe } | null>(null)
  /** Raw frontmatter block re-prepended on every save; updated when the file is reloaded from disk. */
  const frontmatterRef = useRef('')

  const attach = useCallback(
    (crepe: Crepe, mtime: number, frontmatter: string) => {
      frontmatterRef.current = frontmatter
      const autosave = new Autosave({
        markdown: getMarkdownForSave(crepe),
        mtime,
        delayMs: 500,
        save: async (content, expectedMtime, keepalive) => {
          try {
            return await api.writeFile({ path, content: frontmatterRef.current + content, expectedMtime }, keepalive)
          } catch (err) {
            if (err instanceof ApiRequestError && err.mtime !== undefined) throw new SaveConflict(err.mtime)
            throw err
          }
        },
        onStatus: setStatus,
        onConflict: setConflictMtime,
      })
      ref.current = { autosave, crepe }
      setStatus('saved')
      setConflictMtime(null)
      return autosave
    },
    [path],
  )

  const flushNow = useCallback((keepalive: boolean) => {
    const s = ref.current
    if (s === null) return
    // The listener plugin debounces markdownUpdated by 200ms; pull the live content so nothing is lost.
    s.autosave.update(getMarkdownForSave(s.crepe))
    void s.autosave.flush(keepalive)
  }, [])

  useEffect(() => {
    const onUnload = () => flushNow(true)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      flushNow(false)
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

  const markReloaded = useCallback((crepe: Crepe, mtime: number, frontmatter: string) => {
    frontmatterRef.current = frontmatter
    ref.current?.autosave.reset(getMarkdownForSave(crepe), mtime)
    setConflictMtime(null)
  }, [])

  return { status, conflictMtime, attach, keepMine, markReloaded, reportConflict: setConflictMtime }
}
