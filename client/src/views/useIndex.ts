import { useCallback, useEffect, useRef, useState } from 'react'
import { fileKind } from '@shared/fileKind'
import { IDS_FILE } from '@shared/noteId'
import type { IndexRecord, IndexResponse, WatchEvent } from '@shared/types'
import { api } from '../api'
import type { WatchSource } from '../hooks/useWatch'

export type IndexStatus = 'pending' | 'ready' | 'error'

export interface IndexState {
  status: IndexStatus
  /** `[]` until the first fetch resolves (and after a failed one). */
  records: IndexRecord[]
  /** The same snapshot's folder settings records (YAZ-2290 D8); `[]` whenever `records` is. */
  folders: IndexRecord[]
  /** Does this vault give its notes IDs (YAZ-2523 🔒 V5)? false until the first fetch resolves. */
  ids: boolean
  /** What a yes would write, while the vault has not answered (`IndexResponse.ask`). */
  ask: IndexResponse['ask']
  /** Fetch failure message; null unless `status` is 'error'. */
  error: string | null
  /** Refetch immediately, skipping the debounce. */
  refresh: () => void
}

/** Events settle before the index is re-read, so a burst (a paste of files) costs one fetch. */
const REFETCH_DEBOUNCE_MS = 300

/** Could this watch event change what the index holds? Markdown notes are the only records. */
function touchesIndex(ev: WatchEvent): boolean {
  switch (ev.type) {
    case 'ready': // late join / (re)connect: refetch what may have been missed
    case 'unlinkDir': // a removed directory may have held notes
      return true
    case 'add':
    case 'change':
    case 'unlink':
      return fileKind(ev.path) === 'markdown'
    default:
      return false
  }
}

/**
 * The vault index behind every view (GRO-2129): one `api.index(root)` fetch per root
 * over the bridge, kept fresh by the shared watch fan-out. Refetches keep the previous
 * records on screen (`status` stays 'ready') until the new snapshot lands. A change to the
 * vault's `ids.json` refetches at once: the same notes are handed out as the other kind of vault.
 */
export function useIndex(root: string, watch: WatchSource): IndexState {
  const [status, setStatus] = useState<IndexStatus>('pending')
  const [records, setRecords] = useState<IndexRecord[]>([])
  const [folders, setFolders] = useState<IndexRecord[]>([])
  const [ids, setIds] = useState(false)
  const [ask, setAsk] = useState<IndexResponse['ask']>()
  const [error, setError] = useState<string | null>(null)
  // Bumped on every fetch and on unmount/root change: only the latest fetch may commit.
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    const gen = ++generation.current
    api.index(root).then(
      (res) => {
        if (gen !== generation.current) return
        setRecords(res.records)
        setFolders(res.folders)
        setIds(res.ids)
        setAsk(res.ask)
        setStatus('ready')
        setError(null)
      },
      (err: unknown) => {
        if (gen !== generation.current) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      },
    )
  }, [root])

  useEffect(() => {
    setStatus('pending')
    setRecords([])
    setFolders([])
    setIds(false)
    setAsk(undefined)
    setError(null)
    refresh()
    const unsubscribe = watch.subscribe((ev) => {
      if (!touchesIndex(ev)) return
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        refresh()
      }, REFETCH_DEBOUNCE_MS)
    })
    const unsubscribeIds = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === IDS_FILE) refresh()
    })
    return () => {
      generation.current++
      unsubscribe()
      unsubscribeIds()
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
  }, [root, watch, refresh])

  return { status, records, folders, ids, ask, error, refresh }
}
