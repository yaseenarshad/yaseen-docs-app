import { randomUUID } from 'node:crypto'
import { AutomationFailure } from '@shared/automation'
import { folderDeletion, folderScopeChange, itemOf, mergeFolders, onTopLevel, resolveItem, sameItem, TOP_LEVEL_MAX } from '@shared/collectionFolders'
import { MAX_FOLDER_ITEMS, rootOfPath, type AppState, type FocusFolder, type ListScope } from '@shared/types'
import { getFavorites, updateFavorites } from '../favorites'
import { getFocus, updateFocus } from '../focus'
import { getFocusFolders, patchFocusFolder, type FolderKind } from '../focusFolders'
import { absolute, resolveTarget, scopeRoots, unique } from './resources'

export async function groupCommand(state: AppState, command: string, args: Record<string, unknown>) {
  const { roots } = await scopeRoots(state, args)
  const scope = args.scope as ListScope, kind = args.kind as FolderKind
  // "Show it in ▸ Vault" in a window of several vaults writes each vault's own list, as the sidebar does (YAZ-4599).
  if (command === 'group.setScope') return setGroupScope(roots, scope, kind, args.group as string, args.on as boolean)
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
  if (command === 'group.remove') return removeGroup(roots, scope, kind, args.group as string, args.keepItems as boolean)
  const group = await patchFocusFolder(roots, scope, kind, copies => {
    const folders = mergeFolders(copies)
    const at = stamp(copies)
    if (command === 'group.create') {
      const name = (args.name as string).trim()
      if (!name) throw new AutomationFailure('INVALID_INPUT', 'A group needs a name.')
      return { id: randomUUID(), name, created: at, at, items: [] }
    }
    const current = named(folders, args.group as string)
    const next: FocusFolder = { ...current, at }
    if (command === 'group.rename') {
      next.name = (args.name as string).trim()
      if (!next.name) throw new AutomationFailure('INVALID_INPUT', 'A group needs a name.')
    } else if (command === 'group.addItems') next.items = [...current.items, ...items!.filter(item => !current.items.some(other => sameItem(item, other)))]
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

const stamp = (copies: Record<string, readonly FocusFolder[]>) => Math.max(Date.now(), ...Object.values(copies).flat().map(folder => folder.at + 1))
const named = (folders: FocusFolder[], group: string) => folders.find(folder => folder.id === group) ?? unique(folders.filter(folder => folder.name.toLowerCase() === group.toLowerCase()), 'Group')

/**
 * The sidebar's Delete (`folderDeletion`, D7): the tombstone goes to the named scope, then to the other one; with
 * `keep`, the items go back to the top level of each list the group showed in (`onTopLevel`). Each vault's list keeps
 * its limit, as the sidebar does, and `limitReached` says when items left. A step that fails after the first write is
 * a partial failure: it says what was done.
 */
async function removeGroup(roots: string[], scope: ListScope, kind: FolderKind, ref: string, keep: boolean) {
  const other: ListScope = scope === 'vault' ? 'workspace' : 'vault'
  const read = kind === 'favorites' ? getFavorites : getFocus, update = kind === 'favorites' ? updateFavorites : updateFocus
  const lists = async (s: ListScope) => new Set((await Promise.all(roots.map(root => read(root, s)))).flat())
  const [here, there] = await Promise.all([lists(scope), lists(other)])
  const theirs = (await Promise.all(roots.map(root => getFocusFolders(root, other, kind, { readOnly: true })))).flat()
  let plan!: ReturnType<typeof folderDeletion>
  const group = await patchFocusFolder(roots, scope, kind, copies => {
    const current = named(mergeFolders(copies), ref)
    plan = folderDeletion(current, roots, keep, stamp(copies), path => here.has(path), theirs.some(folder => folder.id === current.id && !folder.deleted) ? path => there.has(path) : null)
    return plan.gone
  })
  const done: string[] = [scope]
  let limitReached = false
  const putBack = async (s: ListScope, paths: string[]) => {
    for (const root of roots) {
      const own = paths.filter(path => rootOfPath(roots, path) === root)
      if (!own.length) continue
      await update(root, s, current => {
        const { list, full } = onTopLevel(current, own, TOP_LEVEL_MAX[kind])
        if (full) limitReached = true
        return list
      })
    }
  }
  try {
    await patchFocusFolder(roots, other, kind, () => plan.gone)
    done.push(other)
    await putBack(scope, plan.here)
    await putBack(other, plan.there)
  } catch (error) {
    throw new AutomationFailure('PARTIAL_FAILURE', 'The group is deleted, but a later step failed. Read the lists before another change.', { tombstones: done, error: error instanceof Error ? error.message : String(error) })
  }
  return { roots, kind, scope, group, topLevel: { [scope]: plan.here, [other]: plan.there } as Record<ListScope, string[]>, limitReached, diskSaved: true }
}

/**
 * The sidebar's "Show it in ▸ Workspace / Vault" (`folderScopeChange`, D7, YAZ-4599): `scope` is the list to change.
 * On, the group's copy there comes alive; off, a tombstone goes there. The last place a group shows stays.
 */
async function setGroupScope(roots: string[], scope: ListScope, kind: FolderKind, ref: string, on: boolean) {
  const other: ListScope = scope === 'vault' ? 'workspace' : 'vault'
  const elsewhere = (await Promise.all(roots.map(root => getFocusFolders(root, other, kind, { readOnly: true })))).flat()
  const group = await patchFocusFolder(roots, scope, kind, copies => {
    // The group is found where it shows: this list or the other one, by ID or unique name.
    const shown = [...mergeFolders(copies), ...elsewhere].filter(folder => !folder.deleted)
    const byId = [...mergeFolders(copies), ...elsewhere].find(folder => folder.id === ref)
    const current = byId ?? named([...new Map(shown.map(folder => [folder.id, folder])).values()], ref)
    const next = folderScopeChange(current, on, stamp(copies), elsewhere.some(folder => folder.id === current.id && !folder.deleted))
    if (next === null) throw new AutomationFailure('LAST_PLACE', 'A group shows in one list at least. To remove it, use group remove.')
    return next
  })
  return { roots, kind, scope, group, shown: !group.deleted, diskSaved: true }
}
