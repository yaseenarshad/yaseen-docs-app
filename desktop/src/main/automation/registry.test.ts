// YAZ-4506: a fresh agent learns each command from capabilities alone. Every output declares its fields; an open
// object is allowed only where the data is content with open keys, and it says so in its description.
import { expect, it } from 'vitest'
import { AUTOMATION_COMMANDS, type CommandSchema } from '@shared/automationCommands'

/** The open-content fields, by the end of their path. Anything else open fails. */
const OPEN_CONTENT = [
  /^settings\.(get|patch):\.settings\.\w+$/, // a settings group or list; settings.patch validates it
  /^comment\.list:\.items\[\]$/, // a comment keeps the extra keys its file holds
  /^vaultConfig\.(read|patch):\.value$/, // review.json or text-formatting.json content
  /^media\.drawing:\.elements\[\]$/, // provider Excalidraw elements
  /^request\.status:\.result\.(value|error\.details)$/, // another command's value, or its error facts
  /^file\.(rename|retitle):\.cleared\[\]\.values$/, /^file\.history:\.(undo|redo)\[\]\.cleared\[\]\.values$/, // cleared folder values
  /^(folder|folderView|folderColumn|folderFormula)\.\w+:\.(views\[\]|properties)$/, // stored views and the folder's own properties
]

function openFields(schema: CommandSchema, path: string, out: { path: string; described: boolean }[]) {
  const types = typeof schema.type === 'string' ? [schema.type] : schema.type
  if ((types.includes('object') && schema.additionalProperties === true) || (types.includes('array') && !schema.items)) out.push({ path, described: Boolean(schema.description) })
  for (const [name, field] of Object.entries(schema.properties ?? {})) openFields(field, `${path}.${name}`, out)
  if (typeof schema.additionalProperties === 'object') openFields(schema.additionalProperties, `${path}.*`, out)
  if (schema.items) openFields(schema.items, `${path}[]`, out)
  return out
}

it('declares a description, an effect, requirements, and closed outputs for every command', () => {
  const open = AUTOMATION_COMMANDS.flatMap(command => {
    expect(command.description.length, command.name).toBeGreaterThan(10)
    expect(['read', 'navigate', 'write', 'remote', 'restart'], command.name).toContain(command.effect)
    expect(command.requires.length, command.name).toBeGreaterThan(0)
    expect(command.output.type, command.name).toBe('object')
    return openFields(command.output, `${command.name}:`, [])
  })
  expect(open.filter(field => !OPEN_CONTENT.some(rule => rule.test(field.path))).map(field => field.path)).toEqual([])
  expect(open.filter(field => !field.described).map(field => field.path)).toEqual([])
  // Each rule still names a real field, so the list cannot hide a removed one.
  for (const rule of OPEN_CONTENT) expect(open.some(field => rule.test(field.path)), String(rule)).toBe(true)
})
