import { MEDIA_COLOR_FILTERS, MEDIA_STYLE_FILTERS, MEDIA_LICENSE_FILTERS, MAX_FILTER_PACKS } from './iconPacks'
import { PROPERTY_KINDS, MEDIA_ZOOM_WIDTHS } from './types'
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
  ...resourceInput, ...targetInput, window: string(), tab: string(), mode: { type: 'string', enum: ['reuse', 'new'] },
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

const mediaItem = object({ itemKey: string(), provider: string(), providerId: string(), kind: string(), title: string(), previewUrl: string(), creator: string(), creatorUrl: string(), collectionName: string(), sourceUrl: string(), licenseName: string(), licenseUrl: string(), attribution: string(), width: { type: 'number' }, height: { type: 'number' }, trademarkNotice: { type: 'boolean' } }, ['itemKey', 'provider', 'providerId', 'kind', 'title'])
const mediaCommands: CommandDefinition[] = [
  { name: 'component.list', description: 'List saved library components, newest first.', effect: 'read', input: object(pageInput), output: configResult, requires: ['running app'] },
  ...['read', 'remove', 'export'].map(action => ({ name: `component.${action}`, description: `${action} a saved component by its stable library slug. Export creates a new file.`, effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ slug: string(), ...(action === 'export' ? { outputFile: string() } : {}) }, ['slug', ...(action === 'export' ? ['outputFile'] : [])]), output: configResult, requires: ['running app'] })),
  { name: 'component.rename', description: 'Change a saved component label while retaining its slug and files.', effect: 'write', input: object({ slug: string(), name: string() }, ['slug', 'name']), output: configResult, requires: ['running app'] },
  { name: 'component.save', description: 'Save a component through the existing library store. The JSON body requires fragmentJson and previewPng.', effect: 'write', input: object({ name: string() }, ['name']), output: configResult, content: 'json', contentRequired: true, requires: ['running app', 'fragment and preview JSON body'] },
  { name: 'media.search', description: 'Search existing media providers and local packs. May contact configured providers; uses their cursor and cache.', effect: 'remote', input: object({ query: { ...string(), maxLength: 120 }, source: { type: 'string', enum: ['all', 'iconify', 'pixabay'] }, cursor: { type: ['string', 'null'] }, filters: object({ colors: { type: 'string', enum: [...MEDIA_COLOR_FILTERS] }, style: { type: 'string', enum: [...MEDIA_STYLE_FILTERS] }, license: { type: 'string', enum: [...MEDIA_LICENSE_FILTERS] }, packs: { ...array(string()), maxItems: MAX_FILTER_PACKS } }, ['colors', 'style', 'license', 'packs']) }, ['query', 'source']), output: configResult, requires: ['running app'] },
  ...['preview', 'import'].map(action => ({ name: `media.${action}`, description: `${action} provider media through the existing cache. Import writes an explicit new destination without replacing it.`, effect: 'remote' as const, input: object({ provider: { type: 'string' as const, enum: ['pixabay', 'iconify'] }, id: string(), zoomWidth: { type: 'integer' as const, enum: [...MEDIA_ZOOM_WIDTHS] }, ...(action === 'import' ? { outputFile: string() } : {}) }, ['provider', 'id', ...(action === 'import' ? ['outputFile'] : [])]), output: configResult, requires: ['running app'] })),
  { name: 'media.library', description: 'Read one paged library list.', effect: 'read', input: object({ kind: { type: 'string', enum: ['favorites', 'recent', 'used'] }, ...pageInput }, ['kind']), output: configResult, requires: ['running app'] },
  ...['favorite', 'recordUse', 'addWord'].map(action => ({ name: `media.${action}`, description: `${action} through the existing media library rules and broadcasts.`, effect: 'write' as const, input: object({ item: mediaItem, ...(action === 'recordUse' ? { query: string() } : {}), ...(action === 'addWord' ? { word: string() } : {}) }, ['item', ...(action === 'recordUse' ? ['query'] : action === 'addWord' ? ['word'] : [])]), output: configResult, requires: ['running app'] })),
  ...['unfavorite', 'removeWord'].map(action => ({ name: `media.${action}`, description: `${action} by the existing media item key. Favorite removal also removes its copy.`, effect: 'write' as const, input: object({ itemKey: string(), ...(action === 'removeWord' ? { word: string() } : {}) }, ['itemKey', ...(action === 'removeWord' ? ['word'] : [])]), output: configResult, requires: ['running app'] })),
  ...['drawingIndex', 'packList'].map(action => ({ name: `media.${action}`, description: `Read the provider ${action} with pagination. May use network when uncached.`, effect: 'remote' as const, input: object(pageInput), output: configResult, requires: ['running app'] })),
  { name: 'media.drawing', description: 'Read one provider drawing fragment through its existing bounded cache.', effect: 'remote', input: object({ id: string() }, ['id']), output: configResult, requires: ['running app'] },
  ...['packStatus', 'downloadPacks', 'stopPacks', 'checkPacks', 'removePacks'].map(action => ({ name: `media.${action}`, description: `Explicit icon-pack operation: ${action}. Status does not download packs.`, effect: action === 'packStatus' ? 'read' as const : 'remote' as const, input: object({}), output: configResult, requires: ['running app'] })),
]

const declarationPatch = object({ kind: { type: 'string', enum: [...PROPERTY_KINDS] }, target: { type: ['string', 'null'] }, required: { type: ['boolean', 'null'] }, options: { type: ['array', 'null'], items: string(), maxItems: 500 }, optionSort: { type: ['string', 'null'], enum: ['manual', 'ascending', 'descending', null] } })
const vaultConfigurationCommands: CommandDefinition[] = [
  ...['declaration', 'icon'].map(resource => ({ name: `${resource}.list`, description: `List public vault ${resource} entries without creating configuration.`, effect: 'read' as const, input: object({ root: string(), ...pageInput }, ['root']), output: configResult, requires: ['explicit vault'] })),
  { name: 'declaration.patch', description: 'Patch one property declaration against the latest file. Supply kind to create it. Null removes optional fields.', effect: 'write', input: object({ root: string(), name: string(), changes: declarationPatch }, ['root', 'name', 'changes']), output: configResult, requires: ['explicit vault'] },
  { name: 'declaration.remove', description: 'Remove one property declaration without editing note values.', effect: 'write', input: object({ root: string(), name: string() }, ['root', 'name']), output: configResult, requires: ['explicit vault'] },
  { name: 'icon.set', description: 'Set one existing item’s icon while preserving other picks.', effect: 'write', input: object({ root: string(), path: string(), icon: string() }, ['root', 'path', 'icon']), output: configResult, requires: ['explicit vault and existing item'] },
  { name: 'icon.remove', description: 'Remove one icon pick, including a stale item, while preserving other picks.', effect: 'write', input: object({ root: string(), path: string() }, ['root', 'path']), output: configResult, requires: ['explicit vault'] },
  ...['read', 'patch'].map(action => ({ name: `vaultConfig.${action}`, description: `${action} public review or text-formatting configuration. Patches preserve other fields; null resets a named field.`, effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ root: string(), name: { type: 'string' as const, enum: ['review.json', 'text-formatting.json'] }, ...(action === 'patch' ? { changes: { type: 'object' as const, additionalProperties: true } } : {}) }, ['root', 'name', ...(action === 'patch' ? ['changes'] : [])]), output: configResult, requires: ['explicit vault'] })),
]

const linkPage = (items: CommandSchema): CommandSchema => { const page = pageSchema(items); return { ...page, properties: { ...page.properties, root: string(), path: string(), source: { type: 'string', enum: ['index'] } }, required: [...page.required!, 'root', 'path', 'source'] } }
const noteCommands: CommandDefinition[] = [
  { name: 'link.resolve', description: 'Resolve one link spelling in one vault through the app’s existing note, folder, and board-ID precedence. Missing links return null.', effect: 'read', input: object({ root: string(), target: string() }, ['root', 'target']), output: configResult, requires: ['explicit vault'] },
  ...['outgoing', 'incoming'].map(action => ({ name: `link.${action}`, description: action === 'incoming' ? 'Read the notes and folders that link here, as the page’s Linked mentions show them: links, embeds, folder outlines, view order and link-column targets. Path-sorted; no rewrite or ID minting.' : 'Read indexed outgoing links and embeds. A folder includes its settings and outline links. No rewrite or ID minting.', effect: 'read' as const, input: object({ ...documentTarget, ...pageInput }), output: linkPage(action === 'incoming' ? object({ kind: { type: 'string', enum: ['note', 'folder'] }, path: string(), settings: string('A folder’s settings record.'), title: string() }, ['kind', 'path', 'title']) : object({ target: string(), path: { type: ['string', 'null'] }, embedded: { type: 'boolean' } }, ['target', 'path', 'embedded'])), requires: ['explicit vault scope and target'] })),
  ...['find', 'create'].map(action => ({ name: `daily.${action}`, description: `${action} a daily note through the same template, settings, and cross-process creation lock as the app.`, effect: action === 'find' ? 'read' as const : 'write' as const, input: object({ root: string(), date: string('today, tomorrow, yesterday, or YYYY-MM-DD') }, ['root']), output: configResult, requires: ['explicit vault', 'daily notes enabled'] })),
  { name: 'template.read', description: 'Read the folder’s .template.md and saved revision, or report it absent without creating it.', effect: 'read', input: object({ root: string(), folder: string() }, ['root', 'folder']), output: configResult, requires: ['explicit vault and folder'] },
  { name: 'template.write', description: 'Write the folder template with its saved revision. Use null only to create an absent template.', effect: 'write', input: object({ root: string(), folder: string(), revision: { type: ['string', 'null'] } }, ['root', 'folder', 'revision']), output: configResult, content: 'text', contentRequired: true, requires: ['explicit vault and folder', 'saved revision or null for creation'] },
  { name: 'review.queue', description: 'Read the existing upkeep queue, most overdue first, from the metadata index.', effect: 'read', input: object({ root: string(), folder: string(), ...pageInput }, ['root']), output: configResult, requires: ['explicit vault'] },
  { name: 'review.list', description: 'Read the saved review log and revision.', effect: 'read', input: object({ ...documentTarget, ...pageInput }), output: configResult, requires: ['explicit vault scope and note'] },
  ...['keep', 'remove', 'reset', 'setEnabled'].map(action => ({ name: `review.${action}`, description: `${action} using the existing review log format and schedule rules, after checking the saved revision.`, effect: 'write' as const, input: object({ ...documentEdit, ...(action === 'remove' ? { at: string() } : {}), ...(action === 'setEnabled' ? { enabled: { type: 'boolean' as const } } : {}) }, ['revision', ...(action === 'remove' ? ['at'] : action === 'setEnabled' ? ['enabled'] : [])]), output: savedOutput, requires: documentRequires })),
]

const editorTarget = { window: string(), tab: string(), revision: string('Tab-local revision from document.live. Includes the selection state.') }
const editorCommands: CommandDefinition[] = [
  { name: 'editor.select', description: 'Set an explicit ready tab’s selection, using the coordinate system returned by document.live.', effect: 'write', input: object({ ...editorTarget, anchor: { type: 'integer', minimum: 0 }, head: { type: 'integer', minimum: 0 } }, ['window', 'tab', 'revision', 'anchor', 'head']), output: configResult, requires: ['explicit ready tab', 'current live revision'] },
  { name: 'editor.replace', description: 'Replace the current selection with plain text as one local Undo step. Autosave remains active.', effect: 'write', input: object(editorTarget, ['window', 'tab', 'revision']), output: configResult, content: 'text', contentRequired: true, requires: ['explicit ready text tab', 'current live revision'] },
  { name: 'editor.format', description: 'Toggle one supported Markdown format through the installed editor command, preserving visible-line rules.', effect: 'write', input: object({ ...editorTarget, format: { type: 'string', enum: ['bold', 'italic', 'code', 'strike'] } }, ['window', 'tab', 'revision', 'format']), output: configResult, requires: ['explicit ready Markdown tab', 'current live revision'] },
  ...['undo', 'redo', 'save'].map(action => ({ name: `editor.${action}`, description: `${action} through this ready editor’s local history or autosave. A save reports failure when the editor remains dirty.`, effect: 'write' as const, input: object(editorTarget, ['window', 'tab', 'revision']), output: configResult, requires: ['explicit ready text tab', 'current live revision'] })),
]

const connectedCommands: CommandDefinition[] = [
  { name: 'provider.status', description: 'Report whether the supported Pixabay credential is configured. Never returns its value.', effect: 'read', input: object({}), output: configResult, requires: ['running app'] },
  { name: 'provider.set', description: 'Set the Pixabay credential through protected input and refresh favorite copies.', effect: 'remote', input: object({}), output: configResult, content: 'secret', contentRequired: true, requires: ['private file or stdin credential'] },
  { name: 'provider.clear', description: 'Remove the Pixabay credential from the app secret store.', effect: 'write', input: object({}), output: configResult, requires: ['running app'] },
  ...['status', 'now', 'setEnabled'].map(action => ({ name: `sync.${action}`, description: `${action} through the app’s existing Git sync manager.`, effect: action === 'status' ? 'read' as const : 'remote' as const, input: object({ root: string(), ...(action === 'setEnabled' ? { enabled: { type: 'boolean' as const } } : {}) }, action === 'setEnabled' ? ['root', 'enabled'] : ['root']), output: configResult, requires: ['explicit vault'] })),
  { name: 'history.list', description: 'List existing Git board versions, including the pre-merge local version.', effect: 'read', input: object({ root: string(), ...targetInput, ...pageInput }, ['root']), output: configResult, requires: ['explicit vault and board'] },
  ...['read', 'export', 'restore'].map(action => ({ name: `history.${action}`, description: `${action} a board version using the existing Git history service. Restore requires the current saved revision. Export writes a JSON version bundle.`, effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ root: string(), ...targetInput, ref: string(), ...(action === 'export' ? { outputFile: string() } : action === 'restore' ? { revision: string() } : {}) }, ['root', 'ref', ...(action === 'export' ? ['outputFile'] : action === 'restore' ? ['revision'] : [])]), output: configResult, requires: ['explicit vault and board', 'existing version reference'] })),
  { name: 'share.status', description: 'Read sharing setup status without returning stored credentials.', effect: 'read', input: object({}), output: configResult, requires: ['running app'] },
  { name: 'share.accounts', description: 'Check a protected Cloudflare credential and list its available accounts.', effect: 'remote', input: object(pageInput), output: configResult, content: 'secret', contentRequired: true, requires: ['private file or stdin credential'] },
  { name: 'share.setup', description: 'Provision sharing through the existing setup service with a protected Cloudflare credential.', effect: 'remote', input: object({ accountId: string() }), output: configResult, content: 'secret', contentRequired: true, requires: ['private file or stdin credential'] },
  ...['list', 'check'].map(action => ({ name: `share.${action}`, description: action === 'list' ? 'List saved shares without contacting the server.' : 'Check saved shares against the existing sharing server.', effect: action === 'list' ? 'read' as const : 'remote' as const, input: object({ root: string(), ...pageInput }, ['root']), output: configResult, requires: ['explicit vault'] })),
  ...['get', 'stop', 'setPermission'].map(action => ({ name: `share.${action}`, description: `${action} for one board through the existing sharing service.`, effect: action === 'get' ? 'read' as const : 'remote' as const, input: object({ root: string(), ...targetInput, ...(action === 'setPermission' ? { allowDownload: { type: 'boolean' as const } } : {}) }, action === 'setPermission' ? ['root', 'allowDownload'] : ['root']), output: configResult, requires: ['explicit vault and board'] })),
  { name: 'share.publish', description: 'Publish an explicit standalone board body. Use shareId only to update an existing share.', effect: 'remote', input: object({ root: string(), ...targetInput, shareId: string() }, ['root']), output: configResult, content: 'text', contentRequired: true, requires: ['explicit vault and board', 'standalone board content'] },
  { name: 'share.setDomain', description: 'Attach a sharing hostname, or remove it with null.', effect: 'remote', input: object({ hostname: { type: ['string', 'null'], maxLength: 253 } }, ['hostname']), output: configResult, requires: ['configured sharing'] },
  { name: 'share.disconnect', description: 'Disconnect sharing for a vault or the app. Explicitly choose whether to delete remote resources.', effect: 'remote', input: object({ root: { type: ['string', 'null'], maxLength: 4096 }, deleteEverything: { type: 'boolean' } }, ['root', 'deleteEverything']), output: configResult, requires: ['explicit scope and deletion choice'] },
]

/** The allowlist grows only with an implemented adapter and its checks. No IPC channel discovery. */
export const AUTOMATION_COMMANDS: readonly CommandDefinition[] = [
  ...['state', 'install', 'cancel'].map(action => ({ name: `languageHelper.${action}`, description: `${action} for the app’s pinned code language helpers. No caller-supplied executable, download URL, or version. Cancel can run during installation.`, effect: action === 'state' ? 'read' as const : action === 'install' ? 'remote' as const : 'write' as const, input: object({}), output: configResult, requires: ['running app'] })),
  { name: 'settingsFolder.get', description: 'Read this Mac’s shared settings folder and whether it is missing.', effect: 'read', input: object({}), output: configResult, requires: ['running app'] },
  { name: 'settingsFolder.set', description: 'Choose an existing shared settings folder, or null for this Mac only. Another Mac’s file wins as in Settings. Report whether initial synchronization finished within two seconds.', effect: 'write', input: object({ folder: { type: ['string', 'null'], maxLength: 4096 } }, ['folder']), output: configResult, requires: ['explicit folder or null'] },
  { name: 'storage.stats', description: 'Measure one vault through the existing storage worker. Large-file rows are paged; totals cover the whole vault.', effect: 'read', input: object({ root: string(), ...pageInput }, ['root']), output: configResult, requires: ['explicit vault'] },
  { name: 'storage.shrink', description: 'Move eligible embedded board pictures out through the existing storage worker. Preserve its revision checks and approved-folder rules. Report converted and skipped counts.', effect: 'write', input: object({ root: string(), skip: array(string()) }, ['root']), output: configResult, requires: ['explicit vault'] },
  ...['copy', 'importCopy'].map(action => ({ name: `file.${action}`, description: action === 'copy' ? 'Copy items from this window’s vaults through the ID-aware copy service. Flush source editors first. Keep the clipboard and original files.' : 'Copy explicit external files or folders into a live window’s vault, using Finder-copy semantics. Keep originals and the clipboard. Never overwrite.', effect: 'write' as const, input: object({ window: string(), paths: { type: 'array', items: string(), maxItems: 200 }, targetDir: string() }, ['window', 'paths', 'targetDir']), output: configResult, requires: ['explicit live window, source paths, and destination folder'] })),
  { name: 'session.capture', description: 'Save an explicit live window’s current tab strip, copies and display names. Supply id only to replace an existing session.', effect: 'write', input: object({ window: string(), name: string(), id: string() }, ['window', 'name']), output: configResult, requires: ['explicit live window with tabs'] },
  { name: 'vault.patch', description: 'Patch this vault’s display name or number key through the existing store. Null clears either value.', effect: 'write', input: object({ root: string(), changes: object({ name: { type: ['string', 'null'], maxLength: 200 }, key: { type: ['integer', 'null'], minimum: 1, maximum: 9 } }) }, ['root', 'changes']), output: configResult, requires: ['explicit vault'] },
  ...['list', 'allow', 'remove'].map(action => ({ name: `pictureFolder.${action}`, description: `${action} an allowed external picture folder. Uses the existing system-folder and symbolic-link checks. Removing permission does not delete files.`, effect: action === 'list' ? 'read' as const : 'write' as const, input: object(action === 'list' ? {} : { folder: string() }, action === 'list' ? [] : ['folder']), output: configResult, requires: ['running app'] })),
  { name: 'media.favoriteCopies', description: 'Report saved favorite copy counts and sizes through the library service.', effect: 'read', input: object({}), output: configResult, requires: ['running app'] },
  { name: 'media.favoriteElements', description: 'Read a saved favorite’s element fragment, or null when none exists.', effect: 'read', input: object({ itemKey: string() }, ['itemKey']), output: configResult, requires: ['existing media item key'] },
  { name: 'media.favoritesForPanel', description: 'List shape favorites still missing their element copies.', effect: 'read', input: object(pageInput), output: configResult, requires: ['running app'] },
  { name: 'media.saveFavoriteElements', description: 'Save a missing favorite element copy through the library service, within its fragment limit.', effect: 'write', input: object({ itemKey: string() }, ['itemKey']), output: configResult, content: 'text', contentRequired: true, requires: ['existing media item key'] },
  { name: 'newPlace.list', description: 'Read the three New note shortcuts for a vault.', effect: 'read', input: object({ root: string() }, ['root']), output: configResult, requires: ['explicit vault'] },
  { name: 'newPlace.set', description: 'Set or clear one zero-based New note shortcut, preserving the other current slots.', effect: 'write', input: object({ root: string(), slot: { type: 'integer', minimum: 0, maximum: 2 }, folder: { type: ['string', 'null'], maxLength: 4096 } }, ['root', 'slot', 'folder']), output: configResult, requires: ['explicit vault and slot'] },
  { name: 'folder.create', description: 'Create a folder through the app’s ID-aware creation service. Title is optional and requires an ID vault. Never replaces an existing folder.', effect: 'write', input: object({ ...resourceInput, path: string(), title: string() }, ['path']), output: configResult, requires: ['explicit vault scope and new folder path'] },
  ...['asset', 'image', 'pdf'].flatMap(kind => ['read', 'export'].map(action => ({ name: `${kind}.${action}`, description: action === 'read' ? 'Read saved binary content as base64 with a saved revision. Large viewer files require export.' : 'Export saved bytes to an explicit new file. Never overwrites. Retains the existing file-kind size limit.', effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ ...resourceInput, ...targetInput, ...(action === 'export' ? { outputFile: string() } : {}) }, action === 'export' ? ['outputFile'] : []), output: configResult, requires: ['explicit vault scope and target'] }))),
  { name: 'asset.write', description: 'Write image bytes or UTF-8 embedded drawing JSON through the asset service. Use a saved revision for replacement, or null for exclusive creation. Retains the 10 MiB asset limit.', effect: 'write', input: object({ ...resourceInput, path: string(), revision: { type: ['string', 'null'] } }, ['path', 'revision']), output: configResult, content: 'binary', contentRequired: true, requires: ['explicit vault and asset path', 'saved revision or null for creation'] },
  ...documentCommands,
  ...configurationCommands,
  ...groupCommands,
  ...boardCommands,
  ...['drawing', 'diagram'].flatMap(kind => [
    { name: `${kind}.create`, description: 'Create an empty stamped board through the format service. Never replaces an existing file.', effect: 'write' as const, input: object({ ...resourceInput, path: string() }, ['path']), output: configResult, requires: ['explicit vault scope and new path'] },
    { name: `${kind}.setReadOnly`, description: 'Change the human Read only switch with a required saved revision. Agent writing does not require changing this switch.', effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, revision: string(), on: { type: 'boolean' as const } }, ['revision', 'on']), output: configResult, requires: ['explicit board and saved revision'] },
  ]),
  ...([
    { name: 'setHoverLinks', fields: { on: { type: 'boolean' } }, required: ['on'] },
    { name: 'setHoverOutline', fields: { value: { type: ['boolean', 'string'], enum: [true, false, 'app'] } }, required: ['value'] },
    { name: 'setFoldArrows', fields: { value: { type: 'string', enum: ['app', 'hover', 'always', 'off'] } }, required: ['value'] },
    { name: 'setPictures', fields: { out: { type: 'boolean' }, folder: string() }, required: ['out'] },
  ] as { name: string; fields: Record<string, CommandSchema>; required: string[] }[]).map(item => ({ name: `drawing.${item.name}`, description: 'Change this drawing option through the existing format service under its revision guard. Picture folders retain existing approval rules.', effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, revision: string(), ...item.fields }, ['revision', ...item.required]), output: configResult, requires: ['explicit drawing and saved revision'] })),
  ...editorCommands,
  ...noteCommands,
  ...vaultConfigurationCommands,
  ...mediaCommands,
  ...connectedCommands,
  ...['show', 'close', 'rename'].map(action => ({ name: `window.${action}`, description: action === 'close' ? 'Acknowledge, then close the named window through its normal flush path. Closing the last window stops this app instance.' : `${action} an explicit live window. Rename persists its display name.`, effect: 'navigate' as const, input: object({ window: string(), ...(action === 'rename' ? { name: { type: ['string', 'null'] as const, maxLength: 200 } } : {}) }, action === 'rename' ? ['window', 'name'] : ['window']), output: configResult, requires: ['explicit live window'] })),
  { name: 'tab.open', description: 'Open a kept tab in an explicit window. Optional background/copy flags follow the existing tab rules.', effect: 'navigate', input: object({ window: string(), ...targetInput, background: { type: 'boolean' }, copy: { type: 'boolean' } }, ['window']), output: configResult, requires: ['explicit live window and target'] },
  { name: 'tab.blank', description: 'Show this window’s blank new-tab page.', effect: 'navigate', input: object({ window: string() }, ['window']), output: configResult, requires: ['explicit live window'] },
  ...['close', 'duplicate', 'keep', 'sleep', 'wake'].map(action => ({ name: `tab.${action}`, description: `${action} one exact tab through the existing workspace action. Close, sleep, and duplicate first save its editor and refuse unresolved dirty state.`, effect: 'navigate' as const, input: object({ window: string(), tab: string() }, ['window', 'tab']), output: configResult, requires: ['explicit live window and tab'] })),
  { name: 'tab.rename', description: 'Set a tab’s display name, or null to use the page name. Does not rename the file.', effect: 'navigate', input: object({ window: string(), tab: string(), name: { type: ['string', 'null'], maxLength: 200 } }, ['window', 'tab', 'name']), output: configResult, requires: ['explicit live window and tab'] },
  { name: 'tab.reorder', description: 'Move one tab to a zero-based final index in this window’s strip.', effect: 'navigate', input: object({ window: string(), tab: string(), index: { type: 'integer', minimum: 0 } }, ['window', 'tab', 'index']), output: configResult, requires: ['explicit live window and tab'] },
  { name: 'sidebar.setCollapsed', description: 'Show or hide the explicit window’s sidebar without changing its lens.', effect: 'navigate', input: object({ window: string(), collapsed: { type: 'boolean' } }, ['window', 'collapsed']), output: configResult, requires: ['explicit live window'] },
  { name: 'session.restore', description: 'Restore a saved session in a window with exactly its vaults. Preserve existing tabs and unrelated windows. Missing items require allowPartial.', effect: 'navigate', input: object({ session: string(), window: string(), mode: { type: 'string', enum: ['reuse', 'new'] }, allowPartial: { type: 'boolean' } }, ['session']), output: configResult, requires: ['existing session ID or unique name'] },
  { name: 'app.diagnostics', description: 'Read platform and process memory facts through the existing memory report. No secret store is read.', effect: 'read', input: object({}), output: configResult, requires: ['running app'] },
  { name: 'app.restart', description: 'Acknowledge, flush, and relaunch this same app/profile. Does not install a staged update. Receipts expire on restart.', effect: 'write', input: object({}), output: configResult, requires: ['running app'] },
  ...['state', 'notes', 'check', 'restart'].map(action => ({ name: `update.${action}`, description: action === 'restart' ? 'Install a ready staged update after acknowledgement, or return the manual release URL. Refuses when no update is ready.' : `${action} through the app’s existing updater. Development checks preserve the updater’s disabled-feed rule.`, effect: action === 'check' ? 'remote' as const : action === 'restart' ? 'write' as const : 'read' as const, input: object({}), output: configResult, requires: ['running app'] })),
  { name: 'file.history', description: 'Read this live window’s bounded organization Undo and Redo history, oldest first. History ends with the app session.', effect: 'read', input: object({ window: string() }, ['window']), output: configResult, requires: ['explicit live window'] },
  { name: 'file.restore', description: 'Restore the latest organization step only if it is a delete. Wait for all put-back results and retain Redo. A newer move or rename is refused.', effect: 'write', input: object({ window: string() }, ['window']), output: configResult, requires: ['explicit live window', 'latest Undo step is a delete with known Trash locations'] },
  { name: 'file.rename', description: 'Rename or move an item through the complete window action: buffer flush, path repair, link updates, and Undo.', effect: 'write', input: object({ window: string(), path: string(), newPath: string() }, ['window', 'path', 'newPath']), output: configResult, requires: ['explicit live window', 'source and destination in its vaults'] },
  { name: 'file.retitle', description: 'Change a note or folder title using the existing complete rename action and Undo.', effect: 'write', input: object({ window: string(), path: string(), title: string() }, ['window', 'path', 'title']), output: configResult, requires: ['explicit live window'] },
  { name: 'file.trash', description: 'Move items to OS Trash through the existing app action, retaining restore locations and Undo where supported.', effect: 'write', input: object({ window: string(), paths: { ...array(string()), maxItems: 200 } }, ['window', 'paths']), output: configResult, requires: ['explicit live window', 'items inside its vaults'] },

  { name: 'window.list', description: 'List live full windows, most recently focused first. This is not persisted session restoration state.', effect: 'read', input: object(pageInput), output: pageSchema({ type: 'object', additionalProperties: true }), requires: ['running app'] },
  { name: 'window.inspect', description: 'Read current tabs, active tab, vaults, sidebar, and current/supported folder views. Unavailable view surfaces are explicit.', effect: 'read', input: object({ window: string() }, ['window']), output: { type: 'object', additionalProperties: true }, requires: ['explicit live window'] },
  { name: 'document.live', description: 'Read a ready editor buffer and selection from an explicit live tab. Never substitutes saved disk content.', effect: 'read', input: object({ window: string(), tab: string() }, ['window', 'tab']), output: object({ path: string(), tab: string(), source: { type: 'string', enum: ['live'] }, kind: { type: 'string', enum: ['markdown', 'text', 'drawing', 'diagram'] }, revision: string(), actions: array(string()), content: { type: 'string', maxLength: 64 * 1024 * 1024 }, baselineMtime: { type: 'number' }, dirty: { type: 'boolean' }, selection: object({ anchor: { type: 'integer' }, head: { type: 'integer' }, text: { type: 'string', maxLength: 10 * 1024 * 1024 }, coordinate: { type: 'string', enum: ['prosemirror', 'utf16'] } }) }, ['path', 'tab', 'source', 'kind', 'content', 'baselineMtime', 'dirty']), requires: ['explicit live window and ready tab'] },

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
