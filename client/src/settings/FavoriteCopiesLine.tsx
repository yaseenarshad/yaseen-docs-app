/**
 * Settings › Images › Library › "Favorites" (YAZ-4363, extras 3 and 25): how many favorites there are, the size of
 * their own copies (photo copies too), and whether every copy is saved — "all saved" or "3 still saving".
 *
 * Main answers it (`media:favorite-copies`, `library/favoriteCopies.ts`). The line asks again on `media:changed`, and
 * every 2 s while copies are still saving: a copy that lands changes no list, so no push says so.
 */
import { useEffect, useState } from 'react'
import type { FavoriteCopiesStatus } from '@shared/types'
import { api } from '../api'
import { formatBytes } from '../lib/format'

/** How often the line asks again while the backfill still has copies to save. */
export const FAVORITE_COPIES_POLL_MS = 2000

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** The line's text. Pure, so each state is tested on its own. */
export function favoriteCopiesText(s: FavoriteCopiesStatus): string {
  const parts = [plural(s.favorites, 'favorite'), formatBytes(s.bytes)]
  const open: string[] = []
  if (s.saving > 0) open.push(`${s.saving} still saving`)
  if (s.waitingForKey > 0) open.push(`${s.waitingForKey} wait for a Pixabay key`)
  if (s.failed > 0) open.push(`${s.failed} could not be saved yet`)
  parts.push(open.length === 0 ? 'all saved' : open.join(', '))
  return parts.join(' · ')
}

export function FavoriteCopiesLine() {
  const [status, setStatus] = useState<FavoriteCopiesStatus | null>(null)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const ask = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      api.media.favoriteCopies().then(
        (next) => {
          if (!live) return
          setStatus(next)
          if (next.saving > 0) timer = setTimeout(ask, FAVORITE_COPIES_POLL_MS)
        },
        () => undefined,
      )
    }
    ask()
    // A page with no bridge (the dialog's own tests) has no push to hear: the line then asks once.
    let off = () => {}
    try {
      off = api.media.onChanged(ask)
    } catch {
      /* no bridge */
    }
    return () => {
      live = false
      if (timer !== null) clearTimeout(timer)
      off()
    }
  }, [])
  return (
    <p className="settings__path" data-testid="favorite-copies">
      {status === null ? '…' : favoriteCopiesText(status)}
    </p>
  )
}
