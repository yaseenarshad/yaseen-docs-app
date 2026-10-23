import { rootOfPath, type RestoreSessionResult, type StoredTab } from '@shared/types'

/** What a restore needs from App (YAZ-3147 D3): the door, the window's vaults as they stand now, App's `addVault`, the tab strip and the one notice. */
export interface RestoreDeps {
  restore: (id: string) => Promise<RestoreSessionResult>
  /** The window's vaults NOW: read again after each join. */
  roots: () => readonly string[]
  /** App's "Add vault to this window", without its own notice: its rules apply (8 vaults at most, no nesting, a gone folder). */
  addVault: (root: string) => Promise<boolean>
  openStored: (tabs: readonly StoredTab[]) => void
  notify: (text: string) => void
}

/** The one notice of a restore (S20, S22–S24): how many tabs stayed closed. */
export const skippedText = (n: number): string => `${n} ${n === 1 ? 'tab' : 'tabs'} did not open: the file is gone or its vault can't join`

/**
 * "Restore session" (YAZ-3147 D3, S16–S27): main answers the tabs whose file exists and the vaults
 * whose folder exists. A vault that holds such a tab and that the window does not show joins it, one
 * at a time, through `addVault`. Then the tabs that have a vault in the window open in ONE change
 * (`openStored`). A tab whose file is gone, or whose vault cannot join, stays closed, and ONE notice
 * counts those tabs; there is no notice when none stayed closed.
 */
export async function restoreSession(id: string, deps: RestoreDeps): Promise<void> {
  const { tabs, roots, missing } = await deps.restore(id)
  for (const root of roots) {
    // A tab under a vault the window shows needs no join: the window's vault holds it already.
    if (tabs.some((t) => rootOfPath(roots, t.path) === root && rootOfPath(deps.roots(), t.path) === null)) await deps.addVault(root)
  }
  const now = deps.roots()
  const opened = tabs.filter((t) => rootOfPath(now, t.path) !== null)
  deps.openStored(opened)
  const skipped = missing.length + tabs.length - opened.length
  if (skipped > 0) deps.notify(skippedText(skipped))
}
