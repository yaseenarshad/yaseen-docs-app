import { MEDIA_COLOR_FILTERS, MEDIA_STYLE_FILTERS, MEDIA_LICENSE_FILTERS, MAX_FILTER_PACKS } from './iconPacks'
import { PROPERTY_KINDS, MEDIA_ZOOM_WIDTHS, DEFAULT_SETTINGS, SIDEBAR_TABS } from './types'
import { AUTOMATION_LIMITS, AutomationFailure } from './automation'
import { DRAWING_ACTIONS, DRAWING_VIEW_ACTIONS, type DrawingAction } from './automationEditor'

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
  panel: { type: 'string', enum: ['right'], description: 'Open the target page in the right panel, as Open to the right does.' },
  sidebar: { type: 'string', enum: ['files', 'favorites', 'focus', 'search', 'sessions', 'recents'] },
  scope: scopeInput.scope, group: string(), view: string(), reveal: { type: 'boolean' }, allowPartial: { type: 'boolean' },
})
export const searchRowSchema = object({ kind: { type: 'string', enum: ['file', 'dir'] }, name: string(), lower: string(), label: string(), path: string(), folder: string(), id: string(), was: array(string()) }, ['kind', 'name', 'label', 'path', 'folder'])
export const pageSchema = (items: CommandSchema): CommandSchema => object({ items: array(items), total: { type: 'integer' }, nextOffset: { type: ['integer', 'null'], description: 'Next offset, or null when complete.' } }, ['items', 'total', 'nextOffset'])
const number = { type: 'number' } as CommandSchema, integer = { type: 'integer' } as CommandSchema, boolean = { type: 'boolean' } as CommandSchema
const largeText = { type: 'string', maxLength: AUTOMATION_LIMITS.contentBytes } as CommandSchema
const nullable = (schema: CommandSchema): CommandSchema => ({ ...schema, type: [schema.type as SchemaType, 'null'] })
const literal = (value: string | boolean): CommandSchema => ({ type: typeof value as SchemaType, enum: [value] })
/** Content with open keys: frontmatter, stored options, provider data. The description says which, so a reader knows why. */
const open = (description: string): CommandSchema => ({ type: 'object', additionalProperties: true, description })
/** An object result: every listed field is required unless named in `optional`. */
const result = (properties: Record<string, CommandSchema>, optional: readonly string[] = []): CommandSchema => object(properties, Object.keys(properties).filter(key => !optional.includes(key)))
/** A page of items plus fields about the whole list. */
const pageWith = (items: CommandSchema, fields: Record<string, CommandSchema> = {}, optional: readonly string[] = []): CommandSchema => result({ ...fields, items: array(items), total: integer, nextOffset: pageSchema(items).properties!.nextOffset }, optional)
const saved = { diskSaved: boolean }

export const validateInput = (schema: CommandSchema, value: unknown, path = 'input'): void => validateValue(schema, value, path, 'INVALID_INPUT')
/** A command's result, as the wire carries it (JSON), against its declared output (YAZ-4506). Tests run it; see `prepareAutomation`. */
export const validateOutput = (name: string, value: unknown): void => validateValue(commandDefinition(name).output, value === undefined ? value : JSON.parse(JSON.stringify(value)), `${name} output`, 'OUTPUT_MISMATCH')

function validateValue(schema: CommandSchema, value: unknown, path: string, code: string): void {
  const fail = (reason: string): never => { throw new AutomationFailure(code, `${path}: ${reason}`) }
  const check = (schema: CommandSchema, value: unknown, path: string) => validateValue(schema, value, path, code)
  if (typeof schema.type !== 'string') {
    for (const type of schema.type) {
      try { check({ ...schema, type }, value, path); return } catch { /* Try the next declared type. */ }
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
        if (field) check(field, record[name], `${path}.${name}`)
        else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, record[name], `${path}.${name}`)
        else if (schema.additionalProperties !== true) fail(`unknown field ${name}`)
      }
      break
    }
    case 'array':
      if (!Array.isArray(value)) return fail('expected an array')
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items')
      value.forEach((item, index) => schema.items && check(schema.items, item, `${path}[${index}]`))
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
  { name: 'comment.list', description: 'Read comments with stable IDs, ownership, and a saved revision.', effect: 'read', input: object({ ...documentTarget, ...pageInput }), output: pageWith({ ...object({ id: string(), n: integer, at: string(), title: string(), body: largeText, reply_to: string('The top-level parent’s ID.'), edited: string(), by: string('Who left it; absent for a person at the keyboard.') }, ['id', 'at', 'body']), additionalProperties: true, description: 'A comment as the note stores it. Extra keys in the file are kept.' }, { path: string(), revision: string() }), requires: ['running app', 'explicit vault scope and one target'] },
  { name: 'comment.add', description: 'Add an agent comment or reply to a top-level comment.', effect: 'write', input: object({ ...documentEdit, replyTo: string(), title: string(), by: string() }, ['revision']), output: savedOutput, content: 'text', contentRequired: true, requires: documentRequires },
  { name: 'comment.update', description: 'Edit an agent-owned comment. Human comments cannot be changed here.', effect: 'write', input: object({ ...documentEdit, comment: string(), title: string() }, ['revision', 'comment']), output: savedOutput, content: 'text', contentRequired: true, requires: documentRequires },
  { name: 'comment.remove', description: 'Delete an agent-owned comment and its replies.', effect: 'write', input: object({ ...documentEdit, comment: string() }, ['revision', 'comment']), output: savedOutput, requires: documentRequires },
  { name: 'note.create', description: 'Find or create a note by title using the existing folder template and ID rules.', effect: 'write', input: object({ ...resourceInput, folder: string(), title: string() }, ['folder', 'title']), output: object({ path: string(), title: string(), id: { type: ['string', 'null'] }, created: { type: 'boolean' }, others: array(string()) }, ['path', 'title', 'id', 'created', 'others']), content: 'text', requires: ['running app', 'explicit vault scope and folder'] },
]

/** Every top-level setting, typed from its default, so a new setting is in the schema at once. settings.patch validates each value exactly. */
const settingsSchema = object(Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, value]): [string, CommandSchema] => [key,
  value === null ? { type: ['string', 'null'], description: 'An absolute folder or a colour; null is the default.' }
    : Array.isArray(value) ? { type: 'array', description: 'A settings list. settings.patch validates its items.' }
    : typeof value === 'object' ? open('A settings group. settings.patch validates its fields.')
    : { type: typeof value as SchemaType }])), Object.keys(DEFAULT_SETTINGS))
const storedTab = object({ path: string(), name: string(), zoom: string(), active: literal(true) }, ['path'])
const vaultEntry = result({ path: string(), name: string(), key: nullable(integer), open: boolean, lastUsed: nullable(number) })
const workspaceEntry = result({ id: string(), name: string(), roots: array(string()), lastUsed: number })
const sessionEntry = result({ id: string(), name: string(), tabs: array(storedTab), roots: array(string()), lastUsed: number })
const removedEntry = result({ id: string(), removed: literal(true) })
const collectionList = { root: string(), kind: { type: 'string', enum: ['favorites', 'focus'] } as CommandSchema, scope: { type: 'string', enum: ['vault', 'workspace'] } as CommandSchema }
const pictureFolders = { folders: array(string('An allowed external picture folder.')) }
const collectionInput = { root: string(), kind: { type: 'string', enum: ['favorites', 'focus'] } as CommandSchema, scope: scopeInput.scope }
const configurationCommands: CommandDefinition[] = [
  { name: 'settings.get', description: 'Read supported app settings. Secret values are held separately and never returned.', effect: 'read', input: object({}), output: result({ settings: settingsSchema }), requires: ['running app'] },
  { name: 'settings.patch', description: 'Validate named fields, patch the latest settings, and await durable storage.', effect: 'write', input: object({ changes: { type: 'object', additionalProperties: true } }, ['changes']), output: result({ settings: settingsSchema, ...saved }), requires: ['running app'] },
  { name: 'vault.list', description: 'List known vaults from app state.', effect: 'read', input: object(pageInput), output: pageSchema(vaultEntry), requires: ['running app'] },
  { name: 'workspace.create', description: 'Save a new workspace with at least two vaults. Existing names are refused.', effect: 'write', input: object({ name: string(), roots: array(string()) }, ['name', 'roots']), output: result({ workspace: workspaceEntry, ...saved }), requires: ['running app', 'existing vault folders'] },
  { name: 'workspace.update', description: 'Update the vaults of an existing saved workspace, retaining its ID and name.', effect: 'write', input: object({ id: string(), roots: array(string()) }, ['id', 'roots']), output: result({ workspace: workspaceEntry, ...saved }), requires: ['saved workspace ID'] },
  ...['workspace', 'session'].flatMap(resource => [
    { name: `${resource}.rename`, description: `Rename a saved ${resource} without changing its identity.`, effect: 'write' as const, input: object({ id: string(), name: string() }, ['id', 'name']), output: result({ [resource]: resource === 'workspace' ? workspaceEntry : sessionEntry, ...saved }), requires: [`saved ${resource} ID`] },
    { name: `${resource}.remove`, description: `Remove a saved ${resource}. Its files and live windows remain.`, effect: 'write' as const, input: object({ id: string() }, ['id']), output: result({ [resource]: removedEntry, ...saved }), requires: [`saved ${resource} ID`] },
  ]),
  { name: 'session.list', description: 'List saved sessions, labeled separately from live windows.', effect: 'read', input: object(pageInput), output: pageWith(sessionEntry, { source: { type: 'string', enum: ['saved'] } }), requires: ['running app'] },
  { name: 'session.save', description: 'Save explicit tabs and vaults as a session, or update an existing session by ID.', effect: 'write', input: object({ id: string(), name: string(), roots: array(string()), tabs: array(object({ path: string(), name: string(), zoom: string(), active: { type: 'boolean', enum: [true] } }, ['path'])) }, ['roots', 'tabs']), output: result({ session: sessionEntry, ...saved }), requires: ['running app', 'existing files inside the supplied vaults'] },
  { name: 'collection.list', description: 'Read ordered Favorites or Focus members for one vault and explicit list scope.', effect: 'read', input: object({ ...collectionInput, ...pageInput }, ['root', 'kind', 'scope']), output: pageWith(string('A member path, in list order.'), collectionList), requires: ['existing vault'] },
  ...['add', 'remove', 'reorder'].map(action => ({ name: `collection.${action}`, description: `${action} members against the latest Favorites or Focus list. Reorder requires the complete current list.`, effect: 'write' as const, input: object({ ...collectionInput, paths: array(string()) }, ['root', 'kind', 'scope', 'paths']), output: result({ ...collectionList, items: array(string('A member path, in list order.')), ...saved }), requires: ['existing vault', 'explicit list scope'] })),
]

const groupInput = { ...resourceInput, kind: collectionInput.kind, scope: scopeInput.scope }
const groupItem = result({ vault: string('The vault’s folder name.'), path: string('The path inside that vault.') })
const groupFields = { id: string(), name: string(), created: number, at: number, items: array(groupItem), deleted: literal(true), pos: integer }
const groupEntry = result(groupFields, ['deleted', 'pos'])
const resolvedItem = result({ vault: string(), path: string('Absolute when the vault is open here; otherwise the path inside the vault.'), ghost: string('The vault name when no open vault has it.'), clash: literal(true) }, ['ghost', 'clash'])
const groupScope = { roots: array(string()), kind: collectionList.kind, scope: collectionList.scope }
const groupWrite = result({ ...groupScope, group: groupEntry, ...saved })
const groupCommands: CommandDefinition[] = [
  { name: 'group.list', description: 'List named Favorites or Focus groups and resolve each member, including missing vaults.', effect: 'read', input: object({ ...groupInput, ...pageInput }, ['kind', 'scope']), output: pageWith(result({ ...groupFields, resolvedItems: array(resolvedItem) }, ['deleted', 'pos']), groupScope), requires: ['explicit vault scope'] },
  { name: 'group.create', description: 'Create a named collection group using the existing group identity and format.', effect: 'write', input: object({ ...groupInput, name: string() }, ['kind', 'scope', 'name']), output: groupWrite, requires: ['explicit vault scope'] },
  { name: 'group.rename', description: 'Rename one collection group by ID or unique name.', effect: 'write', input: object({ ...groupInput, group: string(), name: string() }, ['kind', 'scope', 'group', 'name']), output: groupWrite, requires: ['explicit vault scope'] },
  { name: 'group.remove', description: 'Delete one collection group with the existing tombstone rule. Its files remain.', effect: 'write', input: object({ ...groupInput, group: string() }, ['kind', 'scope', 'group']), output: groupWrite, requires: ['explicit vault scope'] },
  { name: 'group.position', description: 'Set one group’s position in the sidebar order.', effect: 'write', input: object({ ...groupInput, group: string(), position: { type: 'integer', minimum: 0 } }, ['kind', 'scope', 'group', 'position']), output: groupWrite, requires: ['explicit vault scope'] },
  ...['addItems', 'removeItems', 'reorderItems'].map(action => ({ name: `group.${action}`, description: `${action} in a named collection group, preserving other groups and existing membership rules.`, effect: 'write' as const, input: object({ ...groupInput, group: string(), paths: array(string()), ...(action === 'addItems' ? {} : { items: array(object({ vault: string(), path: string() }, ['vault', 'path'])) }) }, action === 'addItems' ? ['kind', 'scope', 'group', 'paths'] : ['kind', 'scope', 'group']), output: groupWrite, requires: ['explicit vault scope'] })),
]

const boardFile = { path: string(), mtime: number, size: integer }
/** A board option write: the file's new mtime and size. Read the board again for its revision. */
export const boardWritten = object({ ...boardFile, diskSaved: boolean, rendererMerged: boolean }, ['path', 'mtime', 'size', 'diskSaved'])
const boardSaved = object({ ...boardFile, revision: string(), persisted: array(string()), inside: boolean, movedOut: boolean, id: string(), diskSaved: boolean, rendererMerged: boolean }, ['path', 'mtime', 'size', 'revision', 'diskSaved', 'rendererMerged'])
const boardRead = (kind: string) => kind === 'drawing'
  ? object({ ...boardFile, revision: string(), source: { type: 'string', enum: ['disk'] }, json: largeText, stored: array(string()), files: { type: 'object', additionalProperties: object({ mimeType: string(), dataURL: largeText }, ['mimeType', 'dataURL']) } }, ['path', 'mtime', 'size', 'revision', 'source', 'json', 'files', 'stored'])
  : object({ ...boardFile, revision: string(), source: { type: 'string', enum: ['disk'] }, xml: largeText }, ['path', 'mtime', 'size', 'revision', 'source', 'xml'])
const exportSettings = {
  background: { ...boolean, description: 'Export the canvas background. Default: the export box’s current setting.' },
  darkMode: { ...boolean, description: 'Export in dark mode. Default: the export box’s current setting.' },
  scale: { type: 'integer', enum: [1, 2, 3], description: 'PNG/SVG scale. Not for PDF.' } as CommandSchema,
  embedScene: { ...boolean, description: 'Embed the scene in the PNG/SVG. Not for PDF.' },
  selectionOnly: { ...boolean, description: 'Export only the selection. Default: true when something is selected, as in the export box.' },
}
const boardCommands: CommandDefinition[] = ['drawing', 'diagram'].flatMap(kind => [
  { name: `${kind}.read`, description: `Read a saved ${kind} through its existing format and asset service, with a revision. A file over the connection limit is refused before it is read; use export.`, effect: 'read' as const, input: object({ ...resourceInput, ...targetInput }), output: boardRead(kind), requires: ['explicit vault scope and target'] },
  { name: `${kind}.save`, description: `Save a ${kind} with a required saved revision. Refused while an open editor holds unsaved edits of this file. Embedded image data uses the existing asset rules. Large content can come from sourceFile.`, effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, revision: string(), sourceFile: string() }, ['revision']), output: boardSaved, content: 'text' as const, requires: ['explicit vault scope and target', 'saved revision', 'body or source file', 'no unsaved live edits of the file'] },
  { name: `${kind}.export`, description: `Copy the saved ${kind} file to a new standalone ${kind === 'drawing' ? '.excalidraw' : '.drawio'} file, pictures embedded, without overwriting. This is not the GUI’s standard-font copy and not an image; use ${kind}.exportImage for PNG, SVG${kind === 'drawing' ? ', or PDF' : ''}.`, effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, outputFile: string() }, ['outputFile']), output: object({ path: string(), outputFile: string(), revision: string(), size: integer, source: { type: 'string', enum: ['disk'] }, diskSaved: boolean }, ['path', 'outputFile', 'revision', 'size', 'source', 'diskSaved']), requires: ['explicit vault scope and target', 'new output file'] },
  { name: `${kind}.exportImage`, description: kind === 'drawing'
    ? 'Export a live drawing tab as PNG, SVG, or PDF through the GUI export box’s own renderer and PDF printer, with no dialog. Unsaved canvas edits are included; the board file is not touched. Writes a new file only; the extension must match the format.'
    : 'Export a live diagram tab as PNG or SVG through File › Export Image…’s renderer, with no dialog. Unsaved edits are included; the board file is not touched. Writes a new file only. The GUI has no diagram PDF.', effect: 'write' as const,
    input: object({ window: string(), tab: string(), format: { type: 'string', enum: kind === 'drawing' ? ['png', 'svg', 'pdf'] : ['png', 'svg'] }, outputFile: string('Absolute path of a new file.'), ...(kind === 'drawing' ? exportSettings : {}) }, ['window', 'tab', 'format', 'outputFile']),
    output: object({ window: string(), tab: string(), path: string(), format: string(), outputFile: string(), size: integer, dirty: boolean, source: { type: 'string', enum: ['live'] }, diskSaved: boolean }, ['window', 'tab', 'path', 'format', 'outputFile', 'size', 'dirty', 'source', 'diskSaved']), requires: [`explicit live window and ready ${kind} tab`, 'new output file'] },
])

const mediaItem = object({ itemKey: string(), provider: string(), providerId: string(), kind: string(), title: string(), previewUrl: string(), creator: string(), creatorUrl: string(), collectionName: string(), sourceUrl: string(), licenseName: string(), licenseUrl: string(), attribution: string(), width: { type: 'number' }, height: { type: 'number' }, trademarkNotice: { type: 'boolean' } }, ['itemKey', 'provider', 'providerId', 'kind', 'title'])
const libraryItem = result({ ...mediaItem.properties, updatedAt: number, count: integer, words: array(string()) }, [...Object.keys(mediaItem.properties!).filter(key => !mediaItem.required!.includes(key)), 'count', 'words'])
const componentItem = result({ slug: string(), name: string(), elementCount: integer, createdAt: number, updatedAt: number })
const exported = { outputFile: string(), size: integer, ...saved }
const iconPacksStatus = result({ state: { type: 'string', enum: ['none', 'partial', 'complete', 'downloading', 'checking', 'removing', 'moving'] }, folder: string(), version: nullable(string()), packs: integer, total: integer, bytes: number, totalBytes: number, checkedAt: nullable(number), message: nullable(string()), failed: boolean })
const iconPack = result({ prefix: string(), name: string(), total: integer, license: result({ title: string(), spdx: string(), url: string() }, ['spdx', 'url']), category: string(), palette: boolean }, ['category'])
const itemKeyDone = result({ itemKey: string(), ...saved })
const mediaOutputs: Record<string, CommandSchema> = {
  'component.read': result({ slug: string(), fragmentJson: largeText }), 'component.remove': result({ slug: string(), removed: literal(true), ...saved }), 'component.export': result(exported),
  'media.preview': result({ mimeType: string(), dataURL: largeText }), 'media.import': result({ ...exported, item: mediaItem, mimeType: string() }),
  'media.favorite': itemKeyDone, 'media.recordUse': itemKeyDone, 'media.addWord': itemKeyDone, 'media.removeWord': itemKeyDone, 'media.unfavorite': result({ itemKey: string(), removed: literal(true), ...saved }),
  'media.drawingIndex': pageSchema(mediaItem), 'media.packList': pageSchema(iconPack),
}
const mediaCommands: CommandDefinition[] = [
  { name: 'component.list', description: 'List saved library components, newest first.', effect: 'read', input: object(pageInput), output: pageSchema(componentItem), requires: ['running app'] },
  ...['read', 'remove', 'export'].map(action => ({ name: `component.${action}`, description: `${action} a saved component by its stable library slug. Export creates a new file.`, effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ slug: string(), ...(action === 'export' ? { outputFile: string() } : {}) }, ['slug', ...(action === 'export' ? ['outputFile'] : [])]), output: mediaOutputs[`component.${action}`], requires: ['running app'] })),
  { name: 'component.rename', description: 'Change a saved component label while retaining its slug and files.', effect: 'write', input: object({ slug: string(), name: string() }, ['slug', 'name']), output: result({ component: componentItem, ...saved }), requires: ['running app'] },
  { name: 'component.save', description: 'Save a component through the existing library store. The JSON body requires fragmentJson and previewPng.', effect: 'write', input: object({ name: string() }, ['name']), output: result({ component: componentItem, ...saved }), content: 'json', contentRequired: true, requires: ['running app', 'fragment and preview JSON body'] },
  { name: 'media.search', description: 'Search existing media providers and local packs. May contact configured providers; uses their cursor and cache.', effect: 'remote', input: object({ query: { ...string(), maxLength: 120 }, source: { type: 'string', enum: ['all', 'iconify', 'pixabay'] }, cursor: { type: ['string', 'null'] }, filters: object({ colors: { type: 'string', enum: [...MEDIA_COLOR_FILTERS] }, style: { type: 'string', enum: [...MEDIA_STYLE_FILTERS] }, license: { type: 'string', enum: [...MEDIA_LICENSE_FILTERS] }, packs: { ...array(string()), maxItems: MAX_FILTER_PACKS } }, ['colors', 'style', 'license', 'packs']) }, ['query', 'source']), output: result({ items: array(mediaItem), nextCursor: nullable(string('Pass back as cursor for the next page.')), pixabayAvailable: boolean, warnings: array(string('A provider that failed while another answered.')) }), requires: ['running app'] },
  ...['preview', 'import'].map(action => ({ name: `media.${action}`, description: `${action} provider media through the existing cache. Import writes an explicit new destination without replacing it.`, effect: 'remote' as const, input: object({ provider: { type: 'string' as const, enum: ['pixabay', 'iconify'] }, id: string(), zoomWidth: { type: 'integer' as const, enum: [...MEDIA_ZOOM_WIDTHS] }, ...(action === 'import' ? { outputFile: string() } : {}) }, ['provider', 'id', ...(action === 'import' ? ['outputFile'] : [])]), output: mediaOutputs[`media.${action}`], requires: ['running app'] })),
  { name: 'media.library', description: 'Read one paged library list.', effect: 'read', input: object({ kind: { type: 'string', enum: ['favorites', 'recent', 'used'] }, ...pageInput }, ['kind']), output: pageWith(libraryItem, { kind: { type: 'string', enum: ['favorites', 'recent', 'used'] } }), requires: ['running app'] },
  ...['favorite', 'recordUse', 'addWord'].map(action => ({ name: `media.${action}`, description: `${action} through the existing media library rules and broadcasts.`, effect: 'write' as const, input: object({ item: mediaItem, ...(action === 'recordUse' ? { query: string() } : {}), ...(action === 'addWord' ? { word: string() } : {}) }, ['item', ...(action === 'recordUse' ? ['query'] : action === 'addWord' ? ['word'] : [])]), output: mediaOutputs[`media.${action}`], requires: ['running app'] })),
  ...['unfavorite', 'removeWord'].map(action => ({ name: `media.${action}`, description: `${action} by the existing media item key. Favorite removal also removes its copy.`, effect: 'write' as const, input: object({ itemKey: string(), ...(action === 'removeWord' ? { word: string() } : {}) }, ['itemKey', ...(action === 'removeWord' ? ['word'] : [])]), output: mediaOutputs[`media.${action}`], requires: ['running app'] })),
  ...['drawingIndex', 'packList'].map(action => ({ name: `media.${action}`, description: `Read the provider ${action} with pagination. May use network when uncached.`, effect: 'remote' as const, input: object(pageInput), output: mediaOutputs[`media.${action}`], requires: ['running app'] })),
  { name: 'media.drawing', description: 'Read one provider drawing fragment through its existing bounded cache.', effect: 'remote', input: object({ id: string() }, ['id']), output: result({ elements: array(open('An Excalidraw element as the provider serves it.')) }), requires: ['running app'] },
  ...['packStatus', 'downloadPacks', 'stopPacks', 'checkPacks', 'removePacks'].map(action => ({ name: `media.${action}`, description: `Explicit icon-pack operation: ${action}. Status does not download packs.`, effect: action === 'packStatus' ? 'read' as const : 'remote' as const, input: object({}), output: iconPacksStatus, requires: ['running app'] })),
]

const declarationPatch = object({ kind: { type: 'string', enum: [...PROPERTY_KINDS] }, target: { type: ['string', 'null'] }, required: { type: ['boolean', 'null'] }, options: { type: ['array', 'null'], items: string(), maxItems: 500 }, optionSort: { type: ['string', 'null'], enum: ['manual', 'ascending', 'descending', null] } })
const declarationRow = result({ name: string(), kind: { type: 'string', enum: [...PROPERTY_KINDS] }, options: array(string()), optionSort: { type: 'string', enum: ['manual', 'ascending', 'descending'] }, target: string(), required: boolean }, ['options', 'optionSort', 'target', 'required'])
const vaultConfigOutputs: Record<string, CommandSchema> = {
  declaration: pageWith(declarationRow, { root: string(), version: { ...integer, description: 'properties.json version; above 1 is readable, not writable.' }, error: string('properties.json exists but is unusable.'), ...saved }, ['error', 'diskSaved']),
  icon: pageWith(result({ path: string(), icon: string() }), { root: string(), ...saved }, ['diskSaved']),
}
const vaultConfigValue = (nullable: boolean): CommandSchema => ({ type: nullable ? ['object', 'null'] : 'object', additionalProperties: true, description: `The file’s content: its fields are the file’s own${nullable ? '; null when the file is absent' : ''}.` })
const newPlaces = { root: string(), places: array({ type: ['string', 'null'], maxLength: 4096, description: 'A folder, or null for an empty slot. Three slots.' }) }
const vaultConfigurationCommands: CommandDefinition[] = [
  ...['declaration', 'icon'].map(resource => ({ name: `${resource}.list`, description: `List public vault ${resource} entries without creating configuration.`, effect: 'read' as const, input: object({ root: string(), ...pageInput }, ['root']), output: vaultConfigOutputs[resource], requires: ['explicit vault'] })),
  { name: 'declaration.patch', description: 'Patch one property declaration against the latest file. Supply kind to create it. Null removes optional fields.', effect: 'write', input: object({ root: string(), name: string(), changes: declarationPatch }, ['root', 'name', 'changes']), output: vaultConfigOutputs.declaration, requires: ['explicit vault'] },
  { name: 'declaration.remove', description: 'Remove one property declaration without editing note values.', effect: 'write', input: object({ root: string(), name: string() }, ['root', 'name']), output: vaultConfigOutputs.declaration, requires: ['explicit vault'] },
  { name: 'icon.set', description: 'Set one existing item’s icon while preserving other picks.', effect: 'write', input: object({ root: string(), path: string(), icon: string() }, ['root', 'path', 'icon']), output: vaultConfigOutputs.icon, requires: ['explicit vault and existing item'] },
  { name: 'icon.remove', description: 'Remove one icon pick, including a stale item, while preserving other picks.', effect: 'write', input: object({ root: string(), path: string() }, ['root', 'path']), output: vaultConfigOutputs.icon, requires: ['explicit vault'] },
  ...['read', 'patch'].map(action => ({ name: `vaultConfig.${action}`, description: `${action} public review or text-formatting configuration. Patches preserve other fields; null resets a named field.`, effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ root: string(), name: { type: 'string' as const, enum: ['review.json', 'text-formatting.json'] }, ...(action === 'patch' ? { changes: { type: 'object' as const, additionalProperties: true } } : {}) }, ['root', 'name', ...(action === 'patch' ? ['changes'] : [])]), output: action === 'patch' ? result({ root: string(), name: string(), value: vaultConfigValue(false), ...saved }) : result({ root: string(), name: string(), value: vaultConfigValue(true) }), requires: ['explicit vault'] })),
]

const linkPage = (items: CommandSchema): CommandSchema => { const page = pageSchema(items); return { ...page, properties: { ...page.properties, root: string(), path: string(), source: { type: 'string', enum: ['index'] } }, required: [...page.required!, 'root', 'path', 'source'] } }
const foundNote = { path: string(), title: string(), id: nullable(string()), created: { ...boolean, description: 'This call created the note.' }, others: array(string('Another note that matches the same title.')) }
const savedText = { path: string(), content: largeText, mtime: number, size: integer, source: literal('disk'), revision: string() }
const reviewEntry = result({ at: string(), rating: string(), text: string('The body fingerprint the review saw.') })
const noteCommands: CommandDefinition[] = [
  { name: 'link.resolve', description: 'Resolve one link spelling in one vault through the app’s existing note, folder, and board-ID precedence. Missing links return null.', effect: 'read', input: object({ root: string(), target: string() }, ['root', 'target']), output: result({ target: string(), path: nullable(string('The resolved note, folder, or board; null when missing.')), root: string() }), requires: ['explicit vault'] },
  ...['outgoing', 'incoming'].map(action => ({ name: `link.${action}`, description: action === 'incoming' ? 'Read the notes and folders that link here, as the page’s Linked mentions show them: links, embeds, folder outlines, view order and link-column targets. Path-sorted; no rewrite or ID minting.' : 'Read indexed outgoing links and embeds. A folder includes its settings and outline links. No rewrite or ID minting.', effect: 'read' as const, input: object({ ...documentTarget, ...pageInput }), output: linkPage(action === 'incoming' ? object({ kind: { type: 'string', enum: ['note', 'folder'] }, path: string(), settings: string('A folder’s settings record.'), title: string() }, ['kind', 'path', 'title']) : object({ target: string(), path: { type: ['string', 'null'] }, embedded: { type: 'boolean' } }, ['target', 'path', 'embedded'])), requires: ['explicit vault scope and target'] })),
  ...['find', 'create'].map(action => ({ name: `daily.${action}`, description: `${action} a daily note through the same template, settings, and cross-process creation lock as the app.`, effect: action === 'find' ? 'read' as const : 'write' as const, input: object({ root: string(), date: string('today, tomorrow, yesterday, or YYYY-MM-DD') }, ['root']), output: result({ note: { ...object(foundNote, Object.keys(foundNote)), type: ['object', 'null'], description: 'Null when find meets no daily note.' } }), requires: ['explicit vault', 'daily notes enabled'] })),
  { name: 'template.read', description: 'Read the folder’s .template.md and saved revision, or report it absent without creating it.', effect: 'read', input: object({ root: string(), folder: string() }, ['root', 'folder']), output: result({ ...savedText, revision: nullable(string()), exists: boolean }, ['content', 'mtime', 'size']), requires: ['explicit vault and folder'] },
  { name: 'template.write', description: 'Write the folder template with its saved revision. Use null only to create an absent template.', effect: 'write', input: object({ root: string(), folder: string(), revision: { type: ['string', 'null'] } }, ['root', 'folder', 'revision']), output: result({ ...savedText, ...saved, rendererMerged: boolean }), content: 'text', contentRequired: true, requires: ['explicit vault and folder', 'saved revision or null for creation'] },
  { name: 'review.queue', description: 'Read the existing upkeep queue, most overdue first, from the metadata index.', effect: 'read', input: object({ root: string(), folder: string(), ...pageInput }, ['root']), output: pageWith(result({ path: string(), title: string(), due: { ...number, description: 'When the note is due, epoch ms.' } }), { root: string() }), requires: ['explicit vault'] },
  { name: 'review.list', description: 'Read the saved review log and revision.', effect: 'read', input: object({ ...documentTarget, ...pageInput }), output: pageWith(reviewEntry, { path: string(), revision: string() }), requires: ['explicit vault scope and note'] },
  ...['keep', 'remove', 'reset', 'setEnabled'].map(action => ({ name: `review.${action}`, description: `${action} using the existing review log format and schedule rules, after checking the saved revision.`, effect: 'write' as const, input: object({ ...documentEdit, ...(action === 'remove' ? { at: string() } : {}), ...(action === 'setEnabled' ? { enabled: { type: 'boolean' as const } } : {}) }, ['revision', ...(action === 'remove' ? ['at'] : action === 'setEnabled' ? ['enabled'] : [])]), output: savedOutput, requires: documentRequires })),
]

const editorTarget = { window: string(), tab: string(), revision: string('Tab-local revision from document.live. Includes the selection state.') }
const liveState = {
  path: string(), tab: string(), source: { type: 'string', enum: ['live'] } as CommandSchema, kind: { type: 'string', enum: ['markdown', 'text', 'drawing', 'diagram'] } as CommandSchema, revision: string(),
  actions: array(string('An action this tab offers now. Read only drawings offer only view actions; Read only Markdown and code tabs offer only select and save.')), baselineMtime: { type: 'number' } as CommandSchema, dirty: { type: 'boolean' } as CommandSchema,
  conflict: { type: 'boolean', description: 'The conflict bar shows: the file changed on disk under unsaved edits. A person chooses Reload or Keep mine; editor.save stays incomplete until then.' } as CommandSchema,
  selection: object({ anchor: { type: 'integer' }, head: { type: 'integer' }, text: { type: 'string', maxLength: 10 * 1024 * 1024 }, coordinate: { type: 'string', enum: ['prosemirror', 'utf16'] } }),
}
const editorResult = object({ ...liveState, rendererApplied: { type: 'boolean' }, diskSaved: { type: 'boolean' } }, ['path', 'tab', 'source', 'kind', 'revision', 'actions', 'baselineMtime', 'dirty', 'rendererApplied', 'diskSaved'])
const drawingActionText: Record<DrawingAction, string> = {
  selectAll: 'Select every element', deleteSelection: 'Delete the selection', duplicate: 'Duplicate the selection', group: 'Group the selection', ungroup: 'Ungroup the selection',
  bringForward: 'Bring the selection forward', sendBackward: 'Send the selection backward', bringToFront: 'Bring the selection to the front', sendToBack: 'Send the selection to the back',
  alignTop: 'Align the selection to the top', alignBottom: 'Align the selection to the bottom', alignLeft: 'Align the selection to the left', alignRight: 'Align the selection to the right',
  alignVerticallyCentered: 'Center the selection vertically', alignHorizontallyCentered: 'Center the selection horizontally',
  distributeHorizontally: 'Distribute the selection horizontally', distributeVertically: 'Distribute the selection vertically',
  flipHorizontal: 'Flip the selection horizontally', flipVertical: 'Flip the selection vertically', toggleLock: 'Lock or unlock the selection',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', resetZoom: 'Zoom to 100%', zoomToFit: 'Zoom to fit everything', zoomToFitSelection: 'Zoom to fit the selection',
}
const drawingActionCommands: CommandDefinition[] = (Object.keys(DRAWING_ACTIONS) as DrawingAction[]).map(action => ({
  name: `editor.${action}`, description: `${drawingActionText[action]} on a live drawing tab through the engine’s own action and Undo history. Refused when the action does not apply to the current selection.${DRAWING_VIEW_ACTIONS.includes(action) ? ' Also runs on a Read only drawing.' : ' Not on a Read only drawing.'}`,
  effect: 'write' as const, input: object(editorTarget, ['window', 'tab', 'revision']), output: editorResult, requires: ['explicit ready drawing tab', 'current live revision', 'action listed in document.live actions'],
}))
const editorCommands: CommandDefinition[] = [
  ...drawingActionCommands,
  { name: 'editor.selectElements', description: 'Select exactly these live element IDs on a drawing tab, in place of a click or lasso. Unknown IDs are refused and nothing changes.', effect: 'write', input: object({ ...editorTarget, ids: { type: 'array', items: string(), maxItems: 10_000 } }, ['window', 'tab', 'revision', 'ids']), output: editorResult, requires: ['explicit ready drawing tab', 'current live revision'] },
  { name: 'editor.select', description: 'Set an explicit ready tab’s selection, using the coordinate system returned by document.live.', effect: 'write', input: object({ ...editorTarget, anchor: { type: 'integer', minimum: 0 }, head: { type: 'integer', minimum: 0 } }, ['window', 'tab', 'revision', 'anchor', 'head']), output: editorResult, requires: ['explicit ready tab', 'current live revision'] },
  { name: 'editor.replace', description: 'Replace the current selection with plain text as one local Undo step. Autosave remains active. Not on a Read only tab: write the saved file with file.write.', effect: 'write', input: object(editorTarget, ['window', 'tab', 'revision']), output: editorResult, content: 'text', contentRequired: true, requires: ['explicit ready text tab', 'current live revision'] },
  { name: 'editor.format', description: 'Toggle one supported Markdown format through the installed editor command, preserving visible-line rules. Not on a Read only note.', effect: 'write', input: object({ ...editorTarget, format: { type: 'string', enum: ['bold', 'italic', 'code', 'strike'] } }, ['window', 'tab', 'revision', 'format']), output: editorResult, requires: ['explicit ready Markdown tab', 'current live revision'] },
  ...['undo', 'redo', 'save'].map(action => ({ name: `editor.${action}`, description: `${action} through this ready editor’s local history or autosave. Drawings use the engine history; diagrams offer save only. A save reports failure when the editor remains dirty.`, effect: 'write' as const, input: object(editorTarget, ['window', 'tab', 'revision']), output: editorResult, requires: ['explicit ready tab', 'current live revision', 'action listed in document.live actions'] })),
]

const providerState = { provider: literal('pixabay'), configured: { ...boolean, description: 'Whether a key is stored. The key itself is never returned.' } }
const shareStatus = result({ state: { type: 'string', enum: ['off', 'ready'] }, url: nullable(string()), workersDevUrl: nullable(string()), customDomain: nullable(string()), accountName: nullable(string()), workerName: nullable(string()), bucketName: nullable(string()), readyAt: nullable(number), demo: boolean })
const shareFields = { path: string(), id: string(), url: string(), allowDownload: boolean, sharedAt: number, updatedAt: number, sync: result({ state: { type: 'string', enum: ['ok', 'uploading', 'failed'] }, message: string(), failedAt: number }, ['message', 'failedAt']), stale: boolean }
const shareEntry = result(shareFields)
const vaultFile = string('Vault-relative path.')
const syncStatus = result({
  root: string(), state: { type: 'string', enum: ['off', 'synced', 'pending', 'syncing', 'attention'] }, attention: { type: 'string', enum: ['no-git', 'no-identity', 'auth', 'conflict', 'error', 'too-large'] }, message: string(),
  repo: result({ remoteUrl: nullable(string()), branch: nullable(string()) }), enabled: boolean, tooLarge: array(vaultFile),
  merged: array(result({ path: vaultFile, author: string(), clashes: integer, copy: vaultFile }, ['copy'])),
}, ['attention', 'message', 'repo', 'enabled', 'tooLarge', 'merged'])
const boardVersion = result({ ref: string('Pass back to history read, export, or restore.'), author: string(), at: number, merged: boolean, localOnly: boolean })
const connectedOutputs: Record<string, CommandSchema> = {
  'history.read': result({ path: string(), ref: string(), kind: { type: 'string', enum: ['drawing', 'diagram'] }, json: largeText, files: { type: 'object', additionalProperties: object({ mimeType: string(), dataURL: largeText }, ['mimeType', 'dataURL']) }, xml: largeText }, ['json', 'files', 'xml']),
  'history.export': result({ path: string(), ...exported }), 'history.restore': result({ path: string(), ...saved, rendererMerged: boolean }),
  'share.get': result({ path: string(), share: { ...shareEntry, type: ['object', 'null'], description: 'Null when the board is not shared.' } }), 'share.stop': result({ path: string(), stopped: literal(true) }), 'share.setPermission': shareEntry,
}
const connectedCommands: CommandDefinition[] = [
  { name: 'provider.status', description: 'Report whether the supported Pixabay credential is configured. Never returns its value.', effect: 'read', input: object({}), output: result(providerState), requires: ['running app'] },
  { name: 'provider.set', description: 'Set the Pixabay credential through protected input and refresh favorite copies.', effect: 'remote', input: object({}), output: result({ ...providerState, ...saved }), content: 'secret', contentRequired: true, requires: ['private file or stdin credential'] },
  { name: 'provider.clear', description: 'Remove the Pixabay credential from the app secret store.', effect: 'write', input: object({}), output: result({ ...providerState, ...saved }), requires: ['running app'] },
  ...['status', 'now', 'setEnabled'].map(action => ({ name: `sync.${action}`, description: `${action} through the app’s existing Git sync manager.`, effect: action === 'status' ? 'read' as const : 'remote' as const, input: object({ root: string(), ...(action === 'setEnabled' ? { enabled: { type: 'boolean' as const } } : {}) }, action === 'setEnabled' ? ['root', 'enabled'] : ['root']), output: syncStatus, requires: ['explicit vault'] })),
  { name: 'history.list', description: 'List existing Git board versions, including the pre-merge local version.', effect: 'read', input: object({ root: string(), ...targetInput, ...pageInput }, ['root']), output: pageWith(boardVersion, { path: string() }), requires: ['explicit vault and board'] },
  ...['read', 'export', 'restore'].map(action => ({ name: `history.${action}`, description: `${action} a board version using the existing Git history service. Restore requires the current saved revision and refuses while an open editor holds unsaved edits of the board. Export writes a JSON version bundle.`, effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ root: string(), ...targetInput, ref: string(), ...(action === 'export' ? { outputFile: string() } : action === 'restore' ? { revision: string() } : {}) }, ['root', 'ref', ...(action === 'export' ? ['outputFile'] : action === 'restore' ? ['revision'] : [])]), output: connectedOutputs[`history.${action}`], requires: ['explicit vault and board', 'existing version reference'] })),
  { name: 'share.status', description: 'Read sharing setup status without returning stored credentials.', effect: 'read', input: object({}), output: shareStatus, requires: ['running app'] },
  { name: 'share.accounts', description: 'Check a protected Cloudflare credential and list its available accounts.', effect: 'remote', input: object(pageInput), output: pageSchema(result({ id: string(), name: string() })), content: 'secret', contentRequired: true, requires: ['private file or stdin credential'] },
  { name: 'share.setup', description: 'Provision sharing through the existing setup service with a protected Cloudflare credential.', effect: 'remote', input: object({ accountId: string() }), output: shareStatus, content: 'secret', contentRequired: true, requires: ['private file or stdin credential'] },
  ...['list', 'check'].map(action => ({ name: `share.${action}`, description: action === 'list' ? 'List saved shares without contacting the server.' : 'Check saved shares against the existing sharing server.', effect: action === 'list' ? 'read' as const : 'remote' as const, input: object({ root: string(), ...pageInput }, ['root']), output: pageSchema(result({ ...shareFields, fileExists: boolean })), requires: ['explicit vault'] })),
  ...['get', 'stop', 'setPermission'].map(action => ({ name: `share.${action}`, description: `${action} for one board through the existing sharing service.`, effect: action === 'get' ? 'read' as const : 'remote' as const, input: object({ root: string(), ...targetInput, ...(action === 'setPermission' ? { allowDownload: { type: 'boolean' as const } } : {}) }, action === 'setPermission' ? ['root', 'allowDownload'] : ['root']), output: connectedOutputs[`share.${action}`], requires: ['explicit vault and board'] })),
  { name: 'share.publish', description: 'Publish an explicit standalone board body. Use shareId only to update an existing share.', effect: 'remote', input: object({ root: string(), ...targetInput, shareId: string() }, ['root']), output: shareEntry, content: 'text', contentRequired: true, requires: ['explicit vault and board', 'standalone board content'] },
  { name: 'share.setDomain', description: 'Attach a sharing hostname, or remove it with null.', effect: 'remote', input: object({ hostname: { type: ['string', 'null'], maxLength: 253 } }, ['hostname']), output: shareStatus, requires: ['configured sharing'] },
  { name: 'share.disconnect', description: 'Disconnect sharing for a vault or the app. Explicitly choose whether to delete remote resources.', effect: 'remote', input: object({ root: { type: ['string', 'null'], maxLength: 4096 }, deleteEverything: { type: 'boolean' } }, ['root', 'deleteEverything']), output: shareStatus, requires: ['explicit scope and deletion choice'] },
]

const rightPanelSchema = object({ open: { type: 'boolean' }, width: { type: 'number' }, items: array(string()), expanded: { type: ['string', 'null'] } }, ['open', 'width', 'items', 'expanded'])
const linkCounts = object({ updated: { type: 'integer' }, skipped: { type: 'integer' } }, ['updated', 'skipped'])
const historyStepOutput = object({ step: { type: 'string', enum: ['move', 'rename', 'delete'] }, done: { type: 'integer', description: 'Items the step changed.' }, failed: array(string('One reason per item the step could not change.')), links: linkCounts, history: object({ undo: { type: 'integer' }, redo: { type: 'integer' } }, ['undo', 'redo']), diskSaved: { type: 'boolean' } }, ['step', 'done', 'failed', 'history', 'diskSaved'])
const folderTarget = { ...resourceInput, path: string('Absolute folder path.'), id: string('Existing folder ID, scoped to the vault.') }
const folderRevision: CommandSchema = { type: ['string', 'null'], maxLength: 4096, description: 'Revision from folder.read; null while the folder has no .folder.md.' }
const storedView: CommandSchema = { type: 'object', properties: { type: string(), name: string() }, required: ['type', 'name'], additionalProperties: true, description: 'A view as stored: its type, name, and options. Unknown keys and types are kept verbatim.' }
const folderPage = {
  root: string(), path: string(), file: string('The folder page file, .folder.md, which may not exist yet.'), exists: { type: 'boolean' } as CommandSchema, revision: folderRevision, ids: { type: 'boolean' } as CommandSchema,
  id: { type: ['string', 'null'], maxLength: 4096 } as CommandSchema, title: string(), views: array(storedView), defaultView: { type: ['string', 'null'], maxLength: 4096, description: 'The saved starting view.' } as CommandSchema,
  startView: string('The view a fresh open shows.'), columns: { type: 'object', additionalProperties: object({ kind: string(), target: string(), required: { type: 'boolean' }, options: array(string()), optionSort: string() }) } as CommandSchema,
  formulas: { type: 'object', additionalProperties: string() } as CommandSchema, labels: { type: 'object', additionalProperties: object({ displayName: string() }) } as CommandSchema,
  problems: array(string()), properties: { type: 'object', additionalProperties: true, description: 'The folder’s own frontmatter properties, beside its settings.' } as CommandSchema,
}
const folderPageOutput = object(folderPage, Object.keys(folderPage))
const folderWriteOutput = object({ ...folderPage, view: string('The view this command changed.'), changed: { type: 'boolean' }, created: { type: 'boolean', description: 'This write created .folder.md.' }, diskSaved: { type: 'boolean' } }, [...Object.keys(folderPage), 'changed', 'created', 'diskSaved'])
const option = (...types: SchemaType[]): CommandSchema => ({ type: [...types, 'null'], additionalProperties: true })
/** Every option some view type reads (`VIEW_OPTIONS`). The adapter refuses one this view's type does not read. Null removes an option. */
const viewOptions = object({
  filters: option('string', 'object'), order: option('array'), sort: option('array'), groupBy: option('object', 'array'), limit: option('integer'), summaries: option('object'),
  columnSize: option('object'), frozenColumns: option('integer'), rowNumbers: option('boolean'), rowHeight: option('string'),
  showEmptyColumns: option('boolean'), cardSize: option('number', 'string'), cardStyle: option('object'),
  image: option('string'), imageFit: option('string'), imageAspectRatio: option('number', 'string'),
  indentProperties: option('boolean'), markerStyle: option('string'), propertySeparator: option('string'), outline: { type: ['string', 'null'], maxLength: 60_000 },
})
const viewEdit = (fields: Record<string, CommandSchema>, required: string[]) => object({ ...folderTarget, revision: folderRevision, ...fields }, ['revision', ...required])
const folderRequires = ['explicit vault scope and folder', 'revision from folder.read']
const folderColumnOutput = object({ ...folderPage, column: string(), changed: { type: 'boolean' }, created: { type: 'boolean' }, diskSaved: { type: 'boolean' } }, [...Object.keys(folderPage), 'column', 'changed', 'created', 'diskSaved'])
const shortcutPage = pageSchema(object({ path: string(), title: string(), id: { type: ['string', 'null'], maxLength: 4096 } }, ['path', 'title', 'id']))
const folderCommands: CommandDefinition[] = [
  { name: 'folder.read', description: 'Read a folder page: its settings, views, starting view, columns, and own properties. A folder without .folder.md reads as the defaults, and nothing is created.', effect: 'read', input: object(folderTarget), output: folderPageOutput, requires: ['explicit vault scope and folder'] },
  { name: 'folderView.add', description: 'Add a view, named like the + menu unless a unique name is given. A page has one outline view.', effect: 'write', input: viewEdit({ type: { type: 'string', enum: ['table', 'board', 'cards', 'list', 'outline'] }, name: string() }, ['type']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folderView.rename', description: 'Rename a view. The starting view and the collapsed groups follow.', effect: 'write', input: viewEdit({ view: string(), name: string() }, ['view', 'name']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folderView.duplicate', description: 'Duplicate a view beside it as “<name> copy”. Outline views have no duplicate.', effect: 'write', input: viewEdit({ view: string() }, ['view']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folderView.remove', description: 'Delete a view. A deleted starting view clears; the last view stays.', effect: 'write', input: viewEdit({ view: string() }, ['view']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folderView.move', description: 'Move a view to a zero-based final index in the view tabs.', effect: 'write', input: viewEdit({ view: string(), index: { type: 'integer', minimum: 0 } }, ['view', 'index']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folderView.setOptions', description: 'Set or, with null, remove options this view type reads. An unknown or unsupported option fails and nothing is written.', effect: 'write', input: viewEdit({ view: string(), changes: viewOptions }, ['view', 'changes']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folderView.setDefault', description: 'Set the saved starting view, or null for the first view. The live current view is navigation.open --view.', effect: 'write', input: viewEdit({ view: { type: ['string', 'null'], maxLength: 4096 } }, ['view']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folder.setProperty', description: 'Set one of the folder’s own properties. The app’s reserved keys and folder_settings have their own commands.', effect: 'write', input: viewEdit({ name: string('A snake_case property name.'), value: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], additionalProperties: true } }, ['name', 'value']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folder.removeProperty', description: 'Remove one of the folder’s own properties.', effect: 'write', input: viewEdit({ name: string('A snake_case property name.') }, ['name']), output: folderWriteOutput, requires: folderRequires },
  { name: 'folderColumn.set', description: 'Declare or change one folder column, as the Properties menu does. The kind rule drops fields of other kinds. Show it in a view with folderView.setOptions order.', effect: 'write', input: viewEdit({ key: string('A snake_case column key.'), definition: object({ kind: { type: 'string', enum: [...PROPERTY_KINDS] }, target: string(), required: { type: 'boolean' }, options: { type: 'array', items: string(), maxItems: 500 }, optionSort: { type: 'string', enum: ['manual', 'ascending', 'descending'] } }, ['kind']) }, ['key', 'definition']), output: folderColumnOutput, requires: folderRequires },
  { name: 'folderColumn.setLabel', description: 'Set a column’s display name, or clear it with null. The key never changes.', effect: 'write', input: viewEdit({ key: string(), label: { type: ['string', 'null'], maxLength: 200 } }, ['key', 'label']), output: folderColumnOutput, requires: folderRequires },
  { name: 'folderColumn.remove', description: 'Delete a column as “Delete column…” does: its declaration, label and view references, then this folder’s value in every note holding one. confirm: true answers the delete sheet.', effect: 'write', input: viewEdit({ key: string(), confirm: { type: 'boolean', enum: [true] } }, ['key', 'confirm']), output: object({ ...folderColumnOutput.properties, cleared: { type: 'integer', minimum: 0 }, failed: array(object({ path: string(), reason: string() }, ['path', 'reason'])) }, [...folderColumnOutput.required!, 'cleared', 'failed']), requires: folderRequires },
  { name: 'folderFormula.set', description: 'Set a named formula, or remove it with null. A removal also drops its references from the views. The engine reports a bad expression as a cell error.', effect: 'write', input: viewEdit({ name: string(), expression: { type: ['string', 'null'], maxLength: 4096 } }, ['name', 'expression']), output: object({ ...folderPage, formula: string(), changed: { type: 'boolean' }, created: { type: 'boolean' }, diskSaved: { type: 'boolean' } }, [...Object.keys(folderPage), 'formula', 'changed', 'created', 'diskSaved']), requires: folderRequires },
  { name: 'shortcut.list', description: 'List the notes that appear in this folder by a shortcut. Reads the index without assigning IDs.', effect: 'read', input: object({ ...folderTarget, ...pageInput }), output: { ...shortcutPage, properties: { ...shortcutPage.properties, root: string(), path: string() }, required: [...shortcutPage.required!, 'root', 'path'] }, requires: ['explicit vault scope and folder', 'vault that uses IDs'] },
  ...['add', 'remove'].map(action => ({ name: `shortcut.${action}`, description: action === 'add' ? 'Make a note that lives elsewhere also appear in this folder. A folder without an ID takes the vault’s next number first.' : 'Stop a note appearing in this folder. When that clears other folders’ values, pass dropValues: true.', effect: 'write' as const, input: object({ ...folderTarget, note: string('Absolute note path.'), revision: string('The note’s revision from file.read.'), ...(action === 'remove' ? { dropValues: { type: 'boolean' as const } } : {}) }, ['note', 'revision']), output: object({ root: string(), folder: string(), note: string(), revision: string(), changed: { type: 'boolean' }, folderId: string(), folderIdCreated: { type: 'boolean' }, diskSaved: { type: 'boolean' } }, ['root', 'folder', 'note', 'revision', 'changed', 'diskSaved']), requires: ['explicit vault scope and folder', 'vault that uses IDs', 'note revision'] })),
]

const idsCount = { type: 'integer', minimum: 0 } as CommandSchema
const idsAsk = object({ notes: idsCount, folders: idsCount, foreign: idsCount }, ['notes', 'folders', 'foreign'])
const idsFields = { root: string(), letters: string('The vault’s current ID letters.'), notes: idsCount, stale: idsCount, old: idsCount, unfinished: { type: 'boolean' } as CommandSchema }
const idsState = { ...idsFields, answer: { type: ['boolean', 'null'], description: 'The vault’s answer; null when it has not answered.' } as CommandSchema, saved: { type: 'boolean', description: 'The letters are saved in ids.json.' } as CommandSchema, ask: { ...idsAsk, description: 'What turning IDs on would write.' } }
const idsPass = object({ ...idsFields, changed: idsCount, renamed: idsCount, left: array(string()), stopped: { type: 'boolean' }, diskSaved: { type: 'boolean' } }, [...Object.keys(idsFields), 'changed', 'renamed', 'left', 'stopped', 'diskSaved'])
const idsCommands: CommandDefinition[] = [
  { name: 'ids.state', description: 'Read a vault’s ID answer, letters, and counts. Never assigns, adopts, or mints an ID.', effect: 'read', input: object({ root: string() }, ['root']), output: object(idsState, Object.keys(idsState)), requires: ['explicit vault'] },
  { name: 'ids.enable', description: 'Turn on IDs and give every note and folder its number now. letters confirms: the vault’s saved letters, or new letters for a vault with none.', effect: 'write', input: object({ root: string(), letters: string() }, ['root', 'letters']), output: object({ ...idsState, given: object({ notes: idsCount, folders: idsCount }, ['notes', 'folders']), left: idsAsk, changed: { type: 'boolean' } }, [...Object.keys(idsState), 'given', 'left', 'changed']), requires: ['explicit vault', 'typed letters'] },
  { name: 'ids.disable', description: 'Turn off IDs. Nothing is removed; links stored as IDs do not open until IDs are on again.', effect: 'write', input: object({ root: string(), confirm: { type: 'boolean', enum: [true] } }, ['root', 'confirm']), output: object({ ...idsState, changed: { type: 'boolean' } }, [...Object.keys(idsState), 'changed']), requires: ['explicit vault', 'confirm: true'] },
  { name: 'ids.reletter', description: 'Change the vault’s ID letters in every ID, link, and built file name. The current letters finish a change that stopped.', effect: 'write', input: object({ root: string(), letters: string() }, ['root', 'letters']), output: idsPass, requires: ['explicit vault that uses IDs', 'new letters'] },
  { name: 'ids.backfill', description: 'Give each old 12-character ID the vault’s next number, then update its links. letters confirms with the vault’s letters.', effect: 'write', input: object({ root: string(), letters: string() }, ['root', 'letters']), output: idsPass, requires: ['explicit vault that uses IDs', 'typed letters'] },
  { name: 'ids.check', description: 'Settle notes that share an ID now, as Check for duplicates does. A clash another Mac must fix is reported, not changed.', effect: 'write', input: object({ root: string() }, ['root']), output: object({ ...idsState, line: string(), fixed: idsCount, copies: idsCount, otherMac: idsCount, later: idsCount }, [...Object.keys(idsState), 'line', 'fixed', 'copies', 'otherMac', 'later']), requires: ['explicit vault that uses IDs'] },
]

const sidebarTab = { type: 'string', enum: [...SIDEBAR_TABS] } as CommandSchema
const itemKind = { type: 'string', enum: ['file', 'dir'] } as CommandSchema
const liveTab = result({ id: string('Live tab ID, valid while the window is open.'), path: string(), name: string('The tab’s display name.'), zoom: string('The zoomed bullet’s key.') }, ['name', 'zoom'])
/** A tab strip after a renderer action, as the window holds it. */
const tabState = result({ tabs: array(liveTab), active: nullable(string()), mounted: array(string('A tab with a loaded editor; other tabs sleep or wait.')), blank: { ...boolean, description: 'The blank new-tab page is on show.' }, rightPanel: rightPanelSchema, rendererApplied: literal(true) })
const tabApplied = result({ window: string(), applied: tabState, ...saved })
const moved = result({ oldPath: string(), newPath: string(), kind: itemKind })
const cleared = result({ path: string(), values: open('The folder values cleared from this note, as the note stored them.') })
const renameSide = result({ newPath: string(), title: string() }, ['newPath', 'title'])
const trashedItem = result({ path: string(), trashed: string('Where it is in the Trash.'), type: itemKind, name: string('Its name on disk.') })
const historyEntry = result({ step: { type: 'string', enum: ['move', 'rename', 'delete'] }, moves: array(moved), cleared: array(cleared), path: string(), from: renameSide, to: renameSide, type: itemKind, items: array(trashedItem) }, ['moves', 'cleared', 'path', 'from', 'to', 'type', 'items'])
const binaryRead = result({ path: string(), mime: string(), data: { ...largeText, description: 'The bytes, base64.' }, size: integer, mtime: number, revision: string(), encoding: literal('base64'), source: literal('disk') }, ['mime'])
const binaryExport = result({ path: string(), outputFile: string(), size: integer, revision: string(), source: literal('disk'), ...saved })
const sizeCount = result({ bytes: number, count: integer })
const memoryState = { type: ['string', 'null'], enum: ['shown', 'awake', 'unsaved', 'unloaded', 'asleep', null] } as CommandSchema
const memoryReport = result({
  windows: array(result({ id: string(), title: string(), open: string(), bytes: number, jsHeapBytes: nullable(number), grew: boolean, tabs: array(result({ path: string(), title: nullable(string()), state: memoryState, lastSeen: nullable(number), sleepsAt: nullable(number), changed: nullable(number) })) })),
  core: result({ bytes: number, main: number, gpu: number, utility: number, other: number }), helpers: nullable(sizeCount),
})
const restartResult = result({ accepted: boolean, outcome: literal('restart-requested'), receiptsExpireOnRestart: literal(true), manual: literal(true), url: string('The release page to install from by hand.') }, ['outcome', 'receiptsExpireOnRestart', 'manual', 'url'])
const updateState = result({ kind: { type: 'string', enum: ['idle', 'downloading', 'ready', 'manual'] }, failed: string(), version: string() }, ['failed', 'version'])
const appOutputs: Record<string, CommandSchema> = {
  'languageHelper.state': result({ ready: boolean, installing: boolean }), 'languageHelper.cancel': result({ ready: boolean, installing: boolean }),
  'languageHelper.install': result({ ok: boolean, error: { type: 'string', enum: ['offline', 'http', 'mismatch', 'unpack', 'disk', 'unsupported', 'cancelled'] }, detail: string() }, ['error', 'detail']),
  'window.show': result({ window: string(), shown: literal(true) }), 'window.rename': result({ window: string(), name: nullable(string()), ...saved }), 'window.close': result({ window: string(), accepted: literal(true), outcome: literal('close-requested') }),
  'update.state': updateState, 'update.check': updateState, 'update.restart': restartResult,
  'update.notes': result({ current: string(), checks: { ...boolean, description: 'False in a dev run with no update feed.' }, releases: array(result({ version: string(), title: string(), date: string(), body: largeText })) }),
}
const pictureFolderOutput = (action: string) => result({ ...pictureFolders, ...(action === 'list' ? {} : saved) })
const anyJson = { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], additionalProperties: true, description: 'The original command’s value. Its schema is that command’s output.' } as CommandSchema

/** The allowlist grows only with an implemented adapter and its checks. No IPC channel discovery. */
export const AUTOMATION_COMMANDS: readonly CommandDefinition[] = [
  ...folderCommands,
  ...idsCommands,
  ...['state', 'install', 'cancel'].map(action => ({ name: `languageHelper.${action}`, description: `${action} for the app’s pinned code language helpers. No caller-supplied executable, download URL, or version. Cancel can run during installation.`, effect: action === 'state' ? 'read' as const : action === 'install' ? 'remote' as const : 'write' as const, input: object({}), output: appOutputs[`languageHelper.${action}`], requires: ['running app'] })),
  { name: 'settingsFolder.get', description: 'Read this Mac’s shared settings folder and whether it is missing.', effect: 'read', input: object({}), output: result({ folder: nullable(string()), missing: { ...boolean, description: 'The chosen folder is not reachable now.' } }), requires: ['running app'] },
  { name: 'settingsFolder.set', description: 'Choose an existing shared settings folder, or null for this Mac only. Another Mac’s file wins as in Settings. Report whether initial synchronization finished within two seconds.', effect: 'write', input: object({ folder: { type: ['string', 'null'], maxLength: 4096 } }, ['folder']), output: result({ folder: nullable(string()), missing: boolean, syncSettled: { ...boolean, description: 'Initial synchronization finished within two seconds.' }, ...saved }), requires: ['explicit folder or null'] },
  { name: 'storage.stats', description: 'Measure one vault through the existing storage worker. Large-file rows are paged; totals cover the whole vault.', effect: 'read', input: object({ root: string(), ...pageInput }, ['root']), output: result({ root: string(), boards: sizeCount, pictures: sizeCount, other: sizeCount, git: nullable(result({ historyBytes: number, headBytes: number, oldVersionsBytes: number })), large: pageSchema(result({ path: vaultFile, bytes: number })), embedded: result({ bytes: number, boards: integer }) }), requires: ['explicit vault'] },
  { name: 'storage.shrink', description: 'Move eligible embedded board pictures out through the existing storage worker. Preserve its revision checks and approved-folder rules. Report converted and skipped counts. Boards with unsaved live edits are skipped, as in Settings, and listed in unsavedSkipped.', effect: 'write', input: object({ root: string(), skip: array(string()) }, ['root']), output: result({ root: string(), shrunk: integer, skipped: integer, bytesMoved: number, unsavedSkipped: array(result({ window: string(), path: string(), tabs: array(string()), reason: literal('UNSAVED_LIVE_EDITS') })), ...saved, rendererMerged: boolean }), requires: ['explicit vault'] },
  ...['copy', 'importCopy'].map(action => ({ name: `file.${action}`, description: action === 'copy' ? 'Copy items from this window’s vaults through the ID-aware copy service. Flush source editors first. Keep the clipboard and original files.' : 'Copy explicit external files or folders into a live window’s vault, using Finder-copy semantics. Keep originals and the clipboard. Never overwrite.', effect: 'write' as const, input: object({ window: string(), paths: { type: 'array', items: string(), maxItems: 200 }, targetDir: string() }, ['window', 'paths', 'targetDir']), output: result({ pasted: array(result({ from: string(), to: string(), kind: itemKind })), failed: array(result({ from: string(), code: string(), message: string() })), ...saved }), requires: ['explicit live window, source paths, and destination folder'] })),
  { name: 'session.capture', description: 'Save an explicit live window’s current tab strip, copies and display names. Supply id only to replace an existing session.', effect: 'write', input: object({ window: string(), name: string(), id: string() }, ['window', 'name']), output: result({ window: string(), session: sessionEntry, ...saved }), requires: ['explicit live window with tabs'] },
  { name: 'vault.patch', description: 'Patch this vault’s display name or number key through the existing store. Null clears either value.', effect: 'write', input: object({ root: string(), changes: object({ name: { type: ['string', 'null'], maxLength: 200 }, key: { type: ['integer', 'null'], minimum: 1, maximum: 9 } }) }, ['root', 'changes']), output: result({ root: string(), name: nullable(string('The display name; null shows the folder name.')), key: nullable(integer), ...saved }), requires: ['explicit vault'] },
  ...['list', 'allow', 'remove'].map(action => ({ name: `pictureFolder.${action}`, description: `${action} an allowed external picture folder. Uses the existing system-folder and symbolic-link checks. Removing permission does not delete files.`, effect: action === 'list' ? 'read' as const : 'write' as const, input: object(action === 'list' ? {} : { folder: string() }, action === 'list' ? [] : ['folder']), output: pictureFolderOutput(action), requires: ['running app'] })),
  { name: 'media.favoriteCopies', description: 'Report saved favorite copy counts and sizes through the library service.', effect: 'read', input: object({}), output: result({ favorites: integer, saved: integer, saving: integer, waitingForKey: integer, waitingForPanel: integer, failed: integer, bytes: number }), requires: ['running app'] },
  { name: 'media.favoriteElements', description: 'Read a saved favorite’s element fragment, or null when none exists.', effect: 'read', input: object({ itemKey: string() }, ['itemKey']), output: result({ itemKey: string(), fragmentJson: nullable(largeText) }), requires: ['existing media item key'] },
  { name: 'media.favoritesForPanel', description: 'List shape favorites still missing their element copies.', effect: 'read', input: object(pageInput), output: pageSchema(string('A favorite’s item key.')), requires: ['running app'] },
  { name: 'media.saveFavoriteElements', description: 'Save a missing favorite element copy through the library service, within its fragment limit.', effect: 'write', input: object({ itemKey: string() }, ['itemKey']), output: result({ itemKey: string(), kept: boolean, diskSaved: boolean }), content: 'text', contentRequired: true, requires: ['existing media item key'] },
  { name: 'newPlace.list', description: 'Read the three New note shortcuts for a vault.', effect: 'read', input: object({ root: string() }, ['root']), output: result(newPlaces), requires: ['explicit vault'] },
  { name: 'newPlace.set', description: 'Set or clear one zero-based New note shortcut, preserving the other current slots.', effect: 'write', input: object({ root: string(), slot: { type: 'integer', minimum: 0, maximum: 2 }, folder: { type: ['string', 'null'], maxLength: 4096 } }, ['root', 'slot', 'folder']), output: result({ ...newPlaces, ...saved }), requires: ['explicit vault and slot'] },
  { name: 'folder.create', description: 'Create a folder through the app’s ID-aware creation service. Title is optional and requires an ID vault. Never replaces an existing folder.', effect: 'write', input: object({ ...resourceInput, path: string(), title: string() }, ['path']), output: result({ path: string(), ...saved }), requires: ['explicit vault scope and new folder path'] },
  ...['asset', 'image', 'pdf'].flatMap(kind => ['read', 'export'].map(action => ({ name: `${kind}.${action}`, description: action === 'read' ? 'Read saved binary content as base64 with a saved revision. Large viewer files require export.' : 'Export saved bytes to an explicit new file. Never overwrites. Retains the existing file-kind size limit.', effect: action === 'read' ? 'read' as const : 'write' as const, input: object({ ...resourceInput, ...targetInput, ...(action === 'export' ? { outputFile: string() } : {}) }, action === 'export' ? ['outputFile'] : []), output: action === 'read' ? binaryRead : binaryExport, requires: ['explicit vault scope and target'] }))),
  { name: 'asset.write', description: 'Write image bytes or UTF-8 embedded drawing JSON through the asset service. Use a saved revision for replacement, or null for exclusive creation. Refused while an open editor holds unsaved edits of the asset. Retains the 10 MiB asset limit.', effect: 'write', input: object({ ...resourceInput, path: string(), revision: { type: ['string', 'null'] } }, ['path', 'revision']), output: result({ path: string(), mtime: number, size: integer, revision: string(), ...saved, rendererMerged: boolean }), content: 'binary', contentRequired: true, requires: ['explicit vault and asset path', 'saved revision or null for creation'] },
  ...documentCommands,
  ...configurationCommands,
  ...groupCommands,
  ...boardCommands,
  ...['drawing', 'diagram'].flatMap(kind => [
    { name: `${kind}.create`, description: 'Create an empty stamped board through the format service. Never replaces an existing file.', effect: 'write' as const, input: object({ ...resourceInput, path: string() }, ['path']), output: object({ path: string(), mtime: { type: 'number' }, size: { type: 'integer' }, diskSaved: { type: 'boolean' } }, ['path', 'mtime', 'size', 'diskSaved']), requires: ['explicit vault scope and new path'] },
    { name: `${kind}.setReadOnly`, description: 'Change the human Read only switch with a required saved revision. Agent writing does not require changing this switch. Refused while an open editor holds unsaved edits of this file.', effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, revision: string(), on: { type: 'boolean' as const } }, ['revision', 'on']), output: boardWritten, requires: ['explicit board and saved revision', 'no unsaved live edits of the file'] },
  ]),
  ...([
    { name: 'setHoverLinks', fields: { on: { type: 'boolean' } }, required: ['on'] },
    { name: 'setHoverOutline', fields: { value: { type: ['boolean', 'string'], enum: [true, false, 'app'] } }, required: ['value'] },
    { name: 'setFoldArrows', fields: { value: { type: 'string', enum: ['app', 'hover', 'always', 'off'] } }, required: ['value'] },
    { name: 'setPictures', fields: { out: { type: 'boolean' }, folder: string() }, required: ['out'] },
  ] as { name: string; fields: Record<string, CommandSchema>; required: string[] }[]).map(item => ({ name: `drawing.${item.name}`, description: 'Change this drawing option through the existing format service under its revision guard. Picture folders retain existing approval rules. Refused while an open editor holds unsaved edits of this file.', effect: 'write' as const, input: object({ ...resourceInput, ...targetInput, revision: string(), ...item.fields }, ['revision', ...item.required]), output: boardWritten, requires: ['explicit drawing and saved revision', 'no unsaved live edits of the file'] })),
  ...editorCommands,
  ...noteCommands,
  ...vaultConfigurationCommands,
  ...mediaCommands,
  ...connectedCommands,
  ...['show', 'close', 'rename'].map(action => ({ name: `window.${action}`, description: action === 'close' ? 'Acknowledge, then close the named window through its normal flush path. Closing the last window stops this app instance.' : `${action} an explicit live window. Rename persists its display name.`, effect: 'navigate' as const, input: object({ window: string(), ...(action === 'rename' ? { name: { type: ['string', 'null'] as const, maxLength: 200 } } : {}) }, action === 'rename' ? ['window', 'name'] : ['window']), output: appOutputs[`window.${action}`], requires: ['explicit live window'] })),
  { name: 'tab.open', description: 'Open a kept tab in an explicit window. Optional background/copy flags follow the existing tab rules.', effect: 'navigate', input: object({ window: string(), ...targetInput, background: { type: 'boolean' }, copy: { type: 'boolean' } }, ['window']), output: tabApplied, requires: ['explicit live window and target'] },
  { name: 'tab.blank', description: 'Show this window’s blank new-tab page.', effect: 'navigate', input: object({ window: string() }, ['window']), output: tabApplied, requires: ['explicit live window'] },
  ...['close', 'duplicate', 'keep', 'sleep', 'wake'].map(action => ({ name: `tab.${action}`, description: `${action} one exact tab through the existing workspace action. Close, sleep, and duplicate first save its editor and refuse unresolved dirty state.`, effect: 'navigate' as const, input: object({ window: string(), tab: string() }, ['window', 'tab']), output: tabApplied, requires: ['explicit live window and tab'] })),
  { name: 'tab.rename', description: 'Set a tab’s display name, or null to use the page name. Does not rename the file.', effect: 'navigate', input: object({ window: string(), tab: string(), name: { type: ['string', 'null'], maxLength: 200 } }, ['window', 'tab', 'name']), output: tabApplied, requires: ['explicit live window and tab'] },
  { name: 'tab.reorder', description: 'Move one tab to a zero-based final index in this window’s strip.', effect: 'navigate', input: object({ window: string(), tab: string(), index: { type: 'integer', minimum: 0 } }, ['window', 'tab', 'index']), output: tabApplied, requires: ['explicit live window and tab'] },
  { name: 'rightPanel.setOpen', description: 'Show or hide the explicit window’s right panel, as its › and ‹ buttons do. Its pages stay.', effect: 'navigate', input: object({ window: string(), open: { type: 'boolean' } }, ['window', 'open']), output: object({ window: string(), rightPanel: rightPanelSchema, diskSaved: { type: 'boolean' } }, ['window', 'rightPanel', 'diskSaved']), requires: ['explicit live window'] },
  { name: 'tab.move', description: 'Move one exact tab to another live window, or to a new window, through the app’s send-tab path. The source saves it first and refuses unresolved dirty state. Replies after both windows acknowledge.', effect: 'navigate', input: object({ window: string('Source window.'), tab: string('Source tab.'), to: string('Target live window.'), newWindow: { type: 'boolean', enum: [true] }, index: { type: 'integer', minimum: 0, description: 'Slot in the target strip, as a strip drop.' }, background: { type: 'boolean', description: 'Quiet move: the target does not raise or show the tab.' } }, ['window', 'tab']), output: object({ window: string(), target: string(), created: { type: 'boolean' }, path: string(), tab: string('The tab ID in the target.'), sourceClosed: { type: 'boolean', description: 'The source closed with its last tab.' }, diskSaved: { type: 'boolean' } }, ['window', 'target', 'created', 'path', 'tab', 'sourceClosed', 'diskSaved']), requires: ['explicit live source window and tab', 'a live target window that shows the page’s vault, or newWindow'] },
  { name: 'sidebar.setCollapsed', description: 'Show or hide the explicit window’s sidebar without changing its lens.', effect: 'navigate', input: object({ window: string(), collapsed: { type: 'boolean' } }, ['window', 'collapsed']), output: tabApplied, requires: ['explicit live window'] },
  { name: 'session.restore', description: 'Restore a saved session in a window with exactly its vaults. Preserve existing tabs and unrelated windows. Missing items require allowPartial.', effect: 'navigate', input: object({ session: string(), window: string(), mode: { type: 'string', enum: ['reuse', 'new'] }, allowPartial: { type: 'boolean' } }, ['session']), output: result({ session: string('The session ID.'), window: string(), roots: array(string()), missing: array(string('A vault or tab path that was not restored.')), applied: tabState, ...saved }), requires: ['existing session ID or unique name'] },
  { name: 'app.diagnostics', description: 'Read platform and process memory facts through the existing memory report. No secret store is read.', effect: 'read', input: object({}), output: result({ platform: string(), architecture: string(), version: string(), packaged: boolean, memory: nullable(memoryReport) }), requires: ['running app'] },
  { name: 'app.restart', description: 'Acknowledge, flush, and relaunch this same app/profile. Does not install a staged update. Receipts expire on restart.', effect: 'write', input: object({}), output: restartResult, requires: ['running app'] },
  ...['state', 'notes', 'check', 'restart'].map(action => ({ name: `update.${action}`, description: action === 'restart' ? 'Install a ready staged update after acknowledgement, or return the manual release URL. Refuses when no update is ready.' : `${action} through the app’s existing updater. Development checks preserve the updater’s disabled-feed rule.`, effect: action === 'check' ? 'remote' as const : action === 'restart' ? 'write' as const : 'read' as const, input: object({}), output: appOutputs[`update.${action}`], requires: ['running app'] })),
  { name: 'file.history', description: 'Read this live window’s bounded organization Undo and Redo history, oldest first. History ends with the app session.', effect: 'read', input: object({ window: string() }, ['window']), output: result({ undo: array(historyEntry), redo: array(historyEntry), source: literal('live'), window: string() }), requires: ['explicit live window'] },
  { name: 'file.restore', description: 'Restore the latest organization step only if it is a delete. Wait for all put-back results and retain Redo. A newer move or rename is refused.', effect: 'write', input: object({ window: string() }, ['window']), output: result({ restored: array(trashedItem), failed: array(string('One reason per item that stayed in the Trash.')) }), requires: ['explicit live window', 'latest Undo step is a delete with known Trash locations'] },
  ...['undo', 'redo'].map(verb => ({ name: `file.${verb}`, description: `${verb === 'undo' ? 'Undo' : 'Redo'} this window’s latest organization step (move, rename, retitle, or delete) through the same history as ${verb === 'undo' ? '⌘Z' : '⌘⇧Z'}. Links and folder values follow, as in the app.`, effect: 'write' as const, input: object({ window: string() }, ['window']), output: historyStepOutput, requires: ['explicit live window', `a step on its ${verb} list`] })),
  { name: 'file.rename', description: 'Rename or move an item through the complete window action: buffer flush, path repair, link updates, and Undo.', effect: 'write', input: object({ window: string(), path: string(), newPath: string() }, ['window', 'path', 'newPath']), output: result({ move: moved, cleared: array(cleared), links: linkCounts, ...saved }), requires: ['explicit live window', 'source and destination in its vaults'] },
  { name: 'file.retitle', description: 'Change a note or folder title using the existing complete rename action and Undo.', effect: 'write', input: object({ window: string(), path: string(), title: string() }, ['window', 'path', 'title']), output: result({ move: moved, cleared: array(cleared), links: linkCounts, ...saved }), requires: ['explicit live window'] },
  { name: 'file.trash', description: 'Move items to OS Trash through the existing app action, retaining restore locations and Undo where supported.', effect: 'write', input: object({ window: string(), paths: { ...array(string()), maxItems: 200 } }, ['window', 'paths']), output: result({ went: array(result({ path: string(), kind: itemKind, trashed: nullable(string('Where it is in the Trash; null means the delete has no Undo.')) })), failed: array(string('One reason per item that stayed.')) }), requires: ['explicit live window', 'items inside its vaults'] },

  { name: 'window.list', description: 'List live full windows, most recently focused first. This is not persisted session restoration state.', effect: 'read', input: object(pageInput), output: pageSchema(result({ id: string(), roots: array(string()), name: nullable(string()), source: literal('live') })), requires: ['running app'] },
  { name: 'window.inspect', description: 'Read current tabs, active tab, vaults, sidebar, right panel, and current/supported folder views. Unavailable view surfaces are explicit.', effect: 'read', input: object({ window: string() }, ['window']), output: result({ source: literal('live'), window: string(), roots: array(string()), activeTab: nullable(string()), tabs: array(liveTab), storedTabs: array(storedTab), tabViews: array(result({ tab: string(), state: { type: 'string', enum: ['ready', 'unavailable'] }, view: string(), views: array(string()) }, ['view', 'views'])), sidebar: sidebarTab, sidebarCollapsed: boolean, rightPanel: rightPanelSchema }), requires: ['explicit live window'] },
  { name: 'document.live', description: 'Read a ready editor buffer and selection from an explicit live tab. Never substitutes saved disk content.', effect: 'read', input: object({ window: string(), tab: string() }, ['window', 'tab']), output: object({ ...liveState, content: { type: 'string', maxLength: 64 * 1024 * 1024 } }, ['path', 'tab', 'source', 'kind', 'revision', 'actions', 'content', 'baselineMtime', 'dirty']), requires: ['explicit live window and ready tab'] },

  { name: 'app.status', description: 'Read this running Docs instance, its profile, and the automation protocol version. A dev run reports the Electron version as version.', effect: 'read', input: object({}), output: object({ version: string('The app version; a dev run reports Electron’s.'), automation: { type: 'integer', description: 'The automation protocol version, as in capabilities.' }, packaged: { type: 'boolean' }, profile: string(), running: { type: 'boolean' } }, ['version', 'automation', 'packaged', 'profile', 'running']), requires: ['running app'] },
  { name: 'request.status', description: 'Inspect a request receipt. Unknown is not proof that a mutation failed.', effect: 'read', input: object({ id: string() }, ['id']), output: object({ id: string(), state: { type: 'string', enum: ['queued', 'running', 'completed', 'unknown'] }, resultRetained: { type: 'boolean' }, result: result({ ok: boolean, value: anyJson, error: result({ code: string(), message: string(), details: open('Facts about the failure; each error code has its own.') }, ['details']) }, ['value', 'error']) }, ['id', 'state']), requires: ['same app session'] },
  { name: 'workspace.list', description: 'List saved workspace identities and vault roots.', effect: 'read', input: object(pageInput), output: pageSchema(object({ id: string(), name: string(), roots: array(string()), lastUsed: { type: 'number' } }, ['id', 'name', 'roots'])), requires: ['running app'] },
  { name: 'navigation.open', description: 'Open an exact context and wait until its renderer applies the requested state.', effect: 'navigate', input: navigationSchema, output: object({ window: string(), roots: array(string()), missing: array(string()), created: { type: 'boolean' }, applied: result({ path: nullable(string('The page on show; null on the blank page.')), tab: nullable(string()), sidebar: sidebarTab, sidebarCollapsed: boolean, rightPanel: rightPanelSchema, acknowledged: literal(true) }), closedStartWindows: { ...array(string()), description: 'Empty start windows (no vault) closed after a created window applied.' } }, ['window', 'roots', 'missing', 'created', 'applied', 'closedStartWindows']), requires: ['explicit workspace, vaults, or live window'] },
  { name: 'navigation.link', description: 'Generate a reusable machine-local navigation link with resolved paths and workspace identity.', effect: 'read', input: navigationSchema, output: object({ url: { type: 'string', maxLength: 64 * 1024 } }, ['url']), requires: ['running app', 'explicit workspace or vaults'] },
  { name: 'search.query', description: 'Search titles, aliases, filenames, and existing IDs within an explicit scope.', effect: 'read', input: object({ ...scopeInput, ...pageInput, query: string() }, ['query']), output: { ...pageSchema(searchRowSchema), properties: { ...pageSchema(searchRowSchema).properties, roots: array(string()) } }, requires: ['running app', 'exactly one workspace, root, or roots'] },
  { name: 'file.read', description: 'Read saved text and its revision. This does not read a dirty editor buffer.', effect: 'read', input: object({ ...resourceInput, ...targetInput }), output: object({ path: string(), content: { type: 'string', maxLength: 10 * 1024 * 1024 }, mtime: { type: 'number' }, size: { type: 'integer' }, source: { type: 'string', enum: ['disk'] }, revision: string() }, ['path', 'content', 'mtime', 'size', 'source', 'revision']), requires: ['running app', 'explicit vault scope and one target'] },
]

export const commandDefinition = (name: string): CommandDefinition => {
  const definition = AUTOMATION_COMMANDS.find(command => command.name === name)
  if (!definition) throw new AutomationFailure('UNKNOWN_COMMAND', `Unknown command: ${name}. Run capabilities --json.`)
  return definition
}
