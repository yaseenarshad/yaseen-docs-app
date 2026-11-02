import { CONTRACT } from '@shared/ipc'
import { requireAbsPath, requireDir } from '../fs/fsUtils'
import { absPaths } from '../fs/validate'
import { runOffThread } from '../storageJob'
import type { Store } from '../store'
import storageWorker from '../storageWorker?modulePath'
import { handle } from './envelope'

/**
 * The `storage.*` half of `window.yaseenDocs` (YAZ-1801 in Draw, ported by YAZ-3039) — Settings › Storage. Two doors, both
 * over a vault root the renderer names: the read-only sizes (`../git/storage.ts`, disk + local
 * git, never the network) and the one rewrite, moving legacy pictures out of boards
 * (`../fs/shrink.ts`, the save's own extraction, block kept verbatim). Both run on the one
 * storage worker (`../storageJob.ts` — D8, 🔒 D11), so neither freezes the window.
 *
 * `skip` crosses from a sandboxed renderer, so it is checked like a request body: an array of
 * absolute paths, nothing else. A path in it that names no board simply matches nothing.
 */
export function registerStorageIpc(store?: Pick<Store, 'get'>): void {
  handle(CONTRACT.storage.stats, async (root: unknown) => {
    const dir = requireAbsPath(root, 'root')
    await requireDir(dir)
    return runOffThread(storageWorker, { kind: 'stats', root: dir })
  })
  handle(CONTRACT.storage.shrink, async (root: unknown, skip: unknown) => {
    const dir = requireAbsPath(root, 'root')
    await requireDir(dir)
    // The outside pictures folders the user picked (YAZ-3943 demo round 3): the only ones the shrink writes to.
    return runOffThread(storageWorker, { kind: 'shrink', root: dir, skip: absPaths(skip, 'skip'), approved: store?.get().approvedPictureFolders ?? [] })
  })
}
