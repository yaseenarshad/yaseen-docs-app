import { PROPERTY_KINDS } from '../types'
import { anyValue, array, boolean, confirm, integer, object, oneOf, pageInput, pageSchema, recorded, resourceInput, result, saved, string, type CommandDefinition, type CommandSchema,
    type SchemaType } from './schema'

const folderTarget = { ...resourceInput, path: string('Absolute folder path.'), id: string('Existing folder ID, scoped to the vault.') }
const folderRevision: CommandSchema = { type: ['string', 'null'], maxLength: 4096, description: 'Revision from folder.read; null while the folder has no .folder.md.' }
const storedView: CommandSchema = { type: 'object', properties: { type: string(), name: string() }, required: ['type', 'name'], additionalProperties: true,
    description: 'A view as stored: its type, name, and options. Unknown keys and types are kept verbatim.' }
const nullableText = (maxLength: number): CommandSchema => ({ type: ['string', 'null'], maxLength })
const optionSort = oneOf('manual', 'ascending', 'descending')
const folderPage = {
  root: string(), path: string(), file: string('The folder page file, .folder.md, which may not exist yet.'), exists: boolean, revision: folderRevision, ids: boolean,
  id: nullableText(4096), title: string(), views: array(storedView), defaultView: { ...nullableText(4096), description: 'The saved starting view.' },
  startView: string('The view a fresh open shows.'), columns: { type: 'object',
      additionalProperties: object({ kind: string(), target: string(), required: boolean, options: array(string()), optionSort: string() }) } as CommandSchema,
  formulas: { type: 'object', additionalProperties: string() } as CommandSchema, labels: { type: 'object', additionalProperties: object({ displayName: string() }) } as CommandSchema,
  problems: array(string()), properties: { type: 'object', additionalProperties: true, description: 'The folder’s own frontmatter properties, beside its settings.' } as CommandSchema,
}
const pageKeys = Object.keys(folderPage)
/** A folder page after a write, plus the fields that say what this write did. */
const folderWrite = (fields: Record<string, CommandSchema>): CommandSchema =>
  object({ ...folderPage, ...fields, changed: boolean, created: { ...boolean, description: 'This write created .folder.md.' }, diskSaved: boolean, ...recorded },
      [...pageKeys, ...Object.keys(fields).filter(key => key !== 'view'), 'changed', 'created', 'diskSaved'])
const folderWriteOutput = folderWrite({ view: string('The view this command changed.') })
const folderColumnOutput = folderWrite({ column: string() })
const option = (...types: SchemaType[]): CommandSchema => ({ type: [...types, 'null'], additionalProperties: true })
/** Every option some view type reads (`VIEW_OPTIONS`). The adapter refuses one this view's type does not read. Null removes an option. */
const viewOptions = object({
  filters: option('string', 'object'), order: option('array'), sort: option('array'), groupBy: option('object', 'array'), limit: option('integer'), summaries: option('object'),
  columnSize: option('object'), frozenColumns: option('integer'), rowNumbers: option('boolean'), rowHeight: option('string'),
  showEmptyColumns: option('boolean'), cardSize: option('number', 'string'), cardStyle: option('object'),
  image: option('string'), imageFit: option('string'), imageAspectRatio: option('number', 'string'),
  indentProperties: option('boolean'), markerStyle: option('string'), propertySeparator: option('string'), outline: nullableText(60_000),
})
const folderRequires = ['explicit vault scope and folder', 'revision from folder.read']
/** A folder page write: the folder, its revision from folder.read, and this command's fields. */
const folderEdit = (name: string, description: string, fields: Record<string, CommandSchema>, required: string[], output = folderWriteOutput): CommandDefinition =>
  ({ name, description, effect: 'write', input: object({ ...folderTarget, revision: folderRevision, ...fields }, ['revision', ...required]), output, requires: folderRequires })
const propertyName = string('A snake_case property name.')
const shortcutPage = pageSchema(object({ path: string(), title: string(), id: nullableText(4096) }, ['path', 'title', 'id']))
const shortcutInput = { ...folderTarget, note: string('Absolute note path.'), revision: string('The note’s revision from file.read.') }
const shortcutOutput = object({ root: string(), folder: string(), note: string(), revision: string(), changed: boolean, folderId: string(), folderIdCreated: boolean, diskSaved: boolean, ...recorded },
    ['root', 'folder', 'note', 'revision', 'changed', 'diskSaved'])
const shortcutRequires = ['explicit vault scope and folder', 'vault that uses IDs', 'note revision']

export const folderCommands: CommandDefinition[] = [
  { name: 'folder.read', description: 'Read a folder page: its settings, views, starting view, columns, and own properties. A folder without .folder.md reads as the defaults, and nothing is created.',
      effect: 'read', input: object(folderTarget), output: object(folderPage, pageKeys), requires: ['explicit vault scope and folder'] },
  { name: 'folder.create', description: 'Create a new folder, with its ID in a vault that uses IDs. A title needs such a vault. An existing folder is never replaced.', effect: 'write',
      input: object({ ...resourceInput, path: string(), title: string() }, ['path']), output: result({ path: string(), ...saved }), requires: ['explicit vault scope and new folder path'] },
  folderEdit('folder.setProperty', 'Set one of the folder’s own properties. The app’s reserved keys and folder_settings have their own commands.', { name: propertyName, value: anyValue },
      ['name', 'value']),
  folderEdit('folder.removeProperty', 'Remove one of the folder’s own properties.', { name: propertyName }, ['name']),
  folderEdit('folderView.add', 'Add a view, named like the + menu unless a unique name is given. A page has one outline view.',
      { type: oneOf('table', 'board', 'cards', 'list', 'outline'), name: string() }, ['type']),
  folderEdit('folderView.rename', 'Rename a view. The starting view and the collapsed groups follow.', { view: string(), name: string() }, ['view', 'name']),
  folderEdit('folderView.duplicate', 'Duplicate a view beside it as “<name> copy”. Outline views have no duplicate.', { view: string() }, ['view']),
  folderEdit('folderView.remove',
      'Delete a view, with its columns, sort, filters and grouping; an outline view’s document goes with it. confirm: true answers the delete sheet. A deleted starting view clears; the last view stays.',
      { view: string(), confirm }, ['view', 'confirm']),
  folderEdit('folderView.move', 'Move a view to a zero-based final index in the view tabs.', { view: string(), index: { type: 'integer', minimum: 0 } }, ['view', 'index']),
  folderEdit('folderView.setOptions', 'Set or, with null, remove options this view type reads. An unknown or unsupported option fails and nothing is written.',
      { view: string(), changes: viewOptions }, ['view', 'changes']),
  folderEdit('folderView.setDefault', 'Set the saved starting view, or null for the first view. To show a view in a live window now, use navigation.open --view.', { view: nullableText(4096) },
      ['view']),
  folderEdit('folderColumn.set', 'Declare or change one folder column, as the Properties menu does. Fields that its kind does not use are dropped. Show it in a view with folderView.setOptions order.',
      { key: string('A snake_case column key.'), definition: object({ kind: oneOf(...PROPERTY_KINDS), target: string(), required: boolean, options: { type: 'array', items: string(), maxItems: 500 }, optionSort }, ['kind']) },
      ['key', 'definition'], folderColumnOutput),
  folderEdit('folderColumn.setLabel', 'Set a column’s display name, or clear it with null. The key never changes.', { key: string(), label: nullableText(200) }, ['key', 'label'], folderColumnOutput),
  folderEdit('folderColumn.remove',
      'Delete a column as “Delete column…” does: its declaration, label and view references, then this folder’s value in every note holding one. confirm: true answers the delete sheet.',
      { key: string(), confirm }, ['key', 'confirm'],
    object({ ...folderColumnOutput.properties, cleared: { type: 'integer', minimum: 0 }, failed: array(object({ path: string(), reason: string() }, ['path', 'reason'])) },
        [...folderColumnOutput.required!, 'cleared', 'failed'])),
  folderEdit('folderFormula.set', 'Set a named formula, or remove it with null. A removal also drops its references from the views. A bad expression shows as an error in its cells.',
      { name: string(), expression: nullableText(4096) }, ['name', 'expression'], folderWrite({ formula: string() })),
  { name: 'shortcut.list', description: 'List the notes that appear in this folder by a shortcut. It reads the index and assigns no ID.', effect: 'read',
      input: object({ ...folderTarget, ...pageInput }),
      output: { ...shortcutPage, properties: { ...shortcutPage.properties, root: string(), path: string() }, required: [...shortcutPage.required!, 'root', 'path'] },
      requires: ['explicit vault scope and folder', 'vault that uses IDs'] },
  { name: 'shortcut.add', description: 'Make a note that lives elsewhere also appear in this folder. A folder without an ID takes the vault’s next number first.', effect: 'write',
      input: object(shortcutInput, ['note', 'revision']), output: shortcutOutput, requires: shortcutRequires },
  { name: 'shortcut.remove', description: 'Stop a note appearing in this folder. When that clears other folders’ values, pass dropValues: true.', effect: 'write',
      input: object({ ...shortcutInput, dropValues: boolean }, ['note', 'revision']), output: shortcutOutput, requires: shortcutRequires },
]

const idsCount: CommandSchema = { type: 'integer', minimum: 0 }
const idsAsk = object({ notes: idsCount, folders: idsCount, foreign: idsCount }, ['notes', 'folders', 'foreign'])
const idsFields = { root: string(), letters: string('The vault’s current ID letters.'), notes: idsCount, stale: idsCount, old: idsCount, unfinished: boolean }
const idsState = { ...idsFields, answer: { type: ['boolean', 'null'], description: 'The vault’s answer; null when it has not answered.' } as CommandSchema,
    saved: { ...boolean, description: 'The letters are saved in ids.json.' }, ask: { ...idsAsk, description: 'What turning IDs on would write.' } }
const idsStateWith = (fields: Record<string, CommandSchema>) => object({ ...idsState, ...fields }, [...Object.keys(idsState), ...Object.keys(fields)])
const idsPass = object({ ...idsFields, changed: idsCount, renamed: idsCount, left: array(string()), stopped: boolean, diskSaved: boolean },
    [...Object.keys(idsFields), 'changed', 'renamed', 'left', 'stopped', 'diskSaved'])

export const idsCommands: CommandDefinition[] = [
  { name: 'ids.state', description: 'Read a vault’s ID answer, letters, and counts. Never assigns, adopts, or mints an ID.', effect: 'read', input: object({ root: string() }, ['root']),
      output: idsStateWith({}), requires: ['explicit vault'] },
  { name: 'ids.enable', description: 'Turn on IDs and give every note and folder its number now. letters confirms: the vault’s saved letters, or new letters for a vault with none.', effect: 'write',
      input: object({ root: string(), letters: string() }, ['root', 'letters']),
      output: idsStateWith({ given: object({ notes: idsCount, folders: idsCount }, ['notes', 'folders']), left: idsAsk, changed: boolean }), requires: ['explicit vault', 'typed letters'] },
  { name: 'ids.disable', description: 'Turn off IDs. Nothing is removed; links stored as IDs do not open until IDs are on again. confirm: true confirms it, as the app’s question does.',
      effect: 'write', input: object({ root: string(), confirm }, ['root', 'confirm']), output: idsStateWith({ changed: boolean }), requires: ['explicit vault', 'confirm: true'] },
  { name: 'ids.reletter', description: 'Change the vault’s ID letters in every ID, link, and built file name. The current letters finish a change that stopped.', effect: 'write',
      input: object({ root: string(), letters: string() }, ['root', 'letters']), output: idsPass, requires: ['explicit vault that uses IDs', 'new letters'] },
  { name: 'ids.backfill', description: 'Give each old 12-character ID the vault’s next number, then update its links. letters confirms with the vault’s letters.', effect: 'write',
      input: object({ root: string(), letters: string() }, ['root', 'letters']), output: idsPass, requires: ['explicit vault that uses IDs', 'typed letters'] },
  { name: 'ids.check', description: 'Settle notes that share an ID now, as Check for duplicates does. A clash another Mac must fix is reported, not changed.', effect: 'write',
      input: object({ root: string() }, ['root']), output: idsStateWith({ line: string(), fixed: idsCount, copies: idsCount, otherMac: idsCount, later: idsCount }),
      requires: ['explicit vault that uses IDs'] },
]
