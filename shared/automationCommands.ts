import { AUTOMATION_LIMITS, AutomationFailure } from './automation'

/** JSON Schema subset used by public commands. Additional object keys are rejected by default. */
type SchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
export interface CommandSchema {
  type: SchemaType | readonly SchemaType[]
  description?: string
  properties?: Record<string, CommandSchema>
  required?: readonly string[]
  additionalProperties?: boolean | CommandSchema
  items?: CommandSchema
  enum?: readonly unknown[]
  minimum?: number
  maximum?: number
  maxLength?: number
  maxItems?: number
}
export interface CommandDefinition {
  name: string
  description: string
  effect: 'read' | 'navigate' | 'write' | 'remote' | 'restart'
  input: CommandSchema
  output: CommandSchema
  contentRequired?: boolean
  content?: 'text' | 'json' | 'binary' | 'secret'
  requires: readonly string[]
}
export const string = (description?: string): CommandSchema => ({ type: 'string', maxLength: 4096, ...(description ? { description } : {}) })
export const object = (properties: Record<string, CommandSchema>, required: readonly string[] = []): CommandSchema => ({ type: 'object', properties, required, additionalProperties: false })
export const array = (items: CommandSchema): CommandSchema => ({ type: 'array', items, maxItems: 10_000 })
export const pageInput = {
  offset: { type: 'integer', minimum: 0 } as CommandSchema,
  limit: { type: 'integer', minimum: 1, maximum: AUTOMATION_LIMITS.maxPage } as CommandSchema,
}
export const resourceInput = {
  workspace: string('Saved workspace ID or unique name.'), root: string('Absolute vault path.'), roots: array(string()),
}
export const targetInput = { path: string('Absolute path.'), id: string('Existing note or folder ID, scoped to the vault.'), name: string('Unique exact title, alias, or filename.') }
export const scopeInput = { ...resourceInput, folder: string(), collection: { type: 'string', enum: ['favorites', 'focus'] } as CommandSchema, scope: { type: 'string', enum: ['vault', 'workspace'] } as CommandSchema, group: string() }
export const navigationSchema = object({
  ...resourceInput, ...targetInput, window: string(), mode: { type: 'string', enum: ['reuse', 'new'] },
  sidebar: { type: 'string', enum: ['files', 'favorites', 'focus', 'search', 'sessions', 'recents'] },
  scope: scopeInput.scope, group: string(), view: string(), reveal: { type: 'boolean' }, allowPartial: { type: 'boolean' },
})
export const searchRowSchema = object({ kind: { type: 'string', enum: ['file', 'dir'] }, name: string(), lower: string(), label: string(), path: string(), folder: string(), id: string(), was: array(string()) }, ['kind', 'name', 'label', 'path', 'folder'])
export const pageSchema = (items: CommandSchema): CommandSchema => object({ items: array(items), total: { type: 'integer' }, nextOffset: { type: ['integer', 'null'], description: 'Next offset, or null when complete.' } }, ['items', 'total', 'nextOffset'])

export function validateInput(schema: CommandSchema, value: unknown, path = 'input'): void {
  const fail = (reason: string): never => { throw new AutomationFailure('INVALID_INPUT', `${path}: ${reason}`) }
  if (typeof schema.type !== 'string') {
    for (const type of schema.type) {
      try { validateInput({ ...schema, type }, value, path); return } catch { /* Try the next declared type. */ }
    }
    return fail('does not match an allowed type')
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`expected one of ${schema.enum.join(', ')}`)
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('expected an object')
      const record = value as Record<string, unknown>
      for (const name of schema.required ?? []) if (!Object.hasOwn(record, name)) fail(`missing ${name}`)
      for (const name of Object.keys(record)) {
        if (name === '__proto__' || name === 'constructor' || name === 'prototype') fail(`invalid field ${name}`)
        const field = schema.properties?.[name]
        if (field) validateInput(field, record[name], `${path}.${name}`)
        else if (typeof schema.additionalProperties === 'object') validateInput(schema.additionalProperties, record[name], `${path}.${name}`)
        else if (schema.additionalProperties !== true) fail(`unknown field ${name}`)
      }
      break
    }
    case 'array':
      if (!Array.isArray(value)) return fail('expected an array')
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items')
      value.forEach((item, index) => schema.items && validateInput(schema.items, item, `${path}[${index}]`))
      break
    case 'string':
      if (typeof value !== 'string') return fail('expected text')
      if (value.includes('\0') || (schema.maxLength !== undefined && value.length > schema.maxLength)) fail('invalid text length or NUL character')
      break
    case 'number': case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) return fail(`expected a finite ${schema.type}`)
      if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) fail('outside the allowed range')
      break
    case 'boolean': if (typeof value !== 'boolean') fail('expected a boolean'); break
    case 'null': if (value !== null) fail('expected null'); break
  }
}

const documentTarget = { ...resourceInput, ...targetInput }
const documentEdit = { ...documentTarget, revision: string('Revision from file.read or comment.list.') }
const savedOutput = object({ path: string(), mtime: { type: 'number' }, size: { type: 'integer' }, revision: string(), diskSaved: { type: 'boolean' }, rendererMerged: { type: 'boolean' }, changed: { type: 'boolean' }, comment: string() }, ['path', 'mtime', 'size', 'revision', 'diskSaved', 'rendererMerged', 'changed'])
const documentRequires = ['running app', 'explicit vault scope and one target', 'saved base revision']
const documentCommands: CommandDefinition[] = [
  ...['write', 'append'].map(action => ({ name: `file.${action}`, description: `${action === 'write' ? 'Replace' : 'Append to'} saved text after checking its revision. Existing outside-edit behavior updates open editors.`, effect: 'write' as const, input: object(documentEdit, ['revision']), output: savedOutput, content: 'text' as const, contentRequired: true, requires: documentRequires })),
  { name: 'property.set', description: 'Set one frontmatter property path while preserving other fields and formatting.', effect: 'write', input: object({ ...documentEdit, keys: array(string()), value: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], additionalProperties: true } }, ['revision', 'keys', 'value']), output: savedOutput, requires: documentRequires },
  { name: 'property.remove', description: 'Remove one frontmatter property path.', effect: 'write', input: object({ ...documentEdit, keys: array(string()) }, ['revision', 'keys']), output: savedOutput, requires: documentRequires },
  { name: 'comment.list', description: 'Read comments with stable IDs, ownership, and a saved revision.', effect: 'read', input: object({ ...documentTarget, ...pageInput }), output: { ...pageSchema({ type: 'object', additionalProperties: true }), properties: { ...pageSchema({ type: 'object', additionalProperties: true }).properties, path: string(), revision: string() } }, requires: ['running app', 'explicit vault scope and one target'] },
  { name: 'comment.add', description: 'Add an agent comment or reply to a top-level comment.', effect: 'write', input: object({ ...documentEdit, replyTo: string(), title: string(), by: string() }, ['revision']), output: savedOutput, content: 'text', contentRequired: true, requires: documentRequires },
  { name: 'comment.update', description: 'Edit an agent-owned comment. Human comments cannot be changed here.', effect: 'write', input: object({ ...documentEdit, comment: string(), title: string() }, ['revision', 'comment']), output: savedOutput, content: 'text', contentRequired: true, requires: documentRequires },
  { name: 'comment.remove', description: 'Delete an agent-owned comment and its replies.', effect: 'write', input: object({ ...documentEdit, comment: string() }, ['revision', 'comment']), output: savedOutput, requires: documentRequires },
  { name: 'note.create', description: 'Find or create a note by title using the existing folder template and ID rules.', effect: 'write', input: object({ ...resourceInput, folder: string(), title: string() }, ['folder', 'title']), output: object({ path: string(), title: string(), id: { type: ['string', 'null'] }, created: { type: 'boolean' }, others: array(string()) }, ['path', 'title', 'id', 'created', 'others']), content: 'text', requires: ['running app', 'explicit vault scope and folder'] },
]

const configResult: CommandSchema = { type: 'object', additionalProperties: true }
const collectionInput = { root: string(), kind: { type: 'string', enum: ['favorites', 'focus'] } as CommandSchema, scope: scopeInput.scope }
const configurationCommands: CommandDefinition[] = [
  { name: 'settings.get', description: 'Read supported app settings. Secret values are held separately and never returned.', effect: 'read', input: object({}), output: configResult, requires: ['running app'] },
  { name: 'settings.patch', description: 'Validate named fields, patch the latest settings, and await durable storage.', effect: 'write', input: object({ changes: { type: 'object', additionalProperties: true } }, ['changes']), output: configResult, requires: ['running app'] },
  { name: 'vault.list', description: 'List known vaults from app state.', effect: 'read', input: object(pageInput), output: pageSchema(configResult), requires: ['running app'] },
  { name: 'workspace.create', description: 'Save a new workspace with at least two vaults. Existing names are refused.', effect: 'write', input: object({ name: string(), roots: array(string()) }, ['name', 'roots']), output: configResult, requires: ['running app', 'existing vault folders'] },
  { name: 'workspace.update', description: 'Update the vaults of an existing saved workspace, retaining its ID and name.', effect: 'write', input: object({ id: string(), roots: array(string()) }, ['id', 'roots']), output: configResult, requires: ['saved workspace ID'] },
  ...['workspace', 'session'].flatMap(resource => [
    { name: `${resource}.rename`, description: `Rename a saved ${resource} without changing its identity.`, effect: 'write' as const, input: object({ id: string(), name: string() }, ['id', 'name']), output: configResult, requires: [`saved ${resource} ID`] },
    { name: `${resource}.remove`, description: `Remove a saved ${resource}. Its files and live windows remain.`, effect: 'write' as const, input: object({ id: string() }, ['id']), output: configResult, requires: [`saved ${resource} ID`] },
  ]),
  { name: 'session.list', description: 'List saved sessions, labeled separately from live windows.', effect: 'read', input: object(pageInput), output: configResult, requires: ['running app'] },
  { name: 'session.save', description: 'Save explicit tabs and vaults as a session, or update an existing session by ID.', effect: 'write', input: object({ id: string(), name: string(), roots: array(string()), tabs: array(object({ path: string(), name: string(), zoom: string(), active: { type: 'boolean', enum: [true] } }, ['path'])) }, ['roots', 'tabs']), output: configResult, requires: ['running app', 'existing files inside the supplied vaults'] },
  { name: 'collection.list', description: 'Read ordered Favorites or Focus members for one vault and explicit list scope.', effect: 'read', input: object({ ...collectionInput, ...pageInput }, ['root', 'kind', 'scope']), output: configResult, requires: ['existing vault'] },
  ...['add', 'remove', 'reorder'].map(action => ({ name: `collection.${action}`, description: `${action} members against the latest Favorites or Focus list. Reorder requires the complete current list.`, effect: 'write' as const, input: object({ ...collectionInput, paths: array(string()) }, ['root', 'kind', 'scope', 'paths']), output: configResult, requires: ['existing vault', 'explicit list scope'] })),
]

const groupInput = { ...resourceInput, kind: collectionInput.kind, scope: scopeInput.scope }
const groupCommands: CommandDefinition[] = [
  { name: 'group.list', description: 'List named Favorites or Focus groups and resolve each member, including missing vaults.', effect: 'read', input: object({ ...groupInput, ...pageInput }, ['kind', 'scope']), output: configResult, requires: ['explicit vault scope'] },
  { name: 'group.create', description: 'Create a named collection group using the existing group identity and format.', effect: 'write', input: object({ ...groupInput, name: string() }, ['kind', 'scope', 'name']), output: configResult, requires: ['explicit vault scope'] },
  { name: 'group.rename', description: 'Rename one collection group by ID or unique name.', effect: 'write', input: object({ ...groupInput, group: string(), name: string() }, ['kind', 'scope', 'group', 'name']), output: configResult, requires: ['explicit vault scope'] },
  { name: 'group.remove', description: 'Delete one collection group with the existing tombstone rule. Its files remain.', effect: 'write', input: object({ ...groupInput, group: string() }, ['kind', 'scope', 'group']), output: configResult, requires: ['explicit vault scope'] },
  { name: 'group.position', description: 'Set one group’s position in the sidebar order.', effect: 'write', input: object({ ...groupInput, group: string(), position: { type: 'integer', minimum: 0 } }, ['kind', 'scope', 'group', 'position']), output: configResult, requires: ['explicit vault scope'] },
  ...['addItems', 'removeItems', 'reorderItems'].map(action => ({ name: `group.${action}`, description: `${action} in a named collection group, preserving other groups and existing membership rules.`, effect: 'write' as const, input: object({ ...groupInput, group: string(), paths: array(string()), ...(action === 'addItems' ? {} : { items: array(object({ vault: string(), path: string() }, ['vault', 'path'])) }) }, action === 'addItems' ? ['kind', 'scope', 'group', 'paths'] : ['kind', 'scope', 'group']), output: configResult, requires: ['explicit vault scope'] })),
]

const boardCommands: CommandDefinition[] = ['drawing', 'diagram'].flatMap(kind => [
  { name: `${kind}.read`, description: `Read a saved ${kind} through its existing format and asset service, with a revision. Use export for a large payload.`, effect: 'read' as const, input: object({ ...resourceInput, ...targetInput }), output: configResult, requires: ['explicit vault scope and target'] },
  { name: `${kind}.save`, description: `Save a ${kind} with a required saved revision. Embedded image data uses the existing asset rules. Large content can come from sourceFile.`, effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, revision: string(), sourceFile: string() }, ['revision']), output: configResult, content: 'text' as const, requires: ['explicit vault scope and target', 'saved revision', 'body or source file'] },
  { name: `${kind}.export`, description: `Export the saved ${kind} to a new standalone file without overwriting an existing destination.`, effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, outputFile: string() }, ['outputFile']), output: configResult, requires: ['explicit vault scope and target', 'new output file'] },
])

/** The allowlist grows only with an implemented adapter and its checks. No IPC channel discovery. */
export const AUTOMATION_COMMANDS: readonly CommandDefinition[] = [
  ...documentCommands,
  ...configurationCommands,
  ...groupCommands,
  ...boardCommands,
  { name: 'file.history', description: 'Read this live window’s bounded organization Undo and Redo history, oldest first. History ends with the app session.', effect: 'read', input: object({ window: string() }, ['window']), output: configResult, requires: ['explicit live window'] },
  { name: 'file.restore', description: 'Restore the latest organization step only if it is a delete. Wait for all put-back results and retain Redo. A newer move or rename is refused.', effect: 'write', input: object({ window: string() }, ['window']), output: configResult, requires: ['explicit live window', 'latest Undo step is a delete with known Trash locations'] },
  { name: 'file.rename', description: 'Rename or move an item through the complete window action: buffer flush, path repair, link updates, and Undo.', effect: 'write', input: object({ window: string(), path: string(), newPath: string() }, ['window', 'path', 'newPath']), output: configResult, requires: ['explicit live window', 'source and destination in its vaults'] },
  { name: 'file.retitle', description: 'Change a note or folder title using the existing complete rename action and Undo.', effect: 'write', input: object({ window: string(), path: string(), title: string() }, ['window', 'path', 'title']), output: configResult, requires: ['explicit live window'] },
  { name: 'file.trash', description: 'Move items to OS Trash through the existing app action, retaining restore locations and Undo where supported.', effect: 'write', input: object({ window: string(), paths: { ...array(string()), maxItems: 200 } }, ['window', 'paths']), output: configResult, requires: ['explicit live window', 'items inside its vaults'] },

  { name: 'window.list', description: 'List live full windows, most recently focused first. This is not persisted session restoration state.', effect: 'read', input: object(pageInput), output: pageSchema({ type: 'object', additionalProperties: true }), requires: ['running app'] },
  { name: 'window.inspect', description: 'Read current tabs, active tab, vaults, and sidebar from one live window.', effect: 'read', input: object({ window: string() }, ['window']), output: { type: 'object', additionalProperties: true }, requires: ['explicit live window'] },
  { name: 'document.live', description: 'Read a ready editor buffer and selection from an explicit live tab. Never substitutes saved disk content.', effect: 'read', input: object({ window: string(), tab: string() }, ['window', 'tab']), output: object({ path: string(), tab: string(), source: { type: 'string', enum: ['live'] }, kind: { type: 'string', enum: ['markdown', 'text', 'drawing', 'diagram'] }, content: { type: 'string', maxLength: 64 * 1024 * 1024 }, baselineMtime: { type: 'number' }, dirty: { type: 'boolean' }, selection: object({ anchor: { type: 'integer' }, head: { type: 'integer' }, text: { type: 'string', maxLength: 10 * 1024 * 1024 }, coordinate: { type: 'string', enum: ['prosemirror', 'utf16'] } }) }, ['path', 'tab', 'source', 'kind', 'content', 'baselineMtime', 'dirty']), requires: ['explicit live window and ready tab'] },

  { name: 'app.status', description: 'Read this running Docs instance and its profile.', effect: 'read', input: object({}), output: object({ version: string(), profile: string(), running: { type: 'boolean' } }, ['version', 'profile', 'running']), requires: ['running app'] },
  { name: 'request.status', description: 'Inspect a request receipt. Unknown is not proof that a mutation failed.', effect: 'read', input: object({ id: string() }, ['id']), output: object({ id: string(), state: { type: 'string', enum: ['queued', 'running', 'completed', 'unknown'] }, resultRetained: { type: 'boolean' }, result: { type: 'object', additionalProperties: true } }, ['id', 'state']), requires: ['same app session'] },
  { name: 'workspace.list', description: 'List saved workspace identities and vault roots.', effect: 'read', input: object(pageInput), output: pageSchema(object({ id: string(), name: string(), roots: array(string()), lastUsed: { type: 'number' } }, ['id', 'name', 'roots'])), requires: ['running app'] },
  { name: 'navigation.open', description: 'Open an exact context and wait until its renderer applies the requested state.', effect: 'navigate', input: navigationSchema, output: object({ window: string(), roots: array(string()), missing: array(string()), created: { type: 'boolean' }, applied: { type: 'object', additionalProperties: true } }, ['window', 'roots', 'missing', 'created', 'applied']), requires: ['explicit workspace, vaults, or live window'] },
  { name: 'navigation.link', description: 'Generate a reusable machine-local navigation link with resolved paths and workspace identity.', effect: 'read', input: navigationSchema, output: object({ url: { type: 'string', maxLength: 64 * 1024 } }, ['url']), requires: ['running app', 'explicit workspace or vaults'] },
  { name: 'search.query', description: 'Search titles, aliases, filenames, and existing IDs within an explicit scope.', effect: 'read', input: object({ ...scopeInput, ...pageInput, query: string() }, ['query']), output: { ...pageSchema(searchRowSchema), properties: { ...pageSchema(searchRowSchema).properties, roots: array(string()) } }, requires: ['running app', 'exactly one workspace, root, or roots'] },
  { name: 'file.read', description: 'Read saved text and its revision. This does not read a dirty editor buffer.', effect: 'read', input: object({ ...resourceInput, ...targetInput }), output: object({ path: string(), content: { type: 'string', maxLength: 10 * 1024 * 1024 }, mtime: { type: 'number' }, size: { type: 'integer' }, source: { type: 'string', enum: ['disk'] }, revision: string() }, ['path', 'content', 'mtime', 'size', 'source', 'revision']), requires: ['running app', 'explicit vault scope and one target'] },
]

export const commandDefinition = (name: string): CommandDefinition => {
  const definition = AUTOMATION_COMMANDS.find(command => command.name === name)
  if (!definition) throw new AutomationFailure('UNKNOWN_COMMAND', `Unknown command: ${name}. Run capabilities --json.`)
  return definition
}
