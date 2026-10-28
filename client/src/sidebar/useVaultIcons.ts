/**
 * The window's vaults' one-row icon picks (YAZ-3440 A, B), `.yaseendocs/icons.json` through main, with the name
 * rules of the settings (`sidebarIconRules`, the caller's): each vault read when
 * it joins and again on every `icons:changed` for it (an own write's echo, another window's, a sync), dropped
 * when it leaves; the favorites idiom (`useVaultListsHere`). `rowIcons` is the one object the tree reads; it
 * keeps its identity while nothing it holds changed (`buildRowIcons`).
 *
 * `save` is the one writer: optimistic, then main writes the vault's file; a refusal (a malformed file →
 * INVALID_CONFIG) puts the vault's icons back and toasts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rootOfPath } from '@shared/types'
import type { IconRule, VaultIcons } from '@shared/vaultIcons'
import { api } from '../api'
import type { NoticeKind } from '../lib/notice'
import { buildRowIcons, type RowIcons } from './rowIcons'

type IconsByRoot = Readonly<Record<string, VaultIcons>>

export interface VaultIconsHere {
  rowIcons: RowIcons
  /** Set (`id`) or clear (null) the pick of each path, in the vault that holds it. */
  pick: (paths: readonly string[], id: string | null) => void
}

export function useVaultIcons(roots: readonly string[], rules: readonly IconRule[], onNotice: (message: string, kind?: NoticeKind) => void): VaultIconsHere {
  const [byRoot, setByRoot] = useState<IconsByRoot>({})
  const held = useRef(byRoot)
  held.current = byRoot
  const live = useRef(roots)
  live.current = roots
  const notice = useRef(onNotice)
  notice.current = onNotice

  const load = useCallback((root: string) => {
    void api.icons.get(root).then(
      (icons) => {
        if (live.current.includes(root)) setByRoot((prev) => ({ ...prev, [root]: icons }))
      },
      () => undefined,
    )
  }, [])

  // Each vault once, when it joins; one that left leaves.
  const rootsKey = roots.join('\n')
  useEffect(() => {
    for (const root of live.current) if (held.current[root] === undefined) load(root)
    setByRoot((prev) => {
      const kept = Object.fromEntries(Object.entries(prev).filter(([root]) => live.current.includes(root)))
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept
    })
  }, [rootsKey, load])
  useEffect(
    () =>
      api.icons.onChanged((c) => {
        if (live.current.includes(c.root)) load(c.root)
      }),
    [load],
  )

  const pick = useCallback((paths: readonly string[], id: string | null) => {
    const byVault = new Map<string, string[]>()
    for (const p of paths) {
      const root = rootOfPath(live.current, p)
      if (root !== null && root !== p) byVault.set(root, [...(byVault.get(root) ?? []), p])
    }
    for (const [root, mine] of byVault) {
      const before = held.current[root] ?? { paths: {} }
      const next: VaultIcons = { paths: { ...before.paths } }
      for (const p of mine) {
        if (id === null) delete next.paths[p]
        else next.paths[p] = id
      }
      setByRoot((all) => ({ ...all, [root]: next }))
      api.icons.set(root, next).catch((err: unknown) => {
        if (live.current.includes(root)) setByRoot((all) => ({ ...all, [root]: before }))
        notice.current(`Can't save the icon: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    }
  }, [])

  const last = useRef<RowIcons | undefined>(undefined)
  const rowIcons = useMemo(() => (last.current = buildRowIcons(byRoot, roots, rules, last.current)), [byRoot, roots, rules])
  return useMemo(() => ({ rowIcons, pick }), [rowIcons, pick])
}
