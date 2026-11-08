import { AutomationFailure } from './automation'

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
  effect: 'read' | 'navigate'
  input: CommandSchema
  output: CommandSchema
  requires: readonly string[]
}
const string = (description?: string): CommandSchema => ({ type: 'string', maxLength: 4096, ...(description ? { description } : {}) })
const object = (properties: Record<string, CommandSchema>, required: readonly string[] = []): CommandSchema => ({ type: 'object', properties, required, additionalProperties: false })
const array = (items: CommandSchema): CommandSchema => ({ type: 'array', items, maxItems: 10_000 })
const boolean = { type: 'boolean' } as CommandSchema
const nullable = (schema: CommandSchema): CommandSchema => ({ ...schema, type: [schema.type as SchemaType, 'null'] })
/** An object result: every listed field is required unless named in `optional`. */
const result = (properties: Record<string, CommandSchema>, optional: readonly string[] = []): CommandSchema => object(properties, Object.keys(properties).filter(key => !optional.includes(key)))
/** Content with open keys. The description says which, so a reader knows why. */
const open = (description: string): CommandSchema => ({ type: 'object', additionalProperties: true, description })
const anyJson = { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], additionalProperties: true, description: 'The original command’s value. Its schema is that command’s output.' } as CommandSchema
const sidebar = { type: 'string', enum: ['files', 'favorites', 'focus'] } as CommandSchema

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

const navigationInput = object({
  workspace: string('Saved workspace ID or unique name.'), root: string('Absolute vault path.'), roots: { ...array(string()), description: 'Absolute vault paths, for a window on several vaults.' },
  path: string('Absolute folder or page inside those vaults.'), window: string('A live window ID from an earlier reply.'),
  mode: { type: 'string', enum: ['reuse', 'new'], description: 'reuse (default): the most recent window on exactly these vaults, else a new one. new: always a new window.' },
  sidebar: { ...sidebar, description: 'The sidebar list to show.' },
  scope: { type: 'string', enum: ['vault', 'workspace'], description: 'Check that the window shows this Favorites or Focus list. It never changes the list.' },
  group: string('A Favorites or Focus group ID or unique name to reveal.'), view: string('A saved view of the target folder page.'),
  reveal: { type: 'boolean', description: 'Reveal and expand the target in the sidebar list. Default true when a sidebar is named.' },
  allowPartial: { type: 'boolean', description: 'Open a workspace even when some of its vault folders are missing.' },
})

/** The allowlist grows only with an implemented adapter and its checks. No IPC channel discovery. */
export const AUTOMATION_COMMANDS: readonly CommandDefinition[] = [
  { name: 'app.status', description: 'Read this running Docs instance, its profile, and the automation protocol version. A dev run reports the Electron version as version.', effect: 'read', input: object({}), output: object({ version: string('The app version; a dev run reports Electron’s.'), automation: { type: 'integer', description: 'The automation protocol version, as in capabilities.' }, packaged: { type: 'boolean' }, profile: string(), running: { type: 'boolean' } }, ['version', 'automation', 'packaged', 'profile', 'running']), requires: ['running app'] },
  { name: 'request.status', description: 'Inspect a request receipt. Unknown is not proof that a request failed.', effect: 'read', input: object({ id: string() }, ['id']), output: object({ id: string(), state: { type: 'string', enum: ['queued', 'running', 'completed', 'unknown'] }, resultRetained: { type: 'boolean' }, result: result({ ok: boolean, value: anyJson, error: result({ code: string(), message: string(), details: open('Facts about the failure; each error code has its own.') }, ['details']) }, ['value', 'error']) }, ['id', 'state']), requires: ['same app session'] },
  { name: 'navigation.open', description: 'Open a vault or saved workspace in a new or reused window, show a sidebar list, reveal a folder or page, and pick a folder view. Replies after the window shows the result. Starts Docs when it is not running.', effect: 'navigate', input: navigationInput, output: object({ window: string(), roots: array(string()), missing: { ...array(string()), description: 'Workspace vault folders that were not found (allowPartial).' }, created: boolean, applied: result({ path: nullable(string('The page on show; null on the blank page.')), tab: nullable(string()), sidebar: { type: 'string', enum: ['files', 'favorites', 'focus', 'search', 'sessions', 'recents'] }, sidebarCollapsed: boolean, acknowledged: { type: 'boolean', enum: [true] } }), closedStartWindows: { ...array(string()), description: 'Empty start windows (no vault) closed after a created window applied.' } }, ['window', 'roots', 'missing', 'created', 'applied', 'closedStartWindows']), requires: ['exactly one workspace, root, or roots; or a live window'] },
]

export const commandDefinition = (name: string): CommandDefinition => {
  const definition = AUTOMATION_COMMANDS.find(command => command.name === name)
  if (!definition) throw new AutomationFailure('UNKNOWN_COMMAND', `Unknown command: ${name}. Run capabilities --json.`)
  return definition
}
