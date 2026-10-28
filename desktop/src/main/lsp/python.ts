import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { LanguageSpec } from './pool'
import { helperFolder, PYRIGHT_ENTRY } from './download'
import { PYRIGHT_PIN } from './pins'
import { findProjectRoot, isInside } from './projectRoot'
import type { RequestHandler } from './rpc'
import { defaultServerReply } from './rpc'
import type { LanguageServer, ServerCommand } from './server'
import { onceFound, type LspPlaces } from './typescript'

/**
 * The Python helper (YAZ-3455 4C, D9): `pyright` (pinned in the root `devDependencies`), a Node
 * program, run on Electron's own Node — `process.execPath` with `ELECTRON_RUN_AS_NODE=1` — so no
 * Python and no Node install is needed to start it. Same launcher as TypeScript (`server.ts`).
 *
 * WHERE (YAZ-3500), as TypeScript: the downloaded copy `<userData>/lsp/pyright-<version>/`, the pinned
 * version only (`download.ts`); then, in a dev build and tests, `node_modules/pyright` from `appPath` (the
 * `desktop/` folder) upward. Else none.
 *
 * PROJECT: the nearest `pyproject.toml`, `setup.py` or `requirements.txt` above the file, else the
 * vault. LIBRARIES: a `.venv` or `venv` in the project gives pyright its `site-packages` folders, found
 * on disk, as `extraPaths`. pyright reads the simple `.pth` lines in each one itself (an editable install;
 * its `getPathsFromPthFiles` skips `#` and `import` lines, as Python does). An editable install that uses
 * an import hook instead (`import __editable___…_finder`) is not found: a known limit.
 *
 * THE PROJECT'S OWN PYTHON NEVER RUNS (YAZ-3480). A folder from someone else can hold a fake `python`,
 * and pyright RUNS the interpreter it is given (`pythonPath`) to ask for its version and its paths. VS
 * Code asks first (Workspace Trust); this app never asks and never runs it:
 *  - no `pythonPath` is passed: the libraries come from the folders above, read, never run;
 *  - with no `pythonPath`, pyright runs `python3` / `python` from `PATH`. So the `PATH` it gets has no
 *    folder inside the project (an activated venv), no relative or empty entry (that is the working
 *    folder, which is the project), and on macOS no `/usr/bin` (`pyrightPath`);
 *  - on Windows a program search looks in the working folder first. `NoDefaultCurrentDirectoryInExePath`
 *    turns that off (UNCONFIRMED: not tested on Windows).
 * A Python outside the project (Homebrew's, in a dev run) may still run: it is the user's own.
 */

export const PYTHON_PROJECT_MARKERS = ['pyproject.toml', 'setup.py', 'requirements.txt'] as const
const VENV_NAMES = ['.venv', 'venv'] as const

/** The pyright entry script; null when it is not there. */
export function resolvePyright(opts: { lspRoot: string; devCopies: boolean; appPath: string; exists: (p: string) => boolean }): string | null {
  const downloaded = path.join(helperFolder(opts.lspRoot, PYRIGHT_PIN), PYRIGHT_ENTRY)
  if (opts.exists(downloaded)) return downloaded
  if (!opts.devCopies) return null
  for (let dir = path.resolve(opts.appPath); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', 'pyright', PYRIGHT_ENTRY)
    if (opts.exists(candidate)) return candidate
    if (path.dirname(dir) === dir) return null
  }
}

/**
 * The PATH pyright sees. pyright runs `python3` / `python` from it to find libraries, so:
 *  - no folder inside `projectRoot` (an activated venv of the project: its `bin/python` is the project's);
 *  - no relative or empty entry: a program search reads it as the working folder, the project (YAZ-3480);
 *  - on macOS no `/usr/bin`: `/usr/bin/python3` is a stub when the Command Line Tools are not installed,
 *    and running it opens Apple's "install the tools" dialog. No dialog, ever.
 */
export function pyrightPath(envPath: string | undefined, platform: NodeJS.Platform = process.platform, projectRoot?: string): string | undefined {
  if (envPath === undefined) return envPath
  const paths = platform === 'win32' ? path.win32 : path.posix
  const root = projectRoot === undefined ? undefined : paths.resolve(projectRoot)
  return envPath
    .split(paths.delimiter)
    .filter((p) => p !== '' && paths.isAbsolute(p))
    .filter((p) => root === undefined || !isInsidePath(paths, paths.resolve(p), root))
    .filter((p) => platform !== 'darwin' || (p !== '/usr/bin' && p !== '/usr/bin/'))
    .join(paths.delimiter)
}

/** `p` is `root` or inside it (case-blind on Windows). */
function isInsidePath(paths: typeof path.posix, p: string, root: string): boolean {
  const fold = (x: string) => (paths === path.win32 ? x.toLowerCase() : x)
  const rel = paths.relative(fold(root), fold(p))
  return rel === '' || (!rel.startsWith('..') && !paths.isAbsolute(rel))
}

/** The command that starts pyright with `projectRoot` as its working folder, on the Node of `execPath`. */
export function pyrightServerCommand(entry: string, projectRoot: string, execPath: string = process.execPath, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ServerCommand {
  return {
    name: 'python',
    command: execPath,
    args: [entry, '--stdio'],
    cwd: projectRoot,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      PATH: pyrightPath(env.PATH, platform, projectRoot),
      // Windows: a program search never looks in the working folder (the project) first (YAZ-3480).
      ...(platform === 'win32' ? { NoDefaultCurrentDirectoryInExePath: '1' } : {}),
    },
  }
}

/** The project folder of a Python file: the nearest marker folder, else the vault (when the file is in it), else the file's folder. */
export function pythonProjectRoot(file: string, vaultRoot: string, exists: (p: string) => boolean = existsSync): string {
  return findProjectRoot(file, PYTHON_PROJECT_MARKERS, exists, [homedir()]) ?? (isInside(file, vaultRoot) ? path.resolve(vaultRoot) : path.dirname(path.resolve(file)))
}

export interface PythonEnv {
  /** The venv's `site-packages` folders: libraries pyright can read without running Python. */
  sitePackages: string[]
}

/** The `.venv` or `venv` of a project; null when there is none. Its Python is never named, never run (YAZ-3480). */
export function findVenv(projectRoot: string, exists: (p: string) => boolean = existsSync, list: (dir: string) => string[] = safeList): PythonEnv | null {
  for (const name of VENV_NAMES) {
    const venv = path.join(projectRoot, name)
    if (!exists(path.join(venv, 'pyvenv.cfg'))) continue
    const sitePackages: string[] = []
    // POSIX: lib/python3.X/site-packages. Windows: Lib/site-packages.
    for (const lib of ['lib', 'Lib']) {
      const libDir = path.join(venv, lib)
      if (exists(path.join(libDir, 'site-packages'))) sitePackages.push(path.join(libDir, 'site-packages'))
      for (const entry of list(libDir)) {
        if (/^python\d/.test(entry) && exists(path.join(libDir, entry, 'site-packages'))) sitePackages.push(path.join(libDir, entry, 'site-packages'))
      }
    }
    return { sitePackages: [...new Set(sitePackages)] }
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

/**
 * pyright's `python` settings for a project: the venv's library folders when there is one; the whole
 * workspace searched for imports. NEVER a `pythonPath` (YAZ-3480): pyright would run it.
 */
export function pythonSettings(env: PythonEnv | null): Record<string, unknown> {
  return {
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
export function pythonConfigurationReply(env: PythonEnv | null): RequestHandler {
  const settings = pythonSettings(env)
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
 * search before it misses every file that is not open. With 0 files (pyright skips dot folders,
 * `node_modules` and `__pycache__`) it logs `No source files found.` instead: that ends the wait too
 * (YAZ-3466; before, Shift+F12 waited the full `ms`).
 */
const WORKSPACE_LISTED = /^(?:Found \d+ source files?|No source files found)/m

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
      if (method === 'window/logMessage' && typeof message === 'string' && WORKSPACE_LISTED.test(message)) done()
    })
    void server.exited.then(done)
  })
}

/** pyright for Python files (YAZ-3455). */
export function pythonSpec(places: LspPlaces, exists: (p: string) => boolean = existsSync): LanguageSpec {
  const entry = onceFound(() => resolvePyright({ ...places, exists }))
  return {
    language: 'python',
    projectRoot: (file, vaultRoot) => pythonProjectRoot(file, vaultRoot, exists),
    command: (root) => {
      const script = entry()
      return script === null ? null : pyrightServerCommand(script, root)
    },
    startOptions: (root) => ({ onServerRequest: pythonConfigurationReply(findVenv(root, exists)) }),
    workspaceReady: (server) => pyrightWorkspaceReady(server),
    // `dist/typeshed-fallback` (the standard library's stubs) sits beside the entry.
    ownFolder: () => {
      const script = entry()
      return script === null ? null : path.dirname(script)
    },
  }
}
