import { DEFAULT_SETTINGS } from '../types'
import { array, boolean, confirm, integer, listKind, listScope, literal, nullable, number, object, open, pageInput, pageSchema, pageWith, resourceInput, result, saved, string, type CommandDefinition,
    type CommandSchema, type SchemaType } from './schema'

/** Every top-level setting, typed from its default, so a new setting is in the schema at once. settings.patch validates each value exactly. */
const settingsSchema = object(Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, value]): [string, CommandSchema] => [key,
  value === null ? { type: ['string', 'null'], description: 'An absolute folder or a colour; null is the default.' }
    : Array.isArray(value) ? { type: 'array', description: 'A settings list. settings.patch validates its items.' }
    : typeof value === 'object' ? open('A settings group. settings.patch validates its fields.')
    : { type: typeof value as SchemaType }])), Object.keys(DEFAULT_SETTINGS))
export const storedTab = object({ path: string(), name: string(), zoom: string(), active: literal(true) }, ['path'])
const vaultEntry = result({ path: string(), name: string(), key: nullable(integer), open: boolean, lastUsed: nullable(number) })
const workspaceEntry = result({ id: string(), name: string(), roots: array(string()), lastUsed: number })
export const sessionEntry = result({ id: string(), name: string(), tabs: array(storedTab), roots: array(string()), lastUsed: number })
const removedEntry = result({ id: string(), removed: literal(true) })
const collectionList = { root: string(), kind: listKind, scope: listScope }
const member = string('A member path, in list order.')
const collectionWrite = (name: string, description: string): CommandDefinition =>
  ({ name, description, effect: 'write', input: object({ ...collectionList, paths: array(string()) }, ['root', 'kind', 'scope', 'paths']), output: result({ ...collectionList, items: array(member), ...saved }), requires: ['existing vault', 'explicit list scope'] })
const pictureFolders = { folders: array(string('An allowed external picture folder.')) }
const pictureFolderWrite = (name: string, description: string): CommandDefinition =>
  ({ name, description, effect: 'write', input: object({ folder: string() }, ['folder']), output: result({ ...pictureFolders, ...saved }), requires: ['running app'] })

export const configurationCommands: CommandDefinition[] = [
  { name: 'settings.get', description: 'Read the app settings. Secret values are kept elsewhere and never returned.', effect: 'read', input: object({}), output: result({ settings: settingsSchema }),
      requires: ['running app'] },
  { name: 'settings.patch',
      description: 'Change the named settings and keep the others. Each value is checked first; nothing is saved when one is invalid. Replies after the settings are saved to disk.', effect: 'write',
      input: object({ changes: { ...settingsSchema, required: [], description: 'Top-level settings to change. An unknown name fails before anything is sent; settings.patch validates each value.' } }, ['changes']),
      output: result({ settings: settingsSchema, ...saved }), requires: ['running app'] },
  { name: 'settingsFolder.get', description: 'Read this Mac’s shared settings folder and whether it is missing.', effect: 'read', input: object({}),
      output: result({ folder: nullable(string()), missing: { ...boolean, description: 'The chosen folder is not reachable now.' } }), requires: ['running app'] },
  { name: 'settingsFolder.set',
      description: 'Choose an existing shared settings folder, or null for this Mac only. Another Mac’s file wins, as in Settings. The reply says whether the first sync finished within two seconds.',
      effect: 'write', input: object({ folder: { type: ['string', 'null'], maxLength: 4096 } }, ['folder']),
      output: result({ folder: nullable(string()), missing: boolean, syncSettled: { ...boolean, description: 'Initial synchronization finished within two seconds.' }, ...saved }),
      requires: ['explicit folder or null'] },
  { name: 'vault.list', description: 'List the vaults the app knows, with their display names and number keys.', effect: 'read', input: object(pageInput), output: pageSchema(vaultEntry),
      requires: ['running app'] },
  { name: 'vault.patch', description: 'Change a vault’s display name or number key. Null clears either one.', effect: 'write',
      input: object({ root: string(), changes: object({ name: { type: ['string', 'null'], maxLength: 200 }, key: { type: ['integer', 'null'], minimum: 1, maximum: 9 } }) }, ['root', 'changes']),
      output: result({ root: string(), name: nullable(string('The display name; null shows the folder name.')), key: nullable(integer), keyFrom: string('The vault that held this number key before; it now has none.'), ...saved }, ['keyFrom']),
      requires: ['explicit vault'] },
  { name: 'workspace.list', description: 'List the saved workspaces, each with its ID, name, and vaults.', effect: 'read', input: object(pageInput),
      output: pageSchema(object({ id: string(), name: string(), roots: array(string()), lastUsed: number }, ['id', 'name', 'roots'])), requires: ['running app'] },
  { name: 'workspace.create', description: 'Save a new workspace of two or more vaults. A name that is already in use is refused.', effect: 'write',
      input: object({ name: string(), roots: array(string()) }, ['name', 'roots']), output: result({ workspace: workspaceEntry, ...saved }), requires: ['running app', 'existing vault folders'] },
  { name: 'workspace.update', description: 'Replace the vaults of a saved workspace. Its ID and name stay.', effect: 'write', input: object({ id: string(), roots: array(string()) }, ['id', 'roots']),
      output: result({ workspace: workspaceEntry, ...saved }), requires: ['saved workspace ID'] },
  { name: 'workspace.rename', description: 'Rename a saved workspace. Its ID stays.', effect: 'write', input: object({ id: string(), name: string() }, ['id', 'name']),
      output: result({ workspace: workspaceEntry, ...saved }), requires: ['saved workspace ID'] },
  { name: 'workspace.remove', description: 'Remove a saved workspace. Its files and live windows stay.', effect: 'write', input: object({ id: string() }, ['id']),
      output: result({ workspace: removedEntry, ...saved }), requires: ['saved workspace ID'] },
  { name: 'session.list', description: 'List the saved sessions. Live windows are not sessions; use window.list for them.', effect: 'read', input: object(pageInput),
      output: pageWith(sessionEntry, { source: literal('saved') }), requires: ['running app'] },
  { name: 'session.save', description: 'Save the given tabs and vaults as a session, or replace the session with this ID.', effect: 'write',
      input: object({ id: string(), name: string(), roots: array(string()), tabs: array(object({ path: string(), name: string(), zoom: string(), active: { type: 'boolean', enum: [true] } }, ['path'])) }, ['roots', 'tabs']),
      output: result({ session: sessionEntry, ...saved }), requires: ['running app', 'existing files inside the supplied vaults'] },
  { name: 'session.rename', description: 'Rename a saved session. Its ID stays.', effect: 'write', input: object({ id: string(), name: string() }, ['id', 'name']),
      output: result({ session: sessionEntry, ...saved }), requires: ['saved session ID'] },
  { name: 'session.remove', description: 'Remove a saved session. Its files and live windows stay. confirm: true answers the session list’s delete sheet.', effect: 'write',
      input: object({ id: string(), confirm }, ['id', 'confirm']), output: result({ session: removedEntry, ...saved }), requires: ['saved session ID'] },
  { name: 'collection.list', description: 'List the Favorites or Focus items of one vault’s list, in order. scope names the vault list or the workspace list.', effect: 'read',
      input: object({ ...collectionList, ...pageInput }, ['root', 'kind', 'scope']), output: pageWith(member, collectionList), requires: ['existing vault'] },
  collectionWrite('collection.add', 'Add items to the end of a Favorites or Focus list. A full list refuses them all with LIMIT_EXCEEDED.'),
  collectionWrite('collection.remove', 'Remove items from a Favorites or Focus list.'),
  collectionWrite('collection.reorder', 'Put a Favorites or Focus list in a new order. paths must name every current item exactly once.'),
  { name: 'pictureFolder.list', description: 'List the folders outside the vaults that boards may take pictures from.', effect: 'read', input: object({}), output: result(pictureFolders),
      requires: ['running app'] },
  pictureFolderWrite('pictureFolder.allow', 'Let boards take pictures from a folder outside the vaults. System folders and symbolic links are refused, as in Settings.'),
  pictureFolderWrite('pictureFolder.remove', 'Stop letting boards take pictures from a folder. Its files stay.'),
]

const groupInput = { ...resourceInput, kind: listKind, scope: listScope }
const groupItem = result({ vault: string('The vault’s folder name.'), path: string('The path inside that vault.') })
const groupFields = { id: string(), name: string(), created: number, at: number, items: array(groupItem), deleted: literal(true), pos: integer }
const resolvedItem = result({ vault: string(), path: string('Absolute when the vault is open here; otherwise the path inside the vault.'), ghost: string('The vault name when no open vault has it.'), clash: literal(true) },
    ['ghost', 'clash'])
const groupScope = { roots: array(string()), kind: listKind, scope: listScope }
const groupWritten = { ...groupScope, group: result(groupFields, ['deleted', 'pos']), ...saved }
const groupWrite = (name: string, description: string, fields: Record<string, CommandSchema>, required: string[], extra: Record<string, CommandSchema> = {}): CommandDefinition =>
  ({ name, description, effect: 'write', input: object({ ...groupInput, ...fields }, ['kind', 'scope', ...required]), output: result({ ...groupWritten, ...extra }), requires: ['explicit vault scope'] })
const itemRefs = { paths: array(string()), items: array(object({ vault: string(), path: string() }, ['vault', 'path'])) }

export const groupCommands: CommandDefinition[] = [
  { name: 'group.list', description: 'List the named groups of a Favorites or Focus list, with each item resolved to a path. An item of a vault that is not open is listed too.', effect: 'read',
      input: object({ ...groupInput, ...pageInput }, ['kind', 'scope']), output: pageWith(result({ ...groupFields, resolvedItems: array(resolvedItem) }, ['deleted', 'pos']), groupScope),
      requires: ['explicit vault scope'] },
  groupWrite('group.create', 'Create a named group in a Favorites or Focus list.', { name: string() }, ['name']),
  groupWrite('group.rename', 'Rename a group, named by its ID or its unique name.', { group: string(), name: string() }, ['group', 'name']),
  groupWrite('group.remove',
      'Delete one collection group as the sidebar’s Delete does: a tombstone in both list scopes. keepItems answers its sheet: true puts each item of an open vault back at the top level of each list the group showed in; false removes them with it. Files remain.',
      { group: string(), keepItems: boolean }, ['group', 'keepItems'],
    { topLevel: result({ vault: array(string()), workspace: array(string()) }, []),
        limitReached: { ...boolean, description: 'A Focus or Favorites list was full: the items past its limit left it, as in the sidebar.' } }),
  groupWrite('group.setScope',
      'Show a group in the vault or the workspace list, or stop showing it there, as the sidebar’s “Show it in ▸ Workspace / Vault” does. scope names the list to change. A group shows in one list at least (LAST_PLACE); to remove it, use group.remove.',
      { group: string(), on: boolean }, ['group', 'on'], { shown: boolean }),
  groupWrite('group.position', 'Set one group’s position in the sidebar order.', { group: string(), position: { type: 'integer', minimum: 0 } }, ['group', 'position']),
  groupWrite('group.addItems', 'Add items (paths) to a named group. Other groups stay as they are.', { group: string(), paths: itemRefs.paths }, ['group', 'paths']),
  groupWrite('group.removeItems', 'Remove items from a named group, by path or by vault and path. Other groups stay as they are.', { group: string(), ...itemRefs }, ['group']),
  groupWrite('group.reorderItems', 'Put the items of a named group in a new order. Name every current item exactly once, by path or by vault and path.', { group: string(), ...itemRefs }, ['group']),
]
