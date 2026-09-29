import type { GithubSyncStatus } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { detectRepo } from '../git/detect'
import { resolveGit } from '../git/exec'
import { createGitSync, type GitSyncManager } from '../git/manager'
import { syncPass } from '../git/sync'
import type { Store } from '../store'
import { readConfig, subscribeConfig, writeConfig } from '../vaultConfig'
import { broadcastAll, rootsOf } from './broadcast'
import { handle } from './envelope'

/**
 * The `github.*` half of `window.yaseenDocs` (YAZ-1081, 2C) — and the ONE place the Electron-free
 * sync core (`../git/`) is handed its production edges. `createGitSync` takes every edge as an
 * injected function, so this module is the whole seam: the vault-local config store, the shared
 * vault watcher, the status broadcast, and the pass itself.
 *
 * Which roots exist is `rootsOf(AppState)` (`broadcast.ts`, the list `syncPerRoot` also reads) —
 * the manager subscribes, times and drops per root off that one list, so a closed vault goes
 * completely silent.
 */

/**
 * Read-only facts for a root the manager is NOT managing (sync off): the settings panel still
 * wants to show which remote and branch it WOULD sync to. Never a failure — a machine with no git
 * binary, or a folder that is not a repo, is an ordinary machine and an ordinary folder, so the
 * answer is a plain `off` either way.
 */
async function inspect(root: string): Promise<GithubSyncStatus> {
  const bin = await resolveGit()
  if (bin === null) return { root, state: 'off' }
  const facts = await detectRepo(bin, root)
  return { root, state: 'off', repo: { remoteUrl: facts.remoteUrl, branch: facts.branch } }
}

/**
 * Registers the three invokes and starts the manager on the current open roots. Returns the
 * manager because `main/index.ts` owns the three triggers no renderer can send: window focus,
 * OS wake, and the final flush on quit.
 */
export function registerGithubIpc(store: Store): GitSyncManager {
  const manager = createGitSync({
    readConfig,
    writeConfig,
    subscribeVault: subscribe,
    subscribeConfig,
    // Every live window hears about every vault; renderers filter by `status.root` (the `state:changed` posture).
    onStatus: (status) => broadcastAll(CONTRACT.github.onStatus.channel, status),
    syncPass,
    inspect,
  })

  handle(CONTRACT.github.status, async (root: unknown) => manager.status(requireAbsPath(root, 'root')))
  handle(CONTRACT.github.syncNow, async (root: unknown) => manager.syncNow(requireAbsPath(root, 'root')))
  handle(CONTRACT.github.setEnabled, async (root: unknown, enabled: unknown) => {
    const dir = requireAbsPath(root, 'root')
    // Off-by-default fails closed everywhere else too (`manager.ts` reads `{ enabled: true }` exactly);
    // here the boolean is a hard requirement, because this call WRITES the switch.
    if (typeof enabled !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'enabled' must be a boolean")
    return manager.setEnabled(dir, enabled)
  })

  store.onChange((state) => manager.setOpenRoots(rootsOf(state)))
  manager.setOpenRoots(rootsOf(store.get()))
  return manager
}
