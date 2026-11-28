import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import { stripSlash, type SidebarLens, type VaultAppSidebarStart } from '@shared/types'

export interface UseVaultOpenTargetsOptions {
  roots: readonly string[]
  vaults: readonly { wikilinks: { resolve: unknown } }[]
  sidebarCollapsedRef: MutableRefObject<boolean>
  toggleSidebar: () => void
  changeLens: (lens: SidebarLens) => void
  setFocusOnly: (value: string | null) => void
  setFilesOnly: (value: string | null) => void
  revealInFiles: (path: string) => void
  takeInbox: (opts: { root: string }) => void
  openDailyPage: (reveal: boolean, root: string, focusSidebar: boolean) => void
}

/**
 * Handles Vault App / Workspace App open targets (`?open=inbox`, `?open=today`) and per-app Start View
 * (`link:sidebar-start`, YAZ-6682 D5), queuing boot-race pushes until `roots` / wikilinks are ready.
 */
export function useVaultOpenTargets({
  roots,
  vaults,
  sidebarCollapsedRef,
  toggleSidebar,
  changeLens,
  setFocusOnly,
  setFilesOnly,
  revealInFiles,
  takeInbox,
  openDailyPage,
}: UseVaultOpenTargetsOptions) {
  const [todayTarget, setTodayTarget] = useState<string | null>(null)
  const openTarget = useCallback(
    ({ root: targetRoot, target }: { root: string; target: 'inbox' | 'today' }) => {
      if (target === 'inbox') takeInbox({ root: targetRoot })
      else if (target === 'today') setTodayTarget(targetRoot)
    },
    [takeInbox],
  )

  useEffect(() => {
    if (todayTarget === null) return
    const at = roots.findIndex((r) => stripSlash(r) === stripSlash(todayTarget))
    if (at === -1) return setTodayTarget(null)
    if (vaults[at].wikilinks.resolve === null) return
    setTodayTarget(null)
    // YAZ-6503: a Vault App `?open=today` focuses/opens today's page tab without forcing the sidebar open or revealing it in Files.
    openDailyPage(false, roots[at], false)
  }, [todayTarget, roots, vaults, openDailyPage])

  const [pendingSidebarStart, setPendingSidebarStart] = useState<{ root?: string; sidebarStart: VaultAppSidebarStart } | null>(null)
  const applySidebarStart = useCallback((req: { root?: string; sidebarStart: VaultAppSidebarStart }) => {
    setPendingSidebarStart(req)
  }, [])

  useEffect(() => {
    if (pendingSidebarStart === null || roots.length === 0) return
    const { root: targetRoot, sidebarStart } = pendingSidebarStart
    setPendingSidebarStart(null)
    if (sidebarCollapsedRef.current) toggleSidebar()
    changeLens(sidebarStart.tab)
    const preferredRoot = sidebarStart.folderRoot ?? targetRoot
    const base = preferredRoot !== undefined ? (roots.find((r) => stripSlash(r) === stripSlash(preferredRoot)) ?? preferredRoot) : roots[0]
    const relPath = sidebarStart.folderPath?.replace(/^\/+|\/+$/g, '') ?? ''
    const absPath = relPath.length > 0 && base !== undefined ? `${stripSlash(base)}/${relPath}` : null
    if (sidebarStart.onlyFolder === true) {
      if (sidebarStart.tab === 'favorites' || sidebarStart.tab === 'focus') {
        setFilesOnly(null)
        if (sidebarStart.folderKind === 'collection' && sidebarStart.folderId) {
          setFocusOnly(sidebarStart.folderId)
        } else if (sidebarStart.folderKind === 'disk' && absPath !== null) {
          setFocusOnly(absPath)
        } else {
          setFocusOnly(null)
        }
      } else if (sidebarStart.tab === 'files') {
        setFocusOnly(null)
        if (sidebarStart.folderKind === 'disk' && absPath !== null) {
          setFilesOnly(absPath)
        } else {
          setFilesOnly(null)
        }
      } else {
        setFocusOnly(null)
        setFilesOnly(null)
      }
    } else {
      setFocusOnly(null)
      setFilesOnly(null)
      if (sidebarStart.tab === 'files' && sidebarStart.folderKind === 'disk' && absPath !== null) {
        revealInFiles(absPath)
      }
    }
  }, [pendingSidebarStart, roots, sidebarCollapsedRef, toggleSidebar, changeLens, setFocusOnly, setFilesOnly, revealInFiles])

  return { openTarget, applySidebarStart }
}
