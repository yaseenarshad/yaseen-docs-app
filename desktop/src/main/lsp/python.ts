import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { LanguageSpec } from './pool'
import { findProjectRoot, isInside } from './projectRoot'
import type { RequestHandler } from './rpc'
import { defaultServerReply } from './rpc'
import type { LanguageServer, ServerCommand } from './server'

/**
 * The Python helper (YAZ-3455 4C, D9): `pyright` (pinned in the root `devDependencies`), a Node
 * program, run on Electron's own Node — `process.execPath` with `ELECTRON_RUN_AS_NODE=1` — so no
 * Python and no Node install is needed to start it. Same launcher as TypeScript (`server.ts`).
 *
 * - Packaged: `tools/packDesktop.mjs` stages the package into `desktop/.cache/lsp/pyright/` and
 *   electron-builder copies it to `Resources/lsp/pyright/` (`extraResources`, as TypeScript).
 * - Dev and tests: `node_modules/pyright`, from `appPath` (the `desktop/` folder) upward.
 *
 * PROJECT: the nearest `pyproject.toml`, `setup.py` or `requirements.txt` above the file, else the
 * vault. LIBRARIES: a `.venv` or `venv` in the project gives pyright both its interpreter and its
 * `site-packages` folders, found on disk, so library jumps work even when that Python cannot run.
 */

export const PYTHON_PROJECT_MARKERS = ['pyproject.toml', 'setup.py', 'requirements.txt'] as const
export const PYRIGHT_ENTRY = 'langserver.index.js'
const VENV_NAMES = ['.venv', 'venv'] as const

/** The pyright entry script; null when it is not there. */
export function resolvePyright(opts: { isPackaged: boolean; resourcesPath: string; appPath: string; exists: (p: string) => boolean }): string | null {
  if (opts.isPackaged) {
    const bundled = path.join(opts.resourcesPath, 'lsp', 'pyright', PYRIGHT_ENTRY)
    return opts.exists(bundled) ? bundled : null
  }
  for (let dir = path.resolve(opts.appPath); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', 'pyright', PYRIGHT_ENTRY)
    if (opts.exists(candidate)) return candidate
    if (path.dirname(dir) === dir) return null
  }
}

/**
 * The PATH pyright sees. On macOS `/usr/bin/python3` is a stub when the Command Line Tools are not
 * installed, and running it opens Apple's "install the tools" dialog. pyright runs `python3` to find
 * libraries when no `.venv` names one, so `/usr/bin` is left out: no dialog, ever.
 */
export function pyrightPath(envPath: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'darwin' || envPath === undefined) return envPath
  return envPath
    .split(':')
    .filter((p) => p !== '/usr/bin' && p !== '/usr/bin/')
    .join(':')
}

/** The command that starts pyright with `projectRoot` as its working folder, on the Node of `execPath`. */
export function pyrightServerCommand(entry: string, projectRoot: string, execPath: string = process.execPath, env: NodeJS.ProcessEnv = process.env): ServerCommand {
  return {
    name: 'python',
    command: execPath,
    args: [entry, '--stdio'],
    cwd: projectRoot,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', PATH: pyrightPath(env.PATH) },
  }
}

/** The project folder of a Python file: the nearest marker folder, else the vault (when the file is in it), else the file's folder. */
export function pythonProjectRoot(file: string, vaultRoot: string, exists: (p: string) => boolean = existsSync): string {
  return findProjectRoot(file, PYTHON_PROJECT_MARKERS, exists, [homedir()]) ?? (isInside(file, vaultRoot) ? path.resolve(vaultRoot) : path.dirname(path.resolve(file)))
}

export interface PythonEnv {
  /** The venv's interpreter, when the venv has one. */
  pythonPath?: string
  /** The venv's `site-packages` folders: libraries pyright can read without running Python. */
  sitePackages: string[]
}

/** The `.venv` or `venv` of a project; null when there is none. */
export function findVenv(projectRoot: string, exists: (p: string) => boolean = existsSync, list: (dir: string) => string[] = safeList): PythonEnv | null {
  for (const name of VENV_NAMES) {
    const venv = path.join(projectRoot, name)
    if (!exists(path.join(venv, 'pyvenv.cfg'))) continue
    const python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python')
    const sitePackages: string[] = []
    // POSIX: lib/python3.X/site-packages. Windows: Lib/site-packages.
    for (const lib of ['lib', 'Lib']) {
      const libDir = path.join(venv, lib)
      if (exists(path.join(libDir, 'site-packages'))) sitePackages.push(path.join(libDir, 'site-packages'))
      for (const entry of list(libDir)) {
        if (/^python\d/.test(entry) && exists(path.join(libDir, entry, 'site-packages'))) sitePackages.push(path.join(libDir, entry, 'site-packages'))
      }
    }
    return { ...(exists(python) ? { pythonPath: python } : {}), sitePackages: [...new Set(sitePackages)] }
  }
  return null
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** pyright's `python` settings for a project: the venv when there is one; the whole workspace searched for imports. */
export function pythonSettings(projectRoot: string, env: PythonEnv | null): Record<string, unknown> {
  return {
    ...(env?.pythonPath ? { pythonPath: env.pythonPath } : {}),
    analysis: {
      autoSearchPaths: true,
      useLibraryCodeForTypes: true,
      // Diagnostics only for the open files: the helper is here for jumps, and this keeps it quiet.
      diagnosticMode: 'openFilesOnly',
      extraPaths: env?.sitePackages ?? [],
    },
  }
}

/** The answer to pyright's `workspace/configuration`: `python` gets `pythonSettings`, every other section `null`. */
export function pythonConfigurationReply(projectRoot: string, env: PythonEnv | null): RequestHandler {
  const settings = pythonSettings(projectRoot, env)
  return (method, params) => {
    if (method !== 'workspace/configuration') return defaultServerReply(method, params)
    const items = (params as { items?: { section?: string }[] } | null)?.items
    return Array.isArray(items) ? items.map((item) => (item?.section === 'python' ? settings : item?.section === 'python.analysis' ? settings.analysis : null)) : []
  }
}

/** How long `references` waits for pyright's file list at most. */
export const WORKSPACE_READY_MS = 10_000

/**
 * Resolves when pyright logs `Found N source files` (it has the workspace's file list), when it
 * ends, or after `ms`. Measured: under Electron's Node this comes after the first answers, and a
 * search before it misses every file that is not open.
 */
export function pyrightWorkspaceReady(server: LanguageServer, ms = WORKSPACE_READY_MS): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      off()
      resolve()
    }
    const timer = setTimeout(done, ms)
    const off = server.onNotification((method, params) => {
      const message = (params as { message?: unknown } | null)?.message
      if (method === 'window/logMessage' && typeof message === 'string' && /^Found \d+ source files?/m.test(message)) done()
    })
    void server.exited.then(done)
  })
}

/** pyright for Python files (YAZ-3455). */
export function pythonSpec(places: { isPackaged: boolean; resourcesPath: string; appPath: string }, exists: (p: string) => boolean = existsSync): LanguageSpec {
  let entry: string | null | undefined
  return {
    language: 'python',
    projectRoot: (file, vaultRoot) => pythonProjectRoot(file, vaultRoot, exists),
    command: (root) => {
      entry ??= resolvePyright({ ...places, exists })
      return entry === null ? null : pyrightServerCommand(entry, root)
    },
    startOptions: (root) => ({ onServerRequest: pythonConfigurationReply(root, findVenv(root, exists)) }),
    workspaceReady: (server) => pyrightWorkspaceReady(server),
    // `dist/typeshed-fallback` (the standard library's stubs) sits beside the entry.
    ownFolder: () => {
      entry ??= resolvePyright({ ...places, exists })
      return entry === null ? null : path.dirname(entry)
    },
  }
}
