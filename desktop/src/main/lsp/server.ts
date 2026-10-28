import { spawn, type ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { RpcConnection, type NotificationHandler, type RequestHandler } from './rpc'

/**
 * Starts one language server (LSP) as a child process of the main process and owns its life
 * (YAZ-3453, 4A of the code tab's jump-by-meaning, D9). A server is a command, its arguments
 * and a working folder, so the TypeScript helper (`typescript.ts`) and the Python one
 * (`pyright`, `python.ts`, which runs on Electron's own Node: `process.execPath` + `ELECTRON_RUN_AS_NODE=1`)
 * use the same code.
 *
 * `child_process.spawn`, not Electron's `utilityProcess`: `utilityProcess.fork` starts a Node
 * script, and the TypeScript 7 helper is a native binary. Talk is JSON-RPC over the child's
 * stdin and stdout (`rpc.ts`); stderr is kept, last 8 KB, for the error message of a failed start.
 *
 * The renderer reaches it through `ipc/lsp.ts` and the pool (`pool.ts`). Every started server is in one set, and
 * `stopAllLanguageServers` (the quit sequence) stops each one: `shutdown`, `exit`, then a kill.
 */

export interface ServerCommand {
  /** A short name for logs: `typescript`, `python`. */
  name: string
  command: string
  args: readonly string[]
  /** The working folder of the process: the project root. */
  cwd: string
  env?: NodeJS.ProcessEnv
}

export interface StartOptions {
  /** The workspace folder the server indexes (absolute path). */
  rootPath: string
  /** Merged over `DEFAULT_CLIENT_CAPABILITIES`. */
  capabilities?: Record<string, unknown>
  initializationOptions?: unknown
  /** How long `initialize` may take. Default 30 s. */
  initializeTimeoutMs?: number
  /** Answers the server's own requests (`workspace/configuration`) from the first message on; default `defaultServerReply`. */
  onServerRequest?: RequestHandler
}

/** What the app's client can do. UTF-16 positions: Monaco counts columns in UTF-16 code units, as LSP's default does. */
export const DEFAULT_CLIENT_CAPABILITIES: Record<string, unknown> = {
  general: { positionEncodings: ['utf-16'] },
  textDocument: {
    synchronization: { didSave: true, dynamicRegistration: false },
    definition: { linkSupport: true },
    references: {},
    publishDiagnostics: {},
  },
  workspace: { workspaceFolders: true, configuration: true },
  window: { workDoneProgress: false },
}

export interface ServerExit {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface LanguageServer {
  readonly name: string
  readonly pid: number
  /** The server's answer to `initialize`. */
  readonly capabilities: Record<string, unknown>
  /** Resolves when the process has ended, for any reason. */
  readonly exited: Promise<ServerExit>
  request<R = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<R>
  notify(method: string, params?: unknown): void
  onNotification(handler: NotificationHandler): () => void
  onRequest(handler: RequestHandler): void
  /** `shutdown` + `exit`, then a kill if the process is still there after `timeoutMs` (default 2 s). Idempotent. */
  stop(timeoutMs?: number): Promise<void>
  /** True once anyone called `stop`: the exit that follows is no crash, whatever its code (YAZ-3454). */
  readonly stopRequested: boolean
}

const running = new Set<LanguageServer>()

/** The servers that are up now (for the quit sequence and for tests). */
export function runningLanguageServers(): ReadonlySet<LanguageServer> {
  return running
}

/** Stops every running server at once. Never rejects. */
export async function stopAllLanguageServers(timeoutMs?: number): Promise<void> {
  await Promise.allSettled([...running].map((server) => server.stop(timeoutMs)))
}

export function fileUri(path: string): string {
  return pathToFileURL(path).href
}

/** Spawns the server, then runs `initialize` and `initialized`. Rejects (and leaves no process) when either step fails. */
export async function startLanguageServer(cmd: ServerCommand, options: StartOptions): Promise<LanguageServer> {
  const child = spawn(cmd.command, [...cmd.args], {
    cwd: cmd.cwd,
    env: cmd.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (text: string) => void (stderr = (stderr + text).slice(-8192)))

  const exited = new Promise<ServerExit>((resolve) => {
    // A failed spawn (ENOENT, EACCES) fires `error` and then `close`, or `error` alone.
    child.once('error', () => resolve({ code: null, signal: null }))
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const spawnError = new Promise<never>((_, reject) => child.once('error', (err) => reject(new Error(`${cmd.name}: could not start ${cmd.command}: ${err.message}`))))

  const connection = new RpcConnection(child.stdout!, child.stdin!)
  if (options.onServerRequest) connection.onRequest(options.onServerRequest)
  void exited.then((exit) => {
    connection.dispose(new Error(`${cmd.name} ended (code ${exit.code}, signal ${exit.signal})${stderr ? `: ${stderr.trim().slice(-500)}` : ''}`))
  })

  let stopping: Promise<void> | null = null
  const server: LanguageServer = {
    name: cmd.name,
    pid: child.pid ?? -1,
    capabilities: {},
    exited,
    request: (method, params, timeoutMs) => connection.request(method, params, timeoutMs),
    notify: (method, params) => connection.notify(method, params),
    onNotification: (handler) => connection.onNotification(handler),
    onRequest: (handler) => connection.onRequest(handler),
    stop: (timeoutMs = 2000) => (stopping ??= stopProcess(child, connection, exited, timeoutMs)),
    get stopRequested() {
      return stopping !== null
    },
  }
  running.add(server)
  void exited.then(() => running.delete(server))

  try {
    const rootUri = fileUri(options.rootPath)
    const init = connection.request<{ capabilities?: Record<string, unknown> }>(
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'Yaseen Docs' },
        rootUri,
        rootPath: options.rootPath,
        workspaceFolders: [{ uri: rootUri, name: options.rootPath.split(/[\\/]/).pop() || options.rootPath }],
        capabilities: { ...DEFAULT_CLIENT_CAPABILITIES, ...options.capabilities },
        initializationOptions: options.initializationOptions,
      },
      options.initializeTimeoutMs ?? 30_000,
    )
    // The loser of the race rejects later with no one waiting: mark both handled.
    init.catch(() => undefined)
    spawnError.catch(() => undefined)
    const result = await Promise.race([init, spawnError])
    ;(server as { capabilities: Record<string, unknown> }).capabilities = result?.capabilities ?? {}
    connection.notify('initialized', {})
    return server
  } catch (err) {
    await server.stop(500)
    throw err
  }
}

async function stopProcess(child: ChildProcess, connection: RpcConnection, exited: Promise<ServerExit>, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const deadline = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), timeoutMs).unref())
  // A polite stop first: the LSP pair. A server that does not answer `shutdown` still gets `exit`.
  await Promise.race([connection.request('shutdown', undefined, timeoutMs).catch(() => undefined), exited, deadline])
  connection.notify('exit')
  child.stdin?.end()
  if ((await Promise.race([exited, deadline])) === 'late') {
    // SIGKILL on macOS; on Windows `kill` is TerminateProcess whatever the signal.
    child.kill('SIGKILL')
    await exited
  }
}
