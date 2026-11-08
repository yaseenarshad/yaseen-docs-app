import type { AppState } from '@shared/types'
import { AutomationFailure } from '@shared/automation'
import type { AutomationServices } from './services'
import { absolute, scopeRoots } from './resources'
import type { LiveEdits } from './liveEdits'

/** Reuse Settings' worker jobs. Board parsing never moves onto Electron's main thread. */
export async function storageCommand(services: AutomationServices, state: AppState, command: string, args: Record<string, unknown>, liveEdits?: LiveEdits) {
  const { roots: [root] } = await scopeRoots(state, { root: args.root as string })
  if (command === 'storage.stats') {
    const { large, ...stats } = await services.storage.stats(root)
    const offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
    return { ...stats, large: { items: large.slice(offset, offset + limit), total: large.length, nextOffset: offset + limit < large.length ? offset + limit : null } }
  }
  const skip = (args.skip as string[] ?? []).map(absolute)
  if (skip.some(path => !path.startsWith(`${root}/`))) throw new AutomationFailure('OUTSIDE_SCOPE', 'Skipped boards must belong to this vault.')
  // The GUI's own contract (YAZ-3039): a board with unsaved edits is skipped and counted, never rewritten. Say which and why.
  const open = await liveEdits?.(root) ?? []
  const result = await services.storage.shrink(root, [...new Set([...skip, ...open.map(entry => entry.path)])])
  return { root, ...result, unsavedSkipped: open.map(entry => ({ ...entry, reason: 'UNSAVED_LIVE_EDITS' })), diskSaved: result.shrunk > 0, rendererMerged: false }
}
