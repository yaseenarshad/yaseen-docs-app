import { AutomationFailure, pageOf } from '@shared/automation'
import { MAX_FAVORITES, MAX_FOCUS, MAX_SESSION_TABS, listVaults, type ListScope, type StoredTab } from '@shared/types'
import { patchSettings, readStoredTab, type Store } from '../store'
import { getFavorites, updateFavorites } from '../favorites'
import { getFocus, updateFocus } from '../focus'
import { absolute, resolveTarget, scopeRoots } from './resources'
import { allowPictureFolder } from '../pictureFolderActions'
import { serializeFile } from '../fs/revision'
import { requireShippedIcon } from './vaultConfiguration'


export async function configurationCommand(store: Store, command: string, args: Record<string, unknown>, forgetPicturePick?: (folder: string) => void): Promise<unknown> {
  if (command === 'settings.get') return { settings: store.get().settings }
  if (command === 'vault.list') return pageOf(listVaults(store.get()), args)
  if (command === 'vault.patch') {
    const { roots: [root] } = await scopeRoots(store.get(), { root: args.root as string })
    const changes = args.changes as { name?: string | null; key?: number | null }
    // A number key moves, as in the vault switcher: the result names the vault that loses it.
    const keyFrom = changes.key == null ? undefined : Object.entries(store.get().folders).find(([other, folder]) => other !== root && folder.key === changes.key)?.[0]
    store.setFolder(root, changes)
    await store.flush()
    // Only the label and the number key: the vault's bucket also holds this Mac's private open and save history.
    const { name, key } = store.get().folders[root]
    return { root, name, key, ...(keyFrom === undefined ? {} : { keyFrom }), diskSaved: true }
  }
  if (command.startsWith('pictureFolder.')) {
    if (command === 'pictureFolder.allow') await allowPictureFolder(store, absolute(args.folder as string))
    else if (command === 'pictureFolder.remove') {
      const folder = absolute(args.folder as string)
      store.removePictureFolder(folder); forgetPicturePick?.(folder)
    }
    if (command !== 'pictureFolder.list') await store.flush()
    return { folders: store.get().approvedPictureFolders, ...(command === 'pictureFolder.list' ? {} : { diskSaved: true }) }
  }
  if (command === 'session.list') return { ...pageOf(store.get().sessions, args), source: 'saved' }
  if (command === 'settings.patch') {
    const rules = (args.changes as Record<string, unknown>).sidebarIconRules
    if (Array.isArray(rules)) for (const rule of rules) if (typeof rule?.icon === 'string') await requireShippedIcon(rule.icon)
    let next
    try { next = patchSettings(store.get().settings, args.changes as Record<string, unknown>) }
    catch { throw new AutomationFailure('INVALID_INPUT', 'A settings field is unknown or has an invalid value. No settings were changed.') }
    store.setSettings(next)
    await store.flush()
    return { settings: store.get().settings, diskSaved: true }
  }
  if (command.startsWith('workspace.')) {
    const id = args.id as string | undefined
    const existing = id === undefined ? undefined : store.get().vaultSets.find(item => item.id === id)
    if (id !== undefined && !existing) throw new AutomationFailure('NOT_FOUND', 'The saved workspace was not found.')
    let result: unknown
    if (command === 'workspace.create' || command === 'workspace.update') {
      const { roots } = await scopeRoots(store.get(), { roots: args.roots as string[] })
      const name = existing?.name ?? (args.name as string).trim()
      if (!existing && store.get().vaultSets.some(item => item.name.toLowerCase() === name.toLowerCase())) throw new AutomationFailure('ALREADY_EXISTS', 'A workspace with this name already exists. Update it by ID.')
      result = store.saveVaultSet(name, roots)
      if (!result) throw new AutomationFailure('INVALID_INPUT', 'A workspace needs a valid name and at least two vaults, within the saved-workspace limit.')
    } else if (command === 'workspace.rename') {
      if (!store.renameVaultSet(id!, args.name as string)) throw new AutomationFailure('INVALID_INPUT', 'The workspace name is empty or already used.')
      result = store.get().vaultSets.find(item => item.id === id)
    } else if (command === 'workspace.remove') { store.removeVaultSet(id!); result = { id, removed: true } }
    else throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown workspace operation.')
    await store.flush()
    return { workspace: result, diskSaved: true }
  }
  if (command.startsWith('session.')) {
    const id = args.id as string | undefined
    const existing = id === undefined ? undefined : store.get().sessions.find(item => item.id === id)
    if (id !== undefined && !existing) throw new AutomationFailure('NOT_FOUND', 'The saved session was not found.')
    let result: unknown
    if (command === 'session.save') {
      const { roots } = await scopeRoots(store.get(), { roots: args.roots as string[] })
      const raw = args.tabs as StoredTab[]
      const tabs = raw.map(readStoredTab)
      if (!tabs.length || tabs.length > MAX_SESSION_TABS || tabs.some(tab => tab === null)) throw new AutomationFailure('INVALID_INPUT', 'The session tabs are invalid or exceed the session limit.')
      for (const tab of tabs) await resolveTarget(roots, { path: tab!.path })
      result = store.saveSession(args.name as string ?? existing?.name ?? '', tabs as StoredTab[], roots, id)
      if (!result) throw new AutomationFailure('INVALID_INPUT', 'The session could not be saved. Check its name and the saved-session limit.')
    } else if (command === 'session.rename') {
      if (!store.renameSession(id!, args.name as string)) throw new AutomationFailure('INVALID_INPUT', 'The session name is invalid.')
      result = store.get().sessions.find(item => item.id === id)
    } else if (command === 'session.remove') { store.removeSession(id!); result = { id, removed: true } }
    else throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown session operation.')
    await store.flush()
    return { session: result, diskSaved: true }
  }
  // Changes of one list run in call order: validation awaits the disk, so the list lock alone would take them in completion order.
  if (command.startsWith('collection.') && command !== 'collection.list') return serializeFile(`collection:${absolute(args.root as string)}:${args.kind}:${args.scope}`, () => collectionCommand(store, command, args))
  if (command.startsWith('collection.')) return collectionCommand(store, command, args)
  throw new AutomationFailure('UNKNOWN_COMMAND', 'No configuration adapter exists for this command.')
}

async function collectionCommand(store: Store, command: string, args: Record<string, unknown>): Promise<unknown> {
  const { roots: [root] } = await scopeRoots(store.get(), { root: args.root as string })
  const kind = args.kind as 'favorites' | 'focus', scope = args.scope as ListScope
  const read = kind === 'favorites' ? getFavorites : getFocus
  if (command === 'collection.list') return { root, kind, scope, ...pageOf(await read(root, scope), args) }
  const raw = (args.paths as string[]).map(absolute)
  const paths = [...new Set(raw)]
  if (command === 'collection.reorder' && paths.length !== raw.length) throw new AutomationFailure('INVALID_INPUT', 'Reordering requires every member exactly once.')
  // Removal also accepts a stale entry. Add and order must point to real members of this vault.
  if (command !== 'collection.remove') for (const path of paths) await resolveTarget([root], { path })
  const update = kind === 'favorites' ? updateFavorites : updateFocus
  const items = await update(root, scope, current => {
    if (command === 'collection.add') {
      const next = [...new Set([...current, ...paths])]
      if (next.length > (kind === 'favorites' ? MAX_FAVORITES : MAX_FOCUS)) throw new AutomationFailure('LIMIT_EXCEEDED', 'The collection is full. No items were added.')
      return next
    }
    if (command === 'collection.remove') return current.filter(path => !paths.includes(path))
    if (command === 'collection.reorder') {
      if (paths.length !== current.length || current.some(path => !paths.includes(path))) throw new AutomationFailure('CONFLICT', 'Reordering requires every current member exactly once. Read the collection again.')
      return paths
    }
    throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown collection operation.')
  })
  return { root, kind, scope, items, diskSaved: true }
}
