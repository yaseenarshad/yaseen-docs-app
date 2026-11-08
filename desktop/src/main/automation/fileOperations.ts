import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AutomationFailure } from '@shared/automation'
import type { NavigationHost } from './navigation'
import { absolute, resolveTarget } from './resources'

/** Complete renderer actions are scoped to an explicitly selected live window. */
export async function fileOperation(host: NavigationHost, command: string, args: Record<string, unknown>) {
  const window = host.windows().find(window => window.id === args.window)
  if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  if (command === 'file.restore' || command === 'file.undo' || command === 'file.redo') return host.operate(window.id, { command })
  const target = async (raw: string) => {
    const path = await resolveTarget(window.roots, { path: raw })
    if (window.roots.includes(path)) throw new AutomationFailure('INVALID_INPUT', 'This operation requires an item inside a vault, not the vault root.')
    return path
  }
  if (command === 'file.copy' || command === 'file.importCopy') {
    const targetDir = await resolveTarget(window.roots, { path: args.targetDir as string })
    if (!(await stat(targetDir)).isDirectory()) throw new AutomationFailure('INVALID_INPUT', 'Copy into an existing folder.')
    const external = command === 'file.importCopy'
    const paths = [...new Set(args.paths as string[])]
    if (!paths.length) throw new AutomationFailure('INVALID_INPUT', 'Supply at least one source path.')
    const resolved = await Promise.all(paths.map(p => external ? absolute(p) : target(p)))
    return host.operate(window.id, { command: 'file.copy', paths: resolved, targetDir, external })
  }
  if (command === 'file.trash') {
    const paths = [...new Set(args.paths as string[])]
    if (!paths.length) throw new AutomationFailure('INVALID_INPUT', 'Supply at least one path.')
    const resolved = await Promise.all(paths.map(target))
    return host.operate(window.id, { command, paths: resolved })
  }
  const path = await target(args.path as string), kind = (await stat(path)).isDirectory() ? 'dir' : 'file'
  if (command === 'file.rename') {
    const newPath = absolute(args.newPath as string)
    await resolveTarget(window.roots, { path: dirname(newPath) })
    if (window.roots.includes(newPath)) throw new AutomationFailure('INVALID_INPUT', 'The destination cannot replace a vault root.')
    return host.operate(window.id, { command, path, newPath, kind, ...(args.dropValues === true ? { dropValues: true } : {}) })
  }
  if (command === 'file.retitle') return host.operate(window.id, { command, path, title: args.title as string, kind })
  throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown file organization command.')
}
