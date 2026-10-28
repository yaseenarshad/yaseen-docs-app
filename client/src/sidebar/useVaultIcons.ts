/**
 * The window's vaults' one-row icon picks (YAZ-3440 D8, D9), `.yaseendocs/icons.json` through main, with the name
 * rules of the settings (`sidebarIconRules`, the caller's) and whether folders get Material's icon by their name
 * (`folderNames`: Folder icons "By name", YAZ-3554): each vault read when
 * it joins and again on every `icons:changed` for it (an own write's echo, another window's, a sync), dropped
 * when it leaves; the favorites idiom (`useVaultListsHere`). `rowIcons` is the one object the tree reads; it
 * keeps its identity while nothing it holds changed (`buildRowIcons`).
 *
 * `pick` is the one writer: optimistic, then main writes the vault's file. Each pick builds on the latest picks,
 * a pick of the same tick included. A refusal (a malformed file → INVALID_CONFIG) toasts and reads the vault's
 * file again: it holds what did save, a later pick's included. A pick past `MAX_ICON_PATHS` is refused at once,
 * with a toast: main would drop it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rootOfPath } from '@shared/types'
import { MAX_ICON_PATHS, type IconRule, type VaultIcons } from '@shared/vaultIcons'
import { api } from '../api'
import type { NoticeKind } from '../lib/notice'
import { useMaterialIcons } from './materialIcons'
import { buildRowIcons, type RowIcons } from './rowIcons'

type IconsByRoot = Readonly<Record<string, VaultIcons>>

export interface VaultIconsHere {
  rowIcons: RowIcons
  /** Set (`id`) or clear (null) the pick of each path, in the vault that holds it. */
  pick: (paths: readonly string[], id: string | null) => void
}

export function useVaultIcons(roots: readonly string[], rules: readonly IconRule[], folderNames: boolean, onNotice: (message: string, kind?: NoticeKind) => void): VaultIconsHere {
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
      const next: VaultIcons = { paths: { ...(held.current[root]?.paths ?? {}) } }
      for (const p of mine) {
        if (id === null) delete next.paths[p]
        else next.paths[p] = id
      }
      if (Object.keys(next.paths).length > MAX_ICON_PATHS) {
        notice.current(`Can't save the icon: a vault holds ${MAX_ICON_PATHS} icons of its own at most`, 'error')
        continue
      }
      // Now, not at the next render: a second pick in the same tick builds on this one.
      held.current = { ...held.current, [root]: next }
      setByRoot((all) => ({ ...all, [root]: next }))
      api.icons.set(root, next).catch((err: unknown) => {
        if (live.current.includes(root)) load(root)
        notice.current(`Can't save the icon: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    }
  }, [load])

  // Material's tables (YAZ-3470) load after the first render: their landing builds the icons again, once.
  const material = useMaterialIcons()
  const last = useRef<RowIcons | undefined>(undefined)
  const rowIcons = useMemo(() => (last.current = buildRowIcons(byRoot, roots, rules, folderNames, last.current)), [byRoot, roots, rules, folderNames, material]) // eslint-disable-line react-hooks/exhaustive-deps -- `material` is read by buildRowIcons
  return useMemo(() => ({ rowIcons, pick }), [rowIcons, pick])
}
