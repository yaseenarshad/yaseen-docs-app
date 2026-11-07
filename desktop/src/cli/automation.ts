import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'
import { AUTOMATION_LIMITS, AUTOMATION_VERSION, AutomationFailure, type AutomationRequest } from '@shared/automation'
import { AUTOMATION_COMMANDS, commandDefinition, validateInput, type CommandSchema } from '@shared/automationCommands'
import { makeRequest, sendRequest } from '../automation/client'
import { readConnection, type Connection } from '../automation/connection'
import { userDataDir } from '../main/userData'
import type { Io } from './cli'

export const AUTOMATION_HELP = `Programmatic control (the running app):
  yaseendocs capabilities --json
  yaseendocs <resource> <action> --help
  yaseendocs app status [--json]
  yaseendocs <resource> <action> [--input <JSON | @file | ->] [--body <text | @file | ->]
  yaseendocs request status --id <request-id>

Each named input field is also a flag: --window <id>, --root <path>, and so on.
Complex fields take JSON. Unknown fields and flags fail before execution.
--profile <absolute-path> selects an isolated app profile.
--start starts Docs if needed. Navigation starts it automatically.
--wait-ms <1..300000> changes the wait, not the operation's lifetime.
--request <session/id/issuedAt> retries the exact same request, within five minutes.
A timeout is an unknown outcome. Inspect the receipt or current state before another mutation.
The response includes its request reference. Large results are not kept in receipts.
Existing edit and delete commands still operate on comments.
`

export const isAutomationCommand = (argv: readonly string[]): boolean => argv[0] === 'capabilities' || AUTOMATION_COMMANDS.some(command => command.name.split('.')[0] === argv[0] && (argv[0] !== 'comment' || command.name === `${argv[0]}.${argv[1]}`))

function parsedValue(schema: CommandSchema, value: string): unknown {
  if (schema.type === 'string') return value
  try { return JSON.parse(value) } catch { throw new AutomationFailure('INVALID_INPUT', 'Expected JSON for this input field.') }
}

async function source(value: string, io: Io): Promise<string> {
  if (value === '-') return io.stdin()
  if (value.startsWith('@')) return readFile(resolve(value.slice(1)), 'utf8')
  return value
}

/** Launch this CLI's owning executable, never an app found by name or a user's shell command. */
async function startApp(profile: string): Promise<void> {
  const executable = process.env.YASEEN_DOCS_EXECUTABLE ?? process.execPath
  if (!isAbsolute(executable) || (!process.env.YASEEN_DOCS_EXECUTABLE && !/^(Yaseen Docs|Yaseen Docs\.exe|Electron|electron\.exe)$/.test(basename(executable)))) {
    throw new AutomationFailure('START_UNAVAILABLE', 'Start the dev app with this profile, or set YASEEN_DOCS_EXECUTABLE to its executable.')
  }
  const env: NodeJS.ProcessEnv = { ...process.env, YASEEN_DOCS_USER_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const entry = process.env.YASEEN_DOCS_APP_ENTRY
  if (/^Electron(?:\.exe)?$/i.test(basename(executable)) && !entry) {
    throw new AutomationFailure('START_UNAVAILABLE', 'Start the dev app with HMR first, or supply YASEEN_DOCS_APP_ENTRY.')
  }
  const child = spawn(executable, entry ? [entry] : [], { detached: true, stdio: 'ignore', env })
  await new Promise<void>((done, failed) => {
    child.once('spawn', done)
    child.once('error', () => failed(new AutomationFailure('START_FAILED', 'Docs could not start. Check that its executable exists and can run.')))
  })
  child.unref()
}

async function connectionFor(profile: string, start: boolean): Promise<Connection> {
  try {
    const connection = await readConnection(profile)
    // A descriptor can survive a crash. Probe before considering the app ready, without mutations.
    const result = await sendRequest(connection, makeRequest(connection, 'request.status', { id: 'connection-probe' }), Buffer.alloc(0), 1000)
    if (result.ok) return connection
  } catch (error) {
    if (error instanceof AutomationFailure && error.code === 'UNSAFE_PROFILE') throw error
  }
  if (!start) throw new AutomationFailure('NOT_RUNNING', 'Docs is not running in this profile. Start it, or pass --start.')
  await startApp(profile)
  const deadline = Date.now() + AUTOMATION_LIMITS.waitMs
  do {
    await new Promise(done => setTimeout(done, 100))
    try {
      const connection = await readConnection(profile)
      const result = await sendRequest(connection, makeRequest(connection, 'request.status', { id: 'connection-probe' }), Buffer.alloc(0), 1000)
      if (result.ok) return connection
    } catch { /* The app has not installed its connection yet. */ }
  } while (Date.now() < deadline)
  throw new AutomationFailure('START_TIMEOUT', 'Docs did not become ready. No operation was submitted.')
}

export async function runAutomation(argv: readonly string[], io: Io): Promise<number> {
  let request: AutomationRequest | undefined
  try {
    if (argv[0] === 'capabilities') {
      if (argv.slice(1).some(arg => !['--json', '--help', '-h'].includes(arg))) throw new AutomationFailure('INVALID_INPUT', 'capabilities accepts only --json or --help.')
      io.stdout(`${JSON.stringify({ version: AUTOMATION_VERSION, limits: AUTOMATION_LIMITS, commands: AUTOMATION_COMMANDS }, null, 2)}\n`)
      return 0
    }
    const name = `${argv[0]}.${argv[1] ?? ''}`
    const definition = commandDefinition(name)
    const args: Record<string, unknown> = {}
    let profile = userDataDir(process.env, process.platform, homedir())
    let start = definition.effect === 'navigate', waitMs: number = AUTOMATION_LIMITS.waitMs
    let input: string | undefined, body: string | undefined, reference: string | undefined
    const seen = new Set<string>()
    for (let i = 2; i < argv.length; i++) {
      const flag = argv[i]
      if (seen.has(flag)) throw new AutomationFailure('INVALID_INPUT', `Repeated flag: ${flag}`)
      seen.add(flag)
      if (flag === '--help' || flag === '-h') { io.stdout(`${AUTOMATION_HELP}\n${JSON.stringify(definition, null, 2)}\n`); return 0 }
      if (flag === '--json') continue
      if (flag === '--start') { start = true; continue }
      if (!flag.startsWith('--') || i + 1 >= argv.length) throw new AutomationFailure('INVALID_INPUT', `Expected a flag and value: ${flag}`)
      const value = argv[++i]
      switch (flag) {
        case '--profile': profile = value; break
        case '--wait-ms': waitMs = Number(value); break
        case '--request': reference = value; break
        case '--input': input = value; break
        case '--body': body = value; break
        default: {
          const key = flag.slice(2).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
          const schema = definition.input.properties?.[key]
          if (!schema) throw new AutomationFailure('INVALID_INPUT', `Unknown flag: ${flag}`)
          args[key] = parsedValue(schema, value)
        }
      }
    }
    if (!isAbsolute(profile)) throw new AutomationFailure('INVALID_INPUT', '--profile must be an absolute path.')
    if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 300_000) throw new AutomationFailure('INVALID_INPUT', '--wait-ms must be between 1 and 300000.')
    if (input === '-' && body === '-') throw new AutomationFailure('INVALID_INPUT', 'Only one input can read stdin.')
    if (input !== undefined) {
      const data: unknown = JSON.parse(await source(input, io))
      validateInput(definition.input, data)
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (Object.hasOwn(args, key)) throw new AutomationFailure('INVALID_INPUT', `Repeated input: ${key}`)
        args[key] = value
      }
    }
    validateInput(definition.input, args)
    if (body === undefined && definition.contentRequired) throw new AutomationFailure('INVALID_INPUT', 'This command requires --body, including an empty string for an empty document.')
    if (body !== undefined && !definition.content) throw new AutomationFailure('INVALID_INPUT', 'This command accepts no body.')
    if (definition.content === 'secret' && body !== '-' && !body?.startsWith('@')) throw new AutomationFailure('INVALID_INPUT', 'Supply secrets through stdin or a private file.')
    const content = Buffer.from(body === undefined ? '' : await source(body, io))
    if (content.length > AUTOMATION_LIMITS.contentBytes) throw new AutomationFailure('TOO_LARGE', 'The body is too large.')
    const connection = await connectionFor(profile, start)
    request = makeRequest(connection, name, args)
    if (reference !== undefined) {
      const [session, id, issuedAt, extra] = reference.split('/')
      if (!session || !id || !issuedAt || extra !== undefined || !Number.isFinite(Number(issuedAt))) throw new AutomationFailure('INVALID_INPUT', 'Invalid request reference.')
      request = { ...request, session, id, issuedAt: Number(issuedAt) }
    }
    const result = await sendRequest(connection, request, content, waitMs)
    const ref = `${request.session}/${request.id}/${request.issuedAt}`
    io.stdout(`${JSON.stringify({ ...result, request: ref })}\n`)
    return result.ok ? 0 : 1
  } catch (error) {
    const code = error instanceof AutomationFailure ? error.code : 'INVALID_INPUT'
    const message = error instanceof AutomationFailure ? error.message : 'Could not read the command input.'
    io.stderr(`${JSON.stringify({ ok: false, error: { code, message }, ...(request ? { request: `${request.session}/${request.id}/${request.issuedAt}` } : {}) })}\n`)
    return ['INVALID_INPUT', 'UNKNOWN_COMMAND'].includes(code) ? 2 : 1
  }
}
