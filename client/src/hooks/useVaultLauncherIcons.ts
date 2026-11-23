import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

/** Loads macOS Vault App launcher icon data URLs for Vault Switcher and Welcome (YAZ-5967, YAZ-6375). */
export function useVaultLauncherIcons(): { launcherIcons: Record<string, string>; refreshLauncherIcons: () => void } {
  const [launcherIcons, setLauncherIcons] = useState<Record<string, string>>({})
  const refreshLauncherIcons = useCallback(() => {
    if (typeof window.yaseenDocs?.vaultLauncher?.icons !== 'function') return
    void api.vaultLauncher.icons().then(setLauncherIcons, () => undefined)
  }, [])
  useEffect(() => {
    refreshLauncherIcons()
  }, [refreshLauncherIcons])
  return { launcherIcons, refreshLauncherIcons }
}
