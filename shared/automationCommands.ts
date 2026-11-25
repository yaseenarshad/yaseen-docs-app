import { AutomationFailure } from './automation'
import { MAX_BATCH_PATHS, TAB_MODES, TILE_PRESETS } from './automationNavigation'

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
  effect: 'read' | 'navigate' | 'window'
  input: CommandSchema
  output: CommandSchema
  requires: readonly string[]
}
const string = (description?: string): CommandSchema => ({ type: 'string', maxLength: 4096, ...(description ? { description } : {}) })
const integer = (description?: string, minimum?: number): CommandSchema => ({ type: 'integer', ...(description ? { description } : {}), ...(minimum !== undefined ? { minimum } : {}) })
const object = (properties: Record<string, CommandSchema>, required: readonly string[] = []): CommandSchema => ({ type: 'object', properties, required, additionalProperties: false })
const array = (items: CommandSchema, maxItems = 10_000): CommandSchema => ({ type: 'array', items, maxItems })
const boolean = (description?: string): CommandSchema => ({ type: 'boolean', ...(description ? { description } : {}) })
const nullable = (schema: CommandSchema): CommandSchema => ({ ...schema, type: [schema.type as SchemaType, 'null'] })
/** An object result: every listed field is required unless named in `optional`. */
const result = (properties: Record<string, CommandSchema>, optional: readonly string[] = []): CommandSchema => object(properties, Object.keys(properties).filter(key => !optional.includes(key)))
/** Content with open keys. The description says which, so a reader knows why. */
const open = (description: string): CommandSchema => ({ type: 'object', additionalProperties: true, description })
const anyJson = { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], additionalProperties: true, description: 'The original command’s value. Its schema is that command’s output.' } as CommandSchema
const sidebar = { type: 'string', enum: ['files', 'favorites', 'focus'] } as CommandSchema
const tabMode = { type: 'string', enum: TAB_MODES, description: 'reuse (default for single path): open in current tab; new: open a new tab; activate-or-new: activate existing tab or open a new one.' } as CommandSchema
const tilePreset = { type: 'string', enum: TILE_PRESETS, description: 'OS window tile preset computed against the target display workArea.' } as CommandSchema
const displaySelector = { type: ['string', 'integer'], description: 'Target display: primary, cursor, next, or a display ID from window.list.' } as CommandSchema
const boundsSchema = result({ x: integer(), y: integer(), width: integer(undefined, 1), height: integer(undefined, 1) })
const tabSummarySchema = result({ tab: string(), path: nullable(string()), title: string(), active: boolean(), dirty: boolean() })

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
  path: string('Absolute folder or page inside those vaults.'),
  paths: { ...array(string(), MAX_BATCH_PATHS), description: `Batch of up to ${MAX_BATCH_PATHS} absolute paths to open as tabs in order.` },
  activePath: string('Which path in `paths` to activate (defaults to first valid path).'),
  tabMode,
  window: string('A live window ID from an earlier reply.'),
  mode: { type: 'string', enum: ['reuse', 'new'], description: 'reuse (default): the most recent window on exactly these vaults, else a new one. new: always a new window.' },
  focus: boolean('Focus/raise the window (default true). Pass false (--no-focus) to avoid stealing focus.'),
  tile: tilePreset,
  display: displaySelector,
  sidebar: { ...sidebar, description: 'The sidebar list to show.' },
  scope: { type: 'string', enum: ['vault', 'workspace'], description: 'Check that the window shows this Favorites or Focus list. It never changes the list.' },
  group: string('A Favorites or Focus group ID or unique name to reveal.'), view: string('A saved view of the target folder page.'),
  reveal: { type: 'boolean', description: 'Reveal and expand the target in the sidebar list. Default true when a sidebar is named.' },
  allowPartial: { type: 'boolean', description: 'Open a workspace even when some of its vault folders are missing.' },
  readOnly: { type: 'boolean', description: 'Open the window in transient read-only mode without writing .yaseendocs/.' },
  line: { type: 'integer', minimum: 1, description: '1-based line number to jump to in the target file.' },
})

const navigationOutput = result(
  {
    window: string(),
    roots: array(string()),
    missing: { ...array(string()), description: 'Workspace vault folders that were not found (allowPartial).' },
    missingPaths: { ...array(string()), description: 'Requested batch paths that did not exist on disk.' },
    created: boolean(),
    applied: result(
      {
        path: nullable(string('The page on show; null on the blank page.')),
        tab: nullable(string()),
        tabs: array(result({ tab: string(), path: nullable(string()) })),
        sidebar: { type: 'string', enum: ['files', 'favorites', 'focus', 'search', 'sessions', 'recents'] },
        sidebarCollapsed: boolean(),
        acknowledged: { type: 'boolean', enum: [true] },
      },
      ['tabs'],
    ),
    closedStartWindows: { ...array(string()), description: 'Empty start windows (no vault) closed after a created window applied.' },
  },
  ['missingPaths'],
)

/** The allowlist grows only with an implemented adapter and its checks. No IPC channel discovery. */
export const AUTOMATION_COMMANDS: readonly CommandDefinition[] = [
  { name: 'app.status', description: 'Read this running Docs instance, its profile, and the automation protocol version. A dev run reports the Electron version as version.', effect: 'read', input: object({}), output: object({ version: string('The app version; a dev run reports Electron’s.'), automation: { type: 'integer', description: 'The automation protocol version, as in capabilities.' }, packaged: { type: 'boolean' }, profile: string(), running: { type: 'boolean' } }, ['version', 'automation', 'packaged', 'profile', 'running']), requires: ['running app'] },
  { name: 'request.status', description: 'Inspect a request receipt. Unknown is not proof that a request failed.', effect: 'read', input: object({ id: string() }, ['id']), output: object({ id: string(), state: { type: 'string', enum: ['queued', 'running', 'completed', 'unknown'] }, resultRetained: { type: 'boolean' }, result: result({ ok: boolean(), value: anyJson, error: result({ code: string(), message: string(), details: open('Facts about the failure; each error code has its own.') }, ['details']) }, ['value', 'error']) }, ['id', 'state']), requires: ['same app session'] },
  { name: 'navigation.open', description: 'Open a vault or saved workspace in a new or reused window, open one or many tabs, optionally tile the window, show a sidebar list, reveal a folder or page, and pick a folder view. Replies after the window shows the result. Starts Docs when it is not running.', effect: 'navigate', input: navigationInput, output: navigationOutput, requires: ['exactly one workspace, root, or roots; or a live window'] },
  {
    name: 'window.list',
    description: 'List all displays and live Yaseen Docs windows with their OS bounds, state, and live tabs.',
    effect: 'read',
    input: object({}),
    output: result({
      displays: array(result({ id: integer(), label: string(), primary: boolean(), workArea: boundsSchema, bounds: boundsSchema })),
      windows: array(
        result({
          window: string(),
          roots: array(string()),
          readOnly: boolean(),
          ready: boolean(),
          focused: boolean(),
          minimized: boolean(),
          fullscreen: boolean(),
          displayId: integer(),
          bounds: boundsSchema,
          activeTab: nullable(string()),
          tabs: array(tabSummarySchema),
        }),
      ),
    }),
    requires: ['running app'],
  },
  {
    name: 'window.move',
    description: 'Position or tile a live window on a display using a preset or explicit pixel bounds.',
    effect: 'window',
    input: object(
      {
        window: string('Live window ID from window.list.'),
        tile: tilePreset,
        display: displaySelector,
        x: integer('Left x coordinate in screen pixels.'),
        y: integer('Top y coordinate in screen pixels.'),
        width: integer('Window width in pixels.', 1),
        height: integer('Window height in pixels.', 1),
        focus: boolean('Focus/raise the window after moving (default false).'),
      },
      ['window'],
    ),
    output: result({ window: string(), displayId: integer(), bounds: boundsSchema, focused: boolean(), exitedFullScreen: boolean() }),
    requires: ['running app', 'live window ID', 'tile preset or bounds coordinates'],
  },
  {
    name: 'window.focus',
    description: 'Restore if minimized and bring a live window to the front.',
    effect: 'window',
    input: object({ window: string('Live window ID from window.list.') }, ['window']),
    output: result({ window: string(), focused: boolean(), restored: boolean() }),
    requires: ['running app', 'live window ID'],
  },
  {
    name: 'window.minimize',
    description: 'Minimize a live window.',
    effect: 'window',
    input: object({ window: string('Live window ID from window.list.') }, ['window']),
    output: result({ window: string(), minimized: boolean() }),
    requires: ['running app', 'live window ID'],
  },
  {
    name: 'window.close',
    description: 'Flush pending saves and close a live window. Refuses with DIRTY_TAB if a save fails or conflicts unless force is true.',
    effect: 'window',
    input: object({ window: string('Live window ID from window.list.'), force: boolean('Close even if a save fails or conflicts.') }, ['window']),
    output: result({ window: string(), closed: boolean() }),
    requires: ['running app', 'live window ID'],
  },
  {
    name: 'tab.activate',
    description: 'Activate an open tab in a live window by tab ID or file path.',
    effect: 'window',
    input: object(
      {
        window: string('Live window ID from window.list.'),
        tab: string('Tab ID from window.list.'),
        path: string('Absolute path of an open tab in that window.'),
        focus: boolean('Focus the window as well (default false).'),
      },
      ['window'],
    ),
    output: result({ window: string(), tab: string(), path: nullable(string()), focused: boolean() }),
    requires: ['running app', 'live window ID', 'tab or path'],
  },
  {
    name: 'tab.close',
    description: 'Flush and close one or more tabs in a live window. Keeps the window open on Start page if the last tab closes.',
    effect: 'window',
    input: object(
      {
        window: string('Live window ID from window.list.'),
        tab: string('Tab ID to close (or keep when others is true).'),
        path: string('Absolute path of tab(s) to close (or keep when others is true).'),
        tabs: array(string(), MAX_BATCH_PATHS),
        others: boolean('Close every tab in the window except the specified or active tab.'),
        force: boolean('Close even if a save fails or conflicts.'),
      },
      ['window'],
    ),
    output: result({ window: string(), closed: array(string()), activeTab: nullable(string()), closedWindow: boolean() }),
    requires: ['running app', 'live window ID'],
  },
  {
    name: 'tab.move',
    description: 'Move a tab from one live window to another live window or pop it out into a new (optionally tiled) window.',
    effect: 'window',
    input: object(
      {
        from: string('Source live window ID.'),
        tab: string('Tab ID in source window.'),
        path: string('Absolute path of tab in source window.'),
        to: string('Destination live window ID.'),
        newWindow: boolean('Pop the tab out into a new window.'),
        tile: tilePreset,
        display: displaySelector,
        focus: boolean('Focus the destination window (default false).'),
      },
      ['from'],
    ),
    output: result({ from: string(), to: string(), tab: string(), path: string(), createdWindow: boolean(), bounds: boundsSchema }, ['bounds']),
    requires: ['running app', 'source window ID', 'tab or path', 'to or newWindow'],
  },
]

export const commandDefinition = (name: string): CommandDefinition => {
  const definition = AUTOMATION_COMMANDS.find(command => command.name === name)
  if (!definition) throw new AutomationFailure('UNKNOWN_COMMAND', `Unknown command: ${name}. Run capabilities --json.`)
  return definition
}
