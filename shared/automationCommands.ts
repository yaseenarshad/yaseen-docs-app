import { AutomationFailure } from './automation'
import { appCommands } from './commands/app'
import { boardCommands, assetCommands } from './commands/boards'
import { configurationCommands, groupCommands } from './commands/configuration'
import { connectedCommands } from './commands/connected'
import { documentCommands } from './commands/documents'
import { editorCommands } from './commands/editor'
import { folderCommands, idsCommands } from './commands/folders'
import { mediaCommands } from './commands/media'
import { noteCommands } from './commands/notes'
import { organizeCommands } from './commands/organize'
import type { CommandDefinition, CommandSchema } from './commands/schema'
import { vaultConfigurationCommands } from './commands/vaultConfiguration'
import { windowCommands } from './commands/windows'

export type { CommandSchema } from './commands/schema'
export { object, string } from './commands/schema'

/**
 * The public command allowlist. Each family lives in `shared/commands/<area>.ts`, beside the adapter it reaches. The
 * allowlist grows only with an implemented adapter and its checks. No IPC channel discovery.
 */
export const AUTOMATION_COMMANDS: readonly CommandDefinition[] = [
  ...appCommands, ...windowCommands, ...documentCommands, ...noteCommands, ...folderCommands, ...idsCommands, ...organizeCommands,
  ...configurationCommands, ...groupCommands, ...vaultConfigurationCommands, ...boardCommands, ...assetCommands, ...editorCommands,
  ...mediaCommands, ...connectedCommands,
]

export const commandDefinition = (name: string): CommandDefinition => {
  const definition = AUTOMATION_COMMANDS.find(command => command.name === name)
  if (!definition) throw new AutomationFailure('UNKNOWN_COMMAND', `Unknown command: ${name}. Run capabilities --json.`)
  return definition
}

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
