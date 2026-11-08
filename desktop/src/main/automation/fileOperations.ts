import { stat } from 'node:fs/promises'
// `absolute` gives every path forward slashes, on Windows too, so the posix helpers fit.
import { posix } from 'node:path'
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
  const kindOf = async (path: string) => (await stat(path)).isDirectory() ? 'dir' as const : 'file' as const
  const folder = async (verb: string) => {
    const targetDir = await resolveTarget(window.roots, { path: args.targetDir as string })
    if (await kindOf(targetDir) !== 'dir') throw new AutomationFailure('INVALID_INPUT', `${verb} into an existing folder.`)
    return targetDir
  }
  if (command === 'file.copy' || command === 'file.importCopy') {
    const targetDir = await folder('Copy')
    const external = command === 'file.importCopy'
    const paths = [...new Set(args.paths as string[])]
    if (!paths.length) throw new AutomationFailure('INVALID_INPUT', 'Supply at least one source path.')
    const resolved = await Promise.all(paths.map(p => external ? absolute(p) : target(p)))
    return host.operate(window.id, { command: 'file.copy', paths: resolved, targetDir, external })
  }
  if (command === 'file.move') {
    const targetDir = await folder('Move')
    const paths = [...new Set(args.paths as string[])]
    if (!paths.length) throw new AutomationFailure('INVALID_INPUT', 'Supply at least one path.')
    // Each item keeps its name, as a drag onto a folder does.
    const moves = await Promise.all(paths.map(async raw => { const oldPath = await target(raw); return { oldPath, newPath: posix.join(targetDir, posix.basename(oldPath)), kind: await kindOf(oldPath) } }))
    return host.operate(window.id, { command, moves, dropValues: args.dropValues === true })
  }
  if (command === 'file.trash') {
    const paths = [...new Set(args.paths as string[])]
    if (!paths.length) throw new AutomationFailure('INVALID_INPUT', 'Supply at least one path.')
    const resolved = await Promise.all(paths.map(target))
    return host.operate(window.id, { command, paths: resolved })
  }
  const path = await target(args.path as string), kind = await kindOf(path)
  if (command === 'file.rename') {
    // A new name only: a new folder is a move, which has its own door (`file.move`, YAZ-4566).
    const name = args.name as string
    if (name === '' || name === '.' || name === '..' || /[\\/]/.test(name)) throw new AutomationFailure('INVALID_INPUT', 'Give a new name with no slash. To change the folder, use file move.')
    return host.operate(window.id, { command, path, newPath: posix.join(posix.dirname(path), name), kind })
  }
  if (command === 'file.retitle') return host.operate(window.id, { command, path, title: args.title as string, kind })
  throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown file organization command.')
}
