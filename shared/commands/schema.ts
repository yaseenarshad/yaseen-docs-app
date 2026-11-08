import { AUTOMATION_LIMITS } from '../automation'

/** JSON Schema subset used by public commands. Additional object keys are rejected by default. */
export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
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

// The one helper set of the registry. Each family module (`shared/commands/<area>.ts`) builds its schemas from these.
export const string = (description?: string): CommandSchema => ({ type: 'string', maxLength: 4096, ...(description ? { description } : {}) })
export const object = (properties: Record<string, CommandSchema>, required: readonly string[] = []): CommandSchema => ({ type: 'object', properties, required, additionalProperties: false })
/** An object result: every listed field is required unless named in `optional`. */
export const result = (properties: Record<string, CommandSchema>, optional: readonly string[] = []): CommandSchema => object(properties, Object.keys(properties).filter(key => !optional.includes(key)))
export const array = (items: CommandSchema): CommandSchema => ({ type: 'array', items, maxItems: 10_000 })
export const number: CommandSchema = { type: 'number' }, integer: CommandSchema = { type: 'integer' }, boolean: CommandSchema = { type: 'boolean' }
export const largeText: CommandSchema = { type: 'string', maxLength: AUTOMATION_LIMITS.contentBytes }
export const nullable = (schema: CommandSchema): CommandSchema => ({ ...schema, type: [schema.type as SchemaType, 'null'] })
export const literal = (value: string | boolean): CommandSchema => ({ type: typeof value as SchemaType, enum: [value] })
export const oneOf = (...values: string[]): CommandSchema => ({ type: 'string', enum: values })
/** Content with open keys: frontmatter, stored options, provider data. The description says which, so a reader knows why. */
export const open = (description: string): CommandSchema => ({ type: 'object', additionalProperties: true, description })
/** Any JSON value, such as a property value. */
export const anyValue: CommandSchema = { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], additionalProperties: true }

export const pageInput = { offset: { type: 'integer', minimum: 0 } as CommandSchema, limit: { type: 'integer', minimum: 1, maximum: AUTOMATION_LIMITS.maxPage } as CommandSchema }
const nextOffset: CommandSchema = { type: ['integer', 'null'], description: 'Next offset, or null when complete.' }
/** A page of items plus fields about the whole list. */
export const pageWith = (items: CommandSchema, fields: Record<string, CommandSchema> = {},
    optional: readonly string[] = []): CommandSchema => result({ ...fields, items: array(items), total: integer, nextOffset }, optional)
export const pageSchema = (items: CommandSchema): CommandSchema => object({ items: array(items), total: integer, nextOffset }, ['items', 'total', 'nextOffset'])

export const resourceInput = { workspace: string('Saved workspace ID or unique name.'), root: string('Absolute vault path.'), roots: array(string()) }
export const targetInput = { path: string('Absolute path.'), id: string('Existing note or folder ID, scoped to the vault.'), name: string('Unique exact title, alias, or filename.') }
export const listKind = oneOf('favorites', 'focus'), listScope = oneOf('vault', 'workspace')
export const scopeInput = { ...resourceInput, folder: string(), collection: listKind, scope: listScope, group: string() }
export const documentTarget = { ...resourceInput, ...targetInput }
export const documentEdit = { ...documentTarget, revision: string('Revision from file.read or comment.list.') }

export const saved = { diskSaved: boolean }
/** A save that landed and then missed a later step reports it here, never as a failure (D7, YAZ-4527). */
export const recorded = { warnings: array({ type: 'string', enum: ['RECENTS_NOT_SAVED'], description: 'RECENTS_NOT_SAVED: the file is saved; its Recents entry is not.' }) }
/** The answer to a delete sheet (D8, YAZ-4567): the CLI asks every time, whatever “Ask before deleting” says. */
export const confirm: CommandSchema = { type: 'boolean', enum: [true] }
export const exported = { outputFile: string(), size: integer, ...saved }
export const embeddedFiles: CommandSchema = { type: 'object', additionalProperties: object({ mimeType: string(), dataURL: largeText }, ['mimeType', 'dataURL']) }
