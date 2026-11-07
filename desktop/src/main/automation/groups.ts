import { randomUUID } from 'node:crypto'
import { AutomationFailure } from '@shared/automation'
import { itemOf, mergeFolders, resolveItem, sameItem } from '@shared/collectionFolders'
import { MAX_FOLDER_ITEMS, type AppState, type FocusFolder, type ListScope } from '@shared/types'
import { getFocusFolders, patchFocusFolder, type FolderKind } from '../focusFolders'
import { absolute, resolveTarget, scopeRoots, unique } from './resources'

export async function groupCommand(state: AppState, command: string, args: Record<string, unknown>) {
  const { roots } = await scopeRoots(state, args)
  const scope = args.scope as ListScope, kind = args.kind as FolderKind
  if (scope === 'vault' && roots.length !== 1) throw new AutomationFailure('INVALID_INPUT', 'A vault-scoped group needs exactly one vault.')
  if (command === 'group.list') {
    const copies = Object.fromEntries(await Promise.all(roots.map(async root => [root, await getFocusFolders(root, scope, kind, { readOnly: true })])))
    const folders = mergeFolders(copies), offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
    return { roots, kind, scope, items: folders.slice(offset, offset + limit).map(folder => ({ ...folder, resolvedItems: folder.items.map(item => ({ ...item, ...resolveItem(item, roots) })) })), total: folders.length, nextOffset: offset + limit < folders.length ? offset + limit : null }
  }
  const paths = args.paths as string[] | undefined
  const rawItems = args.items as FocusFolder['items'] | undefined
  if (paths && rawItems) throw new AutomationFailure('INVALID_INPUT', 'Choose paths or stored item references, not both.')
  const items = rawItems ?? (paths === undefined ? undefined : await Promise.all(paths.map(async path => {
    const target = command === 'group.removeItems' ? absolute(path) : await resolveTarget(roots, { path })
    const item = itemOf(target, roots)
    if (!item || !('path' in resolveItem(item, roots))) throw new AutomationFailure('AMBIGUOUS_TARGET', 'Group members need unambiguous vault folder names and a path inside a vault.')
    return item
  })))
  if (command.endsWith('Items') && !items) throw new AutomationFailure('INVALID_INPUT', 'Supply paths or stored item references.')
  if (items && new Set(items.map(item => JSON.stringify([item.vault, item.path]))).size !== items.length) throw new AutomationFailure('INVALID_INPUT', 'A group member cannot be listed twice.')
  const group = await patchFocusFolder(roots, scope, kind, copies => {
    const folders = mergeFolders(copies)
    const at = Math.max(Date.now(), ...Object.values(copies).flat().map(folder => folder.at + 1))
    if (command === 'group.create') {
      const name = (args.name as string).trim()
      if (!name) throw new AutomationFailure('INVALID_INPUT', 'A group needs a name.')
      return { id: randomUUID(), name, created: at, at, items: [] }
    }
    const current = folders.find(folder => folder.id === args.group) ?? unique(folders.filter(folder => folder.name.toLowerCase() === String(args.group).toLowerCase()), 'Group')
    const next: FocusFolder = { ...current, at }
    if (command === 'group.rename') {
      next.name = (args.name as string).trim()
      if (!next.name) throw new AutomationFailure('INVALID_INPUT', 'A group needs a name.')
    } else if (command === 'group.remove') next.deleted = true
    else if (command === 'group.addItems') next.items = [...current.items, ...items!.filter(item => !current.items.some(other => sameItem(item, other)))]
    else if (command === 'group.removeItems') next.items = current.items.filter(item => !items!.some(other => sameItem(item, other)))
    else if (command === 'group.reorderItems') {
      if (items!.length !== current.items.length || current.items.some(item => !items!.some(other => sameItem(item, other)))) throw new AutomationFailure('CONFLICT', 'Reorder must include each current group member exactly once.')
      next.items = items!
    } else if (command === 'group.position') next.pos = args.position as number
    else throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown group operation.')
    if (next.items.length > MAX_FOLDER_ITEMS) throw new AutomationFailure('LIMIT_EXCEEDED', 'The group is full. No items were added.')
    return next
  })
  return { roots, kind, scope, group, diskSaved: true }
}
