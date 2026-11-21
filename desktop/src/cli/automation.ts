import { spawn } from 'node:child_process'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { AUTOMATION_LIMITS, AUTOMATION_VERSION, AutomationFailure, type AutomationRequest } from '@shared/automation'
import { AUTOMATION_COMMANDS, commandDefinition, validateInput, type CommandSchema } from '@shared/automationCommands'
import { makeRequest, sendRequest } from '../automation/client'
import { descriptorPath, privateDirectory, readConnection, type Connection } from '../automation/connection'
import { userDataDir } from '../main/userData'
import type { Io } from './cli'

export const AUTOMATION_HELP = `Navigation (the running app; it starts Docs when needed):
  yaseendocs open [--new-window] [--read-only] [--root <repo>] [--line <n>]
      [--sidebar files|favorites|focus] [--reveal true|false] [--view <name>]
      [--profile <absolute-path>] [--wait-ms <1..300000>] [--json] [<file[:line]> | <dir>]
  yaseendocs navigation open (--root <path> | --roots <JSON list> | --workspace <id or name> | --window <id>)
      [--path <path>] [--line <n>] [--read-only true|false] [--sidebar files|favorites|focus] [--reveal true|false]
      [--group <id or name>] [--view <name>] [--scope vault|workspace] [--mode reuse|new] [--allow-partial true]
  yaseendocs app status
  yaseendocs request status --id <request-id>
  yaseendocs capabilities --json
  yaseendocs <resource> <action> --help

Each input field is also a flag: --root <path>, --allow-partial true, and so on. --input <JSON | @file | -> gives
them as one JSON object. Unknown fields and flags fail before anything is sent.
--profile <absolute-path> selects an isolated app profile. --start starts Docs for a command other than navigation.
--wait-ms <1..300000> changes the wait, not the operation's lifetime.
--request <session/id/issuedAt> retries the exact same request, within five minutes.
A timeout is an unknown outcome: check the receipt with request status before you try again.

Example:
  # Open a file at line 42 in a transient read-only window without touching .yaseendocs/.
  yaseendocs open --read-only src/app.ts:42
  # Open the Skills vault in a new window on Favorites, with its Mochi folder revealed and its Cards view.
  yaseendocs navigation open --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi" --sidebar favorites --view Cards --mode new
`

export const OPEN_HELP = `usage:
  yaseendocs open [--new-window] [--read-only] [--root <repo>] [--line <n>]
      [--sidebar files|favorites|focus] [--reveal true|false] [--view <name>]
      [--profile <absolute-path>] [--wait-ms <1..300000>] [--request <session/id/issuedAt>] [--json]
      [<file[:line]> | <dir>]

Opens a file or folder in Yaseen Docs (starting Docs when needed).
  <file[:line]>  File to open; append :<line> to jump to a 1-based line number.
  <dir>          Directory to open as a vault (or a folder inside --root).
  --new-window   Always open a new window.
  --read-only    Open in transient read-only mode without writing .yaseendocs/.
  --root <repo>  Explicit vault/repo root (default: nearest .git or .yaseendocs ancestor, else file's directory).
  --line <n>     1-based line number to jump to in the target file.
  --sidebar      Sidebar list to show (files|favorites|focus).
  --reveal       Reveal target in the sidebar (true|false).
  --view <name>  Saved view of the target folder page.
  --request      Retry an earlier request reference (<session/id/issuedAt>), within five minutes.
`

const RESOURCES = new Set(['capabilities', 'navigation', 'app', 'request', 'open'])
export const isAutomationCommand = (argv: readonly string[]): boolean => RESOURCES.has(argv[0] ?? '')

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

/** `--input`: inline JSON, `@file`, or `-` for stdin, at most one control frame in size. */
async function inputText(value: string, io: Io): Promise<string> {
  const limit = AUTOMATION_LIMITS.controlBytes
  if (value.startsWith('@')) {
    const path = resolve(value.slice(1))
    if ((await stat(path)).size > limit) throw new AutomationFailure('TOO_LARGE', 'The input exceeds its byte limit.')
    value = await readFile(path, 'utf8')
  } else if (value === '-') value = await io.stdin()
  if (Buffer.byteLength(value) > limit) throw new AutomationFailure('TOO_LARGE', 'The input exceeds its byte limit.')
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

/** Chromium's single-instance socket in the profile (macOS, Linux): the app answers it from launch, before its CLI connection exists. */
const holdsLock = (profile: string) => new Promise<boolean>(resolve => {
  const socket = connect(join(profile, 'SingletonSocket'))
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})
/** Receipt inspection runs outside the four operation slots, so a busy app still answers it (YAZ-4529). */
const probe = (connection: Connection, waitMs: number) => sendRequest(connection, makeRequest(connection, 'request.status', { id: 'connection-probe' }), waitMs)

/**
 * A descriptor can survive a crash: probe before considering the app ready. Only an app that is absent (no descriptor,
 * or nothing listens) is started. A slow one is still running: a second launch would only meet the single-instance
 * lock and take the user's focus. An app that holds that lock is starting: wait for it.
 */
async function connectionFor(profile: string, start: boolean, waitMs: number): Promise<Connection> {
  try {
    const connection = await readConnection(profile)
    const answer = await probe(connection, waitMs)
    if (answer.ok) return connection
    // An app answered and refused this descriptor: it is running, and a launch would not replace it.
    throw new AutomationFailure(answer.error.code, answer.error.message)
  } catch (error) {
    if (!(error instanceof AutomationFailure)) throw error
    if (error.code === 'WAIT_TIMEOUT') throw new AutomationFailure('WAIT_TIMEOUT', 'Docs is running but did not answer within the wait. No operation was submitted.')
    if (error.code !== 'NOT_RUNNING') throw error
  }
  const starting = await holdsLock(profile)
  if (!starting && !start) throw new AutomationFailure('NOT_RUNNING', 'Docs is not running in this profile. Start it, or pass --start.')
  const lock = starting ? null : await startOnce(profile)
  try {
    const deadline = Date.now() + (starting ? waitMs : AUTOMATION_LIMITS.waitMs)
    do {
      await new Promise(done => setTimeout(done, 100))
      try {
        const connection = await readConnection(profile)
        if ((await probe(connection, 1000)).ok) return connection
      } catch { /* The app has not installed its connection yet. */ }
    } while (Date.now() < deadline)
  } finally { if (lock) await unlink(lock).catch(() => {}) }
  if (starting) throw new AutomationFailure('WAIT_TIMEOUT', 'Docs is running, but its CLI connection was not ready within the wait. No operation was submitted.')
  throw new AutomationFailure('START_TIMEOUT', 'Docs did not become ready. No operation was submitted.')
}

/** The lock's caller still runs (YAZ-4642): its pid answers signal 0. A lock with no readable pid counts as alive until it ages out. */
async function ownerAlive(lock: string): Promise<boolean> {
  const pid = Number((await readFile(lock, 'utf8').catch(() => '')).trim())
  if (!Number.isInteger(pid) || pid <= 0) return true
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

/**
 * One launch per profile (YAZ-4640): the caller that makes `cli/start.lock` starts Docs and answers the lock's path; the
 * callers that find it wait for the connection (null). A lock whose caller is gone (Ctrl-C, YAZ-4642), or older than two
 * start waits, is taken over.
 */
async function startOnce(profile: string): Promise<string | null> {
  const lock = join(dirname(descriptorPath(profile)), 'start.lock')
  await privateDirectory(dirname(lock))
  try { await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const age = Date.now() - await stat(lock).then(info => info.mtimeMs, () => 0)
    if (age < 2 * AUTOMATION_LIMITS.waitMs && await ownerAlive(lock)) return null
    await unlink(lock).catch(() => {})
    return startOnce(profile)
  }
  try {
    // The caller that held the lock before may have started Docs already.
    if (!(await holdsLock(profile))) await startApp(profile)
    return lock
  } catch (error) { await unlink(lock).catch(() => {}); throw error }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** Walk up from `startDir` looking for `.git` or `.yaseendocs`, falling back to `startDir`. */
async function detectRoot(startDir: string): Promise<string> {
  let dir = startDir
  while (true) {
    if (await exists(join(dir, '.git')) || await exists(join(dir, '.yaseendocs'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return startDir
    dir = parent
  }
}

async function parseOpenCommand(argv: readonly string[]): Promise<
  | { help: true }
  | { help: false; args: Record<string, unknown>; profile: string; waitMs: number; reference?: string }
> {
  const definition = commandDefinition('navigation.open')
  let profile = userDataDir(process.env, process.platform, homedir())
  let waitMs: number = AUTOMATION_LIMITS.waitMs
  let reference: string | undefined
  let newWindow = false
  let readOnly = false
  let rootFlag: string | undefined
  let lineFlag: number | undefined
  let sidebar: unknown
  let reveal: unknown
  let view: string | undefined
  let positional: string | undefined
  const seen = new Set<string>()
  let afterDoubleDash = false

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (!afterDoubleDash && arg === '--') { afterDoubleDash = true; continue }
    if (!afterDoubleDash && (arg === '--help' || arg === '-h')) return { help: true }
    if (!afterDoubleDash && arg.startsWith('--')) {
      if (seen.has(arg)) throw new AutomationFailure('INVALID_INPUT', `Repeated flag: ${arg}`)
      seen.add(arg)
      if (arg === '--json') continue
      if (arg === '--new-window') { newWindow = true; continue }
      if (arg === '--read-only') { readOnly = true; continue }
      if (i + 1 >= argv.length) throw new AutomationFailure('INVALID_INPUT', `Expected a flag and value: ${arg}`)
      const value = argv[++i]
      switch (arg) {
        case '--profile': profile = value; break
        case '--wait-ms': waitMs = Number(value); break
        case '--request': reference = value; break
        case '--root': rootFlag = resolve(value); break
        case '--line': {
          const parsed = Number(value)
          if (!Number.isInteger(parsed) || parsed < 1) throw new AutomationFailure('INVALID_INPUT', '--line must be a positive integer.')
          lineFlag = parsed
          break
        }
        case '--sidebar': sidebar = parsedValue(definition.input.properties!.sidebar, value, arg); break
        case '--reveal': reveal = parsedValue(definition.input.properties!.reveal, value, arg); break
        case '--view': view = value; break
        default: throw new AutomationFailure('INVALID_INPUT', `Unknown flag: ${arg}`)
      }
      continue
    }
    if (!afterDoubleDash && arg.startsWith('-')) throw new AutomationFailure('INVALID_INPUT', `Unknown flag: ${arg}`)
    if (positional !== undefined) throw new AutomationFailure('INVALID_INPUT', `Unexpected argument: ${arg}`)
    positional = arg
  }

  if (!isAbsolute(profile)) throw new AutomationFailure('INVALID_INPUT', '--profile must be an absolute path.')
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 300_000) throw new AutomationFailure('INVALID_INPUT', '--wait-ms must be between 1 and 300000.')

  let line = lineFlag
  let targetPath: string | undefined
  if (positional !== undefined) {
    let raw = positional
    const verbatim = resolve(raw)
    if (!(await exists(verbatim))) {
      const match = /^(.+):(\d+)$/.exec(raw)
      if (match) {
        const suffixLine = Number(match[2])
        if (!Number.isInteger(suffixLine) || suffixLine < 1) throw new AutomationFailure('INVALID_INPUT', 'Line number must be a positive integer.')
        if (lineFlag !== undefined) throw new AutomationFailure('INVALID_INPUT', 'Specify a line number with either :line or --line, not both.')
        raw = match[1]
        line = suffixLine
      }
    }
    targetPath = resolve(raw)
  }

  if (targetPath === undefined && rootFlag === undefined) {
    throw new AutomationFailure('INVALID_INPUT', 'Specify a file or folder to open. Run yaseendocs open --help.')
  }

  let root: string
  let path: string | undefined
  if (targetPath === undefined) {
    root = rootFlag!
    if (line !== undefined) throw new AutomationFailure('INVALID_INPUT', 'A line number needs a target file.')
  } else {
    const info = await stat(targetPath).catch(() => null)
    if (!info) throw new AutomationFailure('NOT_FOUND', `Target not found: ${targetPath}`)
    if (info.isDirectory()) {
      if (line !== undefined) throw new AutomationFailure('INVALID_INPUT', 'A line number needs a target file.')
      if (rootFlag !== undefined) {
        root = rootFlag
        if (targetPath !== root) path = targetPath
      } else {
        root = targetPath
      }
    } else if (info.isFile()) {
      path = targetPath
      root = rootFlag ?? await detectRoot(dirname(targetPath))
    } else {
      throw new AutomationFailure('INVALID_INPUT', `Target must be a file or directory: ${targetPath}`)
    }
  }

  const args: Record<string, unknown> = {
    root,
    ...(path !== undefined ? { path } : {}),
    mode: newWindow ? 'new' : 'reuse',
    ...(readOnly ? { readOnly: true } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(sidebar !== undefined ? { sidebar } : {}),
    ...(reveal !== undefined ? { reveal } : {}),
    ...(view !== undefined ? { view } : {}),
  }
  validateInput(definition.input, args)
  return { help: false, args, profile, waitMs, reference }
}

/** Exit 0 done · 1 refused or failed · 2 invalid usage. Results print as one JSON line on stdout; failures before sending on stderr. */
export async function runAutomation(argv: readonly string[], io: Io): Promise<number> {
  let request: AutomationRequest | undefined
  try {
    if (argv[0] === 'capabilities') {
      if (argv.slice(1).some(arg => !['--json', '--help', '-h'].includes(arg))) throw new AutomationFailure('INVALID_INPUT', 'capabilities accepts only --json or --help.')
      io.stdout(argv.includes('--help') || argv.includes('-h') ? AUTOMATION_HELP : `${JSON.stringify({ version: AUTOMATION_VERSION, limits: AUTOMATION_LIMITS, commands: AUTOMATION_COMMANDS }, null, 2)}\n`)
      return 0
    }
    if (argv[0] === 'open') {
      const parsed = await parseOpenCommand(argv)
      if (parsed.help) { io.stdout(OPEN_HELP); return 0 }
      const connected = Date.now()
      const connection = await connectionFor(parsed.profile, true, parsed.waitMs)
      request = makeRequest(connection, 'navigation.open', parsed.args)
      if (parsed.reference !== undefined) {
        const [session, id, issuedAt, extra] = parsed.reference.split('/')
        if (!session || !id || !issuedAt || extra !== undefined || !Number.isFinite(Number(issuedAt))) throw new AutomationFailure('INVALID_INPUT', 'Invalid request reference.')
        request = { ...request, session, id, issuedAt: Number(issuedAt) }
      }
      const result = await sendRequest(connection, request, Math.max(1, parsed.waitMs - (Date.now() - connected)))
      io.stdout(`${JSON.stringify({ ...result, request: `${request.session}/${request.id}/${request.issuedAt}` })}\n`)
      return result.ok ? 0 : 1
    }
    if (argv[1] === '--help' || argv[1] === '-h') { io.stdout(AUTOMATION_HELP); return 0 }
    if (argv[1] === undefined) throw new AutomationFailure('INVALID_INPUT', `Name an action: yaseendocs ${argv[0]} <action>. Run yaseendocs ${argv[0]} --help.`)
    const name = `${argv[0]}.${argv[1] ?? ''}`
    const definition = commandDefinition(name)
    const args: Record<string, unknown> = {}
    let profile = userDataDir(process.env, process.platform, homedir())
    // Only navigation starts Docs on its own (D1). Another command starts it only with --start.
    let start = definition.effect === 'navigate', waitMs: number = AUTOMATION_LIMITS.waitMs, input: string | undefined, reference: string | undefined
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
    if (input !== undefined) {
      const data: unknown = JSON.parse(await inputText(input, io))
      validateInput(definition.input, data)
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (Object.hasOwn(args, key)) throw new AutomationFailure('INVALID_INPUT', `Repeated input: ${key}`)
        args[key] = value
      }
    }
    validateInput(definition.input, args)
    const connected = Date.now()
    const connection = await connectionFor(profile, start, waitMs)
    request = makeRequest(connection, name, args)
    if (reference !== undefined) {
      const [session, id, issuedAt, extra] = reference.split('/')
      if (!session || !id || !issuedAt || extra !== undefined || !Number.isFinite(Number(issuedAt))) throw new AutomationFailure('INVALID_INPUT', 'Invalid request reference.')
      request = { ...request, session, id, issuedAt: Number(issuedAt) }
    }
    // The probe spends part of the caller's wait.
    const result = await sendRequest(connection, request, Math.max(1, waitMs - (Date.now() - connected)))
    io.stdout(`${JSON.stringify({ ...result, request: `${request.session}/${request.id}/${request.issuedAt}` })}\n`)
    return result.ok ? 0 : 1
  } catch (error) {
    const code = error instanceof AutomationFailure ? error.code : 'INVALID_INPUT'
    const message = error instanceof AutomationFailure ? error.message : 'Could not read the command input.'
    io.stderr(`${JSON.stringify({ ok: false, error: { code, message }, ...(request ? { request: `${request.session}/${request.id}/${request.issuedAt}` } : {}) })}\n`)
    return ['INVALID_INPUT', 'UNKNOWN_COMMAND'].includes(code) ? 2 : 1
  }
}
