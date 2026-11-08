import type { AppState } from '@shared/types'
import { AutomationFailure } from '@shared/automation'
import type { AutomationServices } from './services'
import { absolute, scopeRoots } from './resources'

/** Reuse Settings' worker jobs. Board parsing never moves onto Electron's main thread. */
export async function storageCommand(services: AutomationServices, state: AppState, command: string, args: Record<string, unknown>) {
  const { roots: [root] } = await scopeRoots(state, { root: args.root as string })
  if (command === 'storage.stats') {
    const { large, ...stats } = await services.storage.stats(root)
    const offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
    return { ...stats, large: { items: large.slice(offset, offset + limit), total: large.length, nextOffset: offset + limit < large.length ? offset + limit : null } }
  }
  const skip = (args.skip as string[] ?? []).map(absolute)
  if (skip.some(path => !path.startsWith(`${root}/`))) throw new AutomationFailure('OUTSIDE_SCOPE', 'Skipped boards must belong to this vault.')
  const result = await services.storage.shrink(root, skip)
  return { root, ...result, diskSaved: result.shrunk > 0, rendererMerged: false }
}
