import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * This window's id (`WindowEntry.id`), which the tab board's stored places are keyed by (YAZ-3343 D1). `storage`
 * keeps it private, so it is asked of main ONCE per window and held here; '' until the answer lands, and
 * where the bridge cannot answer (a test with no `window.identity`): a board with no id stores no place.
 */
let id = ''
let asked: Promise<string> | null = null

export function loadThisWindowId(): Promise<string> {
  asked ??= Promise.resolve()
    .then(() => api.window.identity())
    .then(
      (identity) => (id = identity.id),
      () => id,
    )
  return asked
}

export function useThisWindowId(): string {
  const [now, setNow] = useState(id)
  useEffect(() => {
    let live = true
    void loadThisWindowId().then((answer) => live && setNow(answer))
    return () => {
      live = false
    }
  }, [])
  return now
}
