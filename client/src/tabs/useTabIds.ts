import { useCallback, useMemo, useRef } from 'react'
import { rootOfPath } from '@shared/types'
import { useAllPathIds, type PathIds, type PathIdsSource } from '../search/showIds'
import type { VaultScope } from '../vault/useVaultScope'
import type { TabIdSpec, TabWidth } from './tabWidth'

export interface TabBarIdProps {
  pathIds: PathIds | undefined
  tabIdSpec: (path: string) => TabIdSpec | undefined
  tabWidth: TabWidth
  inactiveTabWidth: TabWidth
}

/**
 * Per-vault tab ID lookup and global tab width props for `TabBar` (YAZ-6464, YAZ-6485).
 * Covers pages, card files, and folder pages (no drawings). Subscribes to zero vaults when all are Off.
 */
export function useTabIds(roots: readonly string[], vaults: readonly VaultScope[], tabWidth: TabWidth, inactiveTabWidth: TabWidth): TabBarIdProps {
  const live = useRef({ roots, vaults })
  live.current = { roots, vaults }
  const key = vaults.map((v) => `${v.ids?.enabled === true ? v.showIds.settings.tabs : 'off'}:${v.showIds.settings.tabsLayout}`).join(',')
  const sources = useMemo<readonly PathIdsSource[]>(
    () =>
      live.current.vaults.flatMap((v): PathIdsSource[] =>
        v.ids?.enabled === true && v.showIds.settings.tabs !== 'off' ? [{ index: v.wikilinks, form: v.showIds.settings.tabs, includeFolders: true }] : [],
      ),
    // `roots` and `key` track vault order, `ids.enabled`, and per-vault `showIds.tabs`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roots, key],
  )
  const pathIds = useAllPathIds(sources)
  const tabIdSpec = useCallback(
    (path: string): TabIdSpec | undefined => {
      const vaultRoot = rootOfPath(live.current.roots, path)
      if (vaultRoot === null) return undefined
      const scope = live.current.vaults[live.current.roots.indexOf(vaultRoot)]
      if (scope === undefined || scope.ids?.enabled !== true) return undefined
      const form = scope.showIds.settings.tabs
      return form === 'off' ? undefined : { form, layout: scope.showIds.settings.tabsLayout }
    },
    // `key` invalidates whenever any vault changes `ids.enabled`, `showIds.tabs`, or `showIds.tabsLayout`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roots, key],
  )
  return { pathIds, tabIdSpec, tabWidth, inactiveTabWidth }
}
