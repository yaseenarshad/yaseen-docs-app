import { useEffect, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink, WikilinkResolveSource } from './wikilinkPlugin'

/** The window's index snapshot as a component holds it: all of it, never half. A null resolver is no snapshot yet. */
export interface IndexFeed {
  records: readonly IndexRecord[]
  folders: readonly IndexRecord[]
  resolve: ResolveLink | null
}

/**
 * The source's snapshot, live: subscribe once, re-read the whole feed on each poke. An unchanged
 * snapshot keeps the previous object, so index churn that moved nothing costs no render.
 */
export function useIndexFeed(source: WikilinkResolveSource): IndexFeed {
  const [feed, setFeed] = useState<IndexFeed>(() => ({ records: source.records, folders: source.folders, resolve: source.resolve }))
  useEffect(() => {
    const read = () =>
      setFeed((prev) =>
        prev.records === source.records && prev.folders === source.folders && prev.resolve === source.resolve
          ? prev
          : { records: source.records, folders: source.folders, resolve: source.resolve },
      )
    read()
    return source.subscribe(read)
  }, [source])
  return feed
}
