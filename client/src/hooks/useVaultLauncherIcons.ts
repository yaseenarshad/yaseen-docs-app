import { useCallback, useEffect, useState } from 'react'
import { sameVaults } from '@shared/types'
import { api } from '../api'
import { storage } from '../lib/storage'

/** Loads macOS Vault and Workspace launcher icon data URLs for Vault Switcher and Welcome (YAZ-5967, YAZ-6375). */
export function useVaultLauncherIcons(): {
  launcherIcons: Record<string, string>
  workspaceIcons: Record<string, string>
  refreshLauncherIcons: () => void
} {
  const [launcherIcons, setLauncherIcons] = useState<Record<string, string>>({})
  const [workspaceIcons, setWorkspaceIcons] = useState<Record<string, string>>({})
  const refreshLauncherIcons = useCallback(() => {
    if (typeof window.yaseenDocs?.vaultLauncher?.icons === 'function') {
      void api.vaultLauncher.icons().then(setLauncherIcons, () => undefined)
    }
    if (typeof window.yaseenDocs?.vaultLauncher?.workspaceIcons === 'function') {
      void api.vaultLauncher.workspaceIcons().then(setWorkspaceIcons, () => undefined)
    }
  }, [])
  useEffect(() => {
    refreshLauncherIcons()
  }, [refreshLauncherIcons])
  return { launcherIcons, workspaceIcons, refreshLauncherIcons }
}

/** Computes the `workspaceLauncher` SettingsCtx entry when `roots` matches a saved Workspace on macOS. */
export function workspaceLauncherCtx(
  roots: readonly string[],
  onChanged?: () => void,
): { workspaceId: string; defaultName: string; onChanged?: () => void } | undefined {
  if (roots.length < 2 || !/Mac/i.test(navigator.platform) || typeof window.yaseenDocs?.vaultLauncher?.workspaceStatus !== 'function') return undefined
  const set = storage.getVaultSets().find((s) => sameVaults(roots, s.roots))
  return set === undefined ? undefined : { workspaceId: set.id, defaultName: set.name, onChanged }
}
