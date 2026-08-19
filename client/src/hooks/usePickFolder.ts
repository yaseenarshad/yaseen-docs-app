import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

interface UsePickFolderOptions {
  onPicked: (path: string) => void
  /** The native dialog is unavailable (non-macOS, or the request failed): show the in-app picker. */
  onFallback: () => void
}

/**
 * "Open folder" flow: native Finder dialog first (POST /api/pick-folder), in-app picker as
 * fallback. Only one native dialog is ever in flight; `pick()` is a no-op while it is open.
 */
export function usePickFolder({ onPicked, onFallback }: UsePickFolderOptions) {
  const [picking, setPicking] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const pick = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    setPicking(true)
    api.pickFolder().then(
      (res) => {
        if (mounted.current && 'path' in res) onPicked(res.path)
      },
      () => {
        if (mounted.current) onFallback()
      },
    ).finally(() => {
      inFlight.current = false
      if (mounted.current) setPicking(false)
    })
  }, [onPicked, onFallback])

  return { pick, picking }
}
