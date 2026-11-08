import { commandInput } from './input'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { AUTOMATION_LIMITS, AUTOMATION_VERSION, AutomationFailure, publicCode, type AutomationRequest } from '@shared/automation'
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

Examples:
  # Open a vault in a new window on Favorites, with a folder revealed and expanded.
  yaseendocs navigation open --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi" --sidebar favorites --reveal true --mode new
  # Open a saved multi-vault workspace.
  yaseendocs navigation open --workspace "All Folders" --mode new
  # Search one collection and get paths back, without looking at the screen.
  yaseendocs search query --root "/Vaults/Skills" --collection favorites --scope vault --query mochi
  # Read a note with its revision, then replace it only if nobody changed it since.
  yaseendocs file read --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi/Cards.md"
  yaseendocs file write --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi/Cards.md" --revision <revision> --body @new.md
  # Make a reusable link to the same view.
  yaseendocs navigation link --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi" --sidebar favorites --reveal true
`

export const isAutomationCommand = (argv: readonly string[]): boolean => argv[0] === 'capabilities' || AUTOMATION_COMMANDS.some(command => command.name.split('.')[0] === argv[0] && (!['comment', 'daily'].includes(argv[0]) || command.name === `${argv[0]}.${argv[1]}`))

/**
 * A flag's text as its field's value. Text fields take the text as it is. A text-or-null field takes `null` as null and
 * any other text as it is (a quoted JSON string also works). Other fields take JSON, and a field that also allows text
 * falls back to the text.
 */
export function parsedValue(schema: CommandSchema, value: string, flag: string): unknown {
  const types = typeof schema.type === 'string' ? [schema.type] : schema.type
  if (types.length === 1 && types[0] === 'string') return value
  const textOrNull = types.every(type => type === 'string' || type === 'null')
  if (textOrNull && value === 'null' && types.includes('null')) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!textOrNull || typeof parsed === 'string') return parsed
  } catch { /* Not JSON: text below, where the field allows it. */ }
  if (types.includes('string')) return value
  throw new AutomationFailure('INVALID_INPUT', `${flag} expects JSON (${types.join(' or ')}).`)
}

/** Launch this CLI's owning executable, never an app found by name or a user's shell command. */
async function startApp(profile: string): Promise<void> {
  const executable = process.env.YASEEN_DOCS_EXECUTABLE ?? process.execPath
  if (!isAbsolute(executable) || (!process.env.YASEEN_DOCS_EXECUTABLE && !/^(Yaseen Docs|Yaseen Docs\.exe|Electron|electron\.exe)$/.test(basename(executable)))) {
    throw new AutomationFailure('START_FAILED', 'Start the dev app with this profile, or set YASEEN_DOCS_EXECUTABLE to its executable.')
  }
  const env: NodeJS.ProcessEnv = { ...process.env, YASEEN_DOCS_USER_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const entry = process.env.YASEEN_DOCS_APP_ENTRY
  if (/^Electron(?:\.exe)?$/i.test(basename(executable)) && !entry) {
    throw new AutomationFailure('START_FAILED', 'Start the dev app with HMR first, or supply YASEEN_DOCS_APP_ENTRY.')
  }
  const child = spawn(executable, entry ? [entry] : [], { detached: true, stdio: 'ignore', env })
  await new Promise<void>((done, failed) => {
    child.once('spawn', done)
    child.once('error', () => failed(new AutomationFailure('START_FAILED', 'Docs could not start. Check that its executable exists and can run.')))
  })
  child.unref()
}

/** Chromium's single-instance socket in the profile (macOS, Linux): the app answers it from launch, before its CLI connection exists. */
const holdsLock = (profile: string) => new Promise<boolean>(resolve => {
  const socket = connect(join(profile, 'SingletonSocket'))
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})
const probe = (connection: Connection, waitMs: number) => sendRequest(connection, makeRequest(connection, 'request.status', { id: 'connection-probe' }), Buffer.alloc(0), waitMs)

/**
 * A descriptor can survive a crash: probe before considering the app ready, without mutations. Only an app that is
 * absent (no descriptor, or nothing listens) is started. A slow one is still running: a second launch would only meet
 * the single-instance lock and take the user's focus (YAZ-4527 P4). An app that holds that lock is starting: wait for it.
 */
async function connectionFor(profile: string, start: boolean, waitMs: number): Promise<Connection> {
  try {
    const connection = await readConnection(profile)
    const answer = await probe(connection, waitMs)
    if (answer.ok) return connection
    // An app answered and refused this descriptor: it is running, and a launch would not replace it.
    throw new AutomationFailure(publicCode(answer.error.code), answer.error.message)
  } catch (error) {
    if (!(error instanceof AutomationFailure)) throw error
    if (error.code === 'WAIT_TIMEOUT') throw new AutomationFailure('WAIT_TIMEOUT', 'Docs is running but did not answer within the wait. No operation was submitted.')
    if (error.code !== 'NOT_RUNNING') throw error
  }
  const starting = await holdsLock(profile)
  if (!starting && !start) throw new AutomationFailure('NOT_RUNNING', 'Docs is not running in this profile. Start it, or pass --start.')
  if (!starting) await startApp(profile)
  const deadline = Date.now() + (starting ? waitMs : AUTOMATION_LIMITS.waitMs)
  do {
    await new Promise(done => setTimeout(done, 100))
    try {
      const connection = await readConnection(profile)
      if ((await probe(connection, 1000)).ok) return connection
    } catch { /* The app has not installed its connection yet. */ }
  } while (Date.now() < deadline)
  if (starting) throw new AutomationFailure('WAIT_TIMEOUT', 'Docs is running, but its CLI connection was not ready within the wait. No operation was submitted.')
  throw new AutomationFailure('START_FAILED', 'Docs did not become ready. No operation was submitted.')
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
    // Navigation starts Docs (D1). A command that names a live window or tab cannot have one in a closed app, so it does not.
    let start = definition.effect === 'navigate' && !definition.input.required?.some(field => field === 'window' || field === 'tab'), waitMs: number = AUTOMATION_LIMITS.waitMs
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
          args[key] = parsedValue(schema, value, flag)
        }
      }
    }
    if (!isAbsolute(profile)) throw new AutomationFailure('INVALID_INPUT', '--profile must be an absolute path.')
    if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 300_000) throw new AutomationFailure('INVALID_INPUT', '--wait-ms must be between 1 and 300000.')
    if (input === '-' && body === '-') throw new AutomationFailure('INVALID_INPUT', 'Only one input can read stdin.')
    if (input !== undefined) {
      const data: unknown = JSON.parse((await commandInput(input, io, AUTOMATION_LIMITS.controlBytes)).toString('utf8'))
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
    const content = body === undefined ? Buffer.alloc(0) : await commandInput(body, io, definition.content === 'secret' ? AUTOMATION_LIMITS.controlBytes : AUTOMATION_LIMITS.contentBytes, definition.content === 'secret')
    if (content.length > AUTOMATION_LIMITS.contentBytes) throw new AutomationFailure('TOO_LARGE', 'The body is too large.')
    const connected = Date.now()
    const connection = await connectionFor(profile, start, waitMs)
    request = { ...makeRequest(connection, name, args), hasContent: body !== undefined }
    if (reference !== undefined) {
      const [session, id, issuedAt, extra] = reference.split('/')
      if (!session || !id || !issuedAt || extra !== undefined || !Number.isFinite(Number(issuedAt))) throw new AutomationFailure('INVALID_INPUT', 'Invalid request reference.')
      request = { ...request, session, id, issuedAt: Number(issuedAt) }
    }
    // The probe spends part of the caller's wait.
    const result = await sendRequest(connection, request, content, Math.max(1, waitMs - (Date.now() - connected)))
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
