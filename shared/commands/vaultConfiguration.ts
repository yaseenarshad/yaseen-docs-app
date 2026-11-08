import { PROPERTY_KINDS } from '../types'
import { array, boolean, integer, object, oneOf, pageInput, pageSchema, pageWith, result, saved, string, type CommandDefinition, type CommandSchema } from './schema'

const propertyKind = oneOf(...PROPERTY_KINDS)
const declarationPatch = object({ kind: propertyKind, target: { type: ['string', 'null'] }, required: { type: ['boolean', 'null'] }, options: { type: ['array', 'null'], items: string(), maxItems: 500 }, optionSort: { type: ['string', 'null'], enum: ['manual', 'ascending', 'descending', null] } })
const declarationRow = result({ name: string(), kind: propertyKind, options: array(string()), optionSort: oneOf('manual', 'ascending', 'descending'), target: string(), required: boolean },
    ['options', 'optionSort', 'target', 'required'])
const declarations = pageWith(declarationRow,
    { root: string(), version: { ...integer, description: 'properties.json version; above 1 is readable, not writable.' }, error: string('properties.json exists but is unusable.'), ...saved },
    ['error', 'diskSaved'])
const icons = pageWith(result({ path: string(), icon: string() }), { root: string(), ...saved }, ['diskSaved'])
const configValue = (nullable: boolean): CommandSchema => ({ type: nullable ? ['object', 'null'] : 'object', additionalProperties: true, description: `The file’s content: its fields are the file’s own${nullable ? '; null when the file is absent' : ''}.` })
const configName = oneOf('review.json', 'text-formatting.json')
const newPlaces = { root: string(), places: array({ type: ['string', 'null'], maxLength: 4096, description: 'A folder, or null for an empty slot. Three slots.' }) }
const command = (name: string, description: string, effect: CommandDefinition['effect'], input: CommandSchema, output: CommandSchema,
    requires: readonly string[] = ['explicit vault']): CommandDefinition => ({ name, description, effect, input, output, requires })

export const vaultConfigurationCommands: CommandDefinition[] = [
  command('declaration.list', 'List a vault’s property declarations (properties.json): each property’s kind and options. A vault without the file lists none, and nothing is created.', 'read',
      object({ root: string(), ...pageInput }, ['root']), declarations),
  command('declaration.patch', 'Change one property declaration and keep the others. Give kind to create it. Null removes an optional field.', 'write',
      object({ root: string(), name: string(), changes: declarationPatch }, ['root', 'name', 'changes']), declarations),
  command('declaration.remove', 'Remove one property declaration. The notes keep their values.', 'write', object({ root: string(), name: string() }, ['root', 'name']), declarations),
  command('icon.list', 'List the icons picked for a vault’s items, sorted by path. A vault without icons lists none, and nothing is created.', 'read',
      object({ root: string(), ...pageInput }, ['root']), icons),
  command('icon.set', 'Set one existing item’s icon and keep the other picks. The icon is a name the app ships (icon.names); another fails with INVALID_INPUT.', 'write',
      object({ root: string(), path: string(), icon: string() }, ['root', 'path', 'icon']), icons, ['explicit vault and existing item']),
  command('icon.remove', 'Remove one item’s icon pick, also for an item that is gone, and keep the other picks.', 'write', object({ root: string(), path: string() }, ['root', 'path']), icons),
  command('icon.names', 'List the icon names the app ships, as the icon picker lists them. query keeps names holding each of its words (split at spaces and dashes), as the picker’s search.', 'read',
      object({ query: string(), ...pageInput }), pageSchema(string('An icon name for icon.set or an icon rule.')), ['running app']),
  command('vaultConfig.read', 'Read a vault’s review settings (review.json) or text formatting (text-formatting.json). An absent file reads as null.', 'read',
      object({ root: string(), name: configName }, ['root', 'name']), result({ root: string(), name: string(), value: configValue(true) })),
  command('vaultConfig.patch', 'Change named fields of review.json or text-formatting.json and keep the others. Null resets a field to its default.', 'write',
      object({ root: string(), name: configName, changes: { type: 'object', additionalProperties: true } }, ['root', 'name', 'changes']),
      result({ root: string(), name: string(), value: configValue(false), ...saved })),
  command('newPlace.list', 'Read a vault’s three New note shortcuts: a folder, or null, for each slot.', 'read', object({ root: string() }, ['root']), result(newPlaces)),
  command('newPlace.set', 'Set or clear one of a vault’s three New note shortcuts (slot 0–2). The other slots stay.', 'write',
      object({ root: string(), slot: { type: 'integer', minimum: 0, maximum: 2 }, folder: { type: ['string', 'null'], maxLength: 4096 } }, ['root', 'slot', 'folder']),
      result({ ...newPlaces, ...saved }), ['explicit vault and slot']),
]
