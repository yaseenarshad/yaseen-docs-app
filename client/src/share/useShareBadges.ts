/**
 * The sidebar's shared-board marks (Draw's YAZ-1799 D14, YAZ-1890; YAZ-3040): `path → { tone, title }`
 * for every board in the shares.json of every vault the window shows (YAZ-2602: one sidebar, several vaults). The title is the Share dialog's own status line; red
 * (`error`) when the last automatic update failed or the link is stale (its copy is gone from
 * Cloudflare). A rename or move re-keys the record in main, whose `share:changed` refetches here.
 *
 * The list is fetched on mount and on `share:changed`, WITHOUT the live check (`check: false`), so a
 * save costs no network call per share; only Settings asks the Worker. The local upload
 * scheduler's changes (a save waiting to upload) just re-derive.
 *
 * The SAME map comes back while no mark changed (YAZ-3044 A29): `Tree` compares `shareBadges` by
 * identity, and a new map would render every memoised level of the tree again.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShareListEntry } from '@shared/types'
import { api } from '../api'
import type { ShareBadge } from '../sidebar/Tree'
import { isPending, onLiveShareChange } from './liveShare'
import { liveLine } from './shareText'

export function useShareBadges(roots: readonly string[]): ReadonlyMap<string, ShareBadge> {
  const [rows, setRows] = useState<readonly ShareListEntry[]>([])
  const [localTick, setLocalTick] = useState(0)
  // One key for the list of vaults, so a render that hands a new array of the same vaults refetches nothing.
  const key = roots.join('\0')
  useEffect(() => {
    setRows([])
    const vaults = key === '' ? [] : key.split('\0')
    let live = true
    let seq = 0
    const refresh = async () => {
      const mine = ++seq
      // No marks is the honest fallback for a vault whose list cannot be read; the others still show theirs.
      const lists = await Promise.all(vaults.map((root) => api.share.list(root, false).catch(() => [] as ShareListEntry[])))
      if (live && mine === seq) setRows(lists.flat())
    }
    void refresh()
    const offMain = api.share.onChanged(() => void refresh())
    const offLocal = onLiveShareChange(() => setLocalTick((t) => t + 1))
    return () => {
      live = false
      offMain()
      offLocal()
    }
  }, [key])

  const last = useRef<{ sig: string; badges: ReadonlyMap<string, ShareBadge> } | null>(null)
  return useMemo(() => {
    const now = Date.now()
    const badges = new Map<string, ShareBadge>()
    for (const row of rows) {
      const line = liveLine(row, isPending(row.path), now)
      // No "· 5 minutes ago" on a tooltip nothing re-renders; the dialog carries the time.
      badges.set(row.path, { tone: line.tone === 'error' ? 'error' : 'ok', title: `Shared · ${line.tone === 'ok' ? 'Up to date' : line.text}` })
    }
    const sig = [...badges].map(([path, b]) => `${path}\0${b.tone}\0${b.title}`).join('\n')
    if (last.current?.sig !== sig) last.current = { sig, badges }
    return last.current.badges
  }, [rows, localTick])
}
