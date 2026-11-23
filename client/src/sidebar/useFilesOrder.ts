/**
 * The Files tab's Manual order (YAZ-5916 D1) of the window's vaults: `.yaseendocs/files-order.<mac id>.json` through
 * main (`filesOrder.*`, the newest file of any Mac is the order), read only while Files sorts by hand (`on`): each
 * vault when it joins, and again on every `filesOrder:changed` for it (an own write's echo, another window's, a sync).
 * The useVaultIcons idiom.
 *
 * `orders` is one Map of every folder's order by absolute path; it keeps its identity while nothing in it changed, so
 * the memoised tree levels draw nothing again. `save` is optimistic: the tree takes the new order at once (the drop's
 * settle waits for it, `rowLift.ts`), then main writes this Mac's file; a refusal toasts and reads the file again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rootOfPath } from '@shared/types'
import { DEFAULT_FILES_SORT, type FilesOrderState, type FilesSort } from '@shared/filesOrder'
import { api } from '../api'
import type { NoticeKind } from '../lib/notice'

type ByRoot = Readonly<Record<string, FilesOrderState>>

export interface FilesOrderHere {
  orders: ReadonlyMap<string, readonly string[]>
  /** Write one folder's order of item names. */
  save: (dir: string, names: string[]) => void
  /** Write this Mac's Files sort in each vault (Q4): the phone sorts its tree by it (D4). */
  setSort: (sort: FilesSort) => void
}

export function useFilesOrder(roots: readonly string[], on: boolean, onNotice: (message: string, kind?: NoticeKind) => void): FilesOrderHere {
  const [byRoot, setByRoot] = useState<ByRoot>({})
  const held = useRef(byRoot)
  held.current = byRoot
  const live = useRef(roots)
  live.current = roots
  const notice = useRef(onNotice)
  notice.current = onNotice

  const load = useCallback((root: string) => {
    void api.filesOrder.get(root).then(
      (order) => {
        if (live.current.includes(root)) setByRoot((prev) => ({ ...prev, [root]: order }))
      },
      () => undefined,
    )
  }, [])

  const rootsKey = roots.join('\n')
  useEffect(() => {
    if (!on) return
    for (const root of live.current) if (held.current[root] === undefined) load(root)
    setByRoot((prev) => {
      const kept = Object.fromEntries(Object.entries(prev).filter(([root]) => live.current.includes(root)))
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept
    })
  }, [rootsKey, on, load])
  useEffect(() => {
    if (!on) return
    return api.filesOrder.onChanged((c) => {
      if (live.current.includes(c.root)) load(c.root)
    })
  }, [on, load])

  const save = useCallback(
    (dir: string, names: string[]) => {
      const root = rootOfPath(live.current, dir)
      if (root === null) return
      const now = held.current[root] ?? { sort: DEFAULT_FILES_SORT, folders: {} }
      const next: FilesOrderState = { ...now, folders: { ...now.folders, [dir]: names } }
      held.current = { ...held.current, [root]: next }
      setByRoot((all) => ({ ...all, [root]: next }))
      api.filesOrder.setFolder(root, dir, names).catch((err: unknown) => {
        if (live.current.includes(root)) load(root)
        notice.current(`Can't save the order: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    },
    [load],
  )

  const setSort = useCallback((sort: FilesSort) => {
    for (const root of live.current) api.filesOrder.setSort(root, { by: sort.by, reverse: sort.reverse }).catch(() => undefined)
  }, [])

  const orders = useMemo(() => {
    const map = new Map<string, readonly string[]>()
    for (const root of roots) for (const [dir, names] of Object.entries(byRoot[root]?.folders ?? {})) map.set(dir, names)
    return map
  }, [byRoot, rootsKey]) // eslint-disable-line react-hooks/exhaustive-deps -- `roots` by its key

  return useMemo(() => ({ orders, save, setSort }), [orders, save, setSort])
}
