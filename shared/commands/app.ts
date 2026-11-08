import { array, boolean, integer, largeText, literal, nullable, number, object, oneOf, open, result, string, type CommandDefinition, type CommandSchema } from './schema'

const sizeCount = result({ bytes: number, count: integer })
const memoryState: CommandSchema = { type: ['string', 'null'], enum: ['shown', 'awake', 'unsaved', 'unloaded', 'asleep', null] }
const memoryReport = result({
  windows: array(result({ id: string(), title: string(), open: string(), bytes: number, jsHeapBytes: nullable(number), grew: boolean, tabs: array(result({ path: string(), title: nullable(string()), state: memoryState, lastSeen: nullable(number), sleepsAt: nullable(number), changed: nullable(number) })) })),
  core: result({ bytes: number, main: number, gpu: number, utility: number, other: number }), helpers: nullable(sizeCount),
})
const restartResult = result({ accepted: boolean, outcome: literal('restart-requested'), receiptsExpireOnRestart: literal(true), manual: literal(true), url: string('The release page to install from by hand.') },
    ['outcome', 'receiptsExpireOnRestart', 'manual', 'url'])
const updateState = result({ kind: oneOf('idle', 'downloading', 'ready', 'manual'), failed: string(), version: string() }, ['failed', 'version'])
const helperState = result({ ready: boolean, installing: boolean })
const anyJson = { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], additionalProperties: true,
    description: 'The original command’s value. Its schema is that command’s output.' } as CommandSchema
const command = (name: string, description: string, effect: CommandDefinition['effect'], output: CommandSchema, input = object({}), requires: readonly string[] = ['running app']): CommandDefinition =>
  ({ name, description, effect, input, output, requires })

export const appCommands: CommandDefinition[] = [
  command('app.status', 'Read this running Docs instance: its version, profile, and automation protocol version. A dev run reports the Electron version as version.', 'read',
    object({ version: string('The app version; a dev run reports Electron’s.'), automation: { ...integer, description: 'The automation protocol version, as in capabilities.' }, packaged: boolean, profile: string(), running: boolean },
        ['version', 'automation', 'packaged', 'profile', 'running'])),
  command('app.diagnostics', 'Read the platform and the memory use of the app’s windows and processes, as the memory report shows them. No secret is read.', 'read',
      result({ platform: string(), architecture: string(), version: string(), packaged: boolean, memory: nullable(memoryReport) })),
  command('app.restart', 'Save every window and start this app again with the same profile. It does not install an update. Request receipts end with the restart.', 'write', restartResult),
  command('update.state', 'Read the updater’s state: idle, downloading, ready to install, or manual.', 'read', updateState),
  command('update.notes', 'Read the release notes of this version and the newer ones.', 'read',
      result({ current: string(), checks: { ...boolean, description: 'False in a dev run with no update feed.' }, releases: array(result({ version: string(), title: string(), date: string(), body: largeText })) })),
  command('update.check', 'Check for an update now, as the app’s menu does. A dev run has no update feed and only reads the state.', 'remote', updateState),
  command('update.restart', 'Install the update that is ready and restart, or return the release page when the update must be installed by hand. Refused when no update is ready.', 'write',
      restartResult),
  command('languageHelper.state', 'Say whether the code language helpers are installed, or installing now.', 'read', helperState),
  command('languageHelper.install', 'Install the app’s own code language helpers, as Settings does. The app chooses the version and source; a caller cannot. languageHelper.cancel stops it.', 'remote',
    result({ ok: boolean, error: oneOf('offline', 'http', 'mismatch', 'unpack', 'disk', 'unsupported', 'cancelled'), detail: string() }, ['error', 'detail'])),
  command('languageHelper.cancel', 'Stop a language-helper install that is running.', 'write', helperState),
  command('request.status', 'Read the receipt of an earlier request: queued, running, completed with its result, or unknown. Unknown is not proof that a write failed.', 'read',
    object({ id: string(), state: oneOf('queued', 'running', 'completed', 'unknown'), resultRetained: boolean, result: result({ ok: boolean, value: anyJson, error: result({ code: string(), message: string(), details: open('Facts about the failure; each error code has its own.') }, ['details']) }, ['value', 'error']) },
        ['id', 'state']),
    object({ id: string() }, ['id']), ['same app session']),
]
