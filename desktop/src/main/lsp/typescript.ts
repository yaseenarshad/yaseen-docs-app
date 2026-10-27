import path from 'node:path'
import type { ServerCommand } from './server'

/**
 * Where the TypeScript 7 language server is, and how to start it (YAZ-3453).
 *
 * TypeScript 7 is a native (Go) binary, one npm package for each platform:
 * `@typescript/typescript-<platform>-<arch>`, with the binary at `lib/tsc` (`lib/tsc.exe`) and the
 * `lib.*.d.ts` files beside it, which it reads. `tsc --lsp --stdio` is the language server over
 * stdio (`tsc --lsp --help` lists `-stdio`, `-pipe`, `-socket`).
 *
 * - Packaged: `tools/packDesktop.mjs` stages that `lib/` folder and electron-builder copies it to
 *   `Resources/lsp/typescript/` (`extraResources`; a binary cannot run from inside `app.asar`).
 * - Dev: the root `optionalDependencies` install the package of this Mac in `node_modules`.
 */

export const TYPESCRIPT_LSP_ARGS = ['--lsp', '--stdio'] as const

/** The npm package that holds the binary for one platform. */
export function typescriptPackage(platform: NodeJS.Platform, arch: string): string {
  return `@typescript/typescript-${platform}-${arch}`
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'tsc.exe' : 'tsc'
}

/**
 * The binary's path. Packaged: inside `resourcesPath`. Dev: the first `node_modules` copy from
 * `appPath` (the `desktop/` folder) upward that `exists`; null when there is none (an unsupported
 * platform, or `npm install --omit=optional`).
 */
export function resolveTypescriptServer(opts: {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  platform: NodeJS.Platform
  arch: string
  exists: (p: string) => boolean
}): string | null {
  const exe = binaryName(opts.platform)
  if (opts.isPackaged) {
    const bundled = path.join(opts.resourcesPath, 'lsp', 'typescript', exe)
    return opts.exists(bundled) ? bundled : null
  }
  const pkg = typescriptPackage(opts.platform, opts.arch)
  for (let dir = path.resolve(opts.appPath); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', ...pkg.split('/'), 'lib', exe)
    if (opts.exists(candidate)) return candidate
    if (path.dirname(dir) === dir) return null
  }
}

/** The command that starts the TypeScript helper with `projectRoot` as its working folder. */
export function typescriptServerCommand(binary: string, projectRoot: string): ServerCommand {
  return { name: 'typescript', command: binary, args: TYPESCRIPT_LSP_ARGS, cwd: projectRoot }
}
