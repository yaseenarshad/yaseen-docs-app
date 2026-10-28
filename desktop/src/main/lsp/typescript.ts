import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { LanguageSpec } from './pool'
import { helperFolder, tscBinary, typescriptPin } from './download'
import { findProjectRoot, isInside } from './projectRoot'
import type { ServerCommand } from './server'

/**
 * Where the TypeScript 7 language server is, and how to start it (YAZ-3453).
 *
 * TypeScript 7 is a native (Go) binary, one npm package for each platform:
 * `@typescript/typescript-<platform>-<arch>`, with the binary at `lib/tsc` (`lib/tsc.exe`) and the
 * `lib.*.d.ts` files beside it, which it reads. `tsc --lsp --stdio` is the language server over
 * stdio (`tsc --lsp --help` lists `-stdio`, `-pipe`, `-socket`).
 *
 * WHERE (YAZ-3500): the app ships no helper. First the downloaded copy (`download.ts`):
 * `<userData>/lsp/typescript-<platform>-<arch>-<version>/lib/tsc`, the pinned version only. Then, in a dev
 * build, the `node_modules` copy (the root `optionalDependencies` install the package of this Mac). Else none.
 */

export const TYPESCRIPT_LSP_ARGS = ['--lsp', '--stdio'] as const

/** The npm package that holds the binary for one platform. */
export function typescriptPackage(platform: NodeJS.Platform, arch: string): string {
  return `@typescript/typescript-${platform}-${arch}`
}

/**
 * The binary's path: the downloaded copy of the pinned version under `lspRoot`, else (`devCopies`, a dev
 * build) the first `node_modules` copy from `appPath` (the `desktop/` folder) upward that `exists`; null when
 * there is none (not downloaded yet, an unsupported platform, `npm install --omit=optional`).
 */
export function resolveTypescriptServer(opts: {
  lspRoot: string
  devCopies: boolean
  appPath: string
  platform: NodeJS.Platform
  arch: string
  exists: (p: string) => boolean
}): string | null {
  const exe = tscBinary(opts.platform)
  const pin = typescriptPin(opts.platform, opts.arch)
  if (pin !== null) {
    const downloaded = path.join(helperFolder(opts.lspRoot, pin), 'lib', exe)
    if (opts.exists(downloaded)) return downloaded
  }
  if (!opts.devCopies) return null
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

/** The files that make a folder a TS or JS project (YAZ-3454): the nearest one above the file wins. */
export const TYPESCRIPT_PROJECT_MARKERS = ['tsconfig.json', 'jsconfig.json', 'package.json'] as const

/** Where the helpers are (YAZ-3500): the downloaded copies, and a dev build's `node_modules` copies. */
export interface LspPlaces {
  /** `<userData>/lsp`: the downloaded helpers (`download.ts`). */
  lspRoot: string
  /** Also the `node_modules` copies: a dev build, unless `YASEEN_DOCS_LSP_DOWNLOAD_ONLY=1`. Never packaged. */
  devCopies: boolean
  /** `app.getAppPath()`: the `desktop/` folder in dev. */
  appPath: string
}

/** A memo of one lookup on disk that found a helper: it does not move while the app runs. A miss is asked again (a download may come). */
export function onceFound<T>(fn: () => T | null): () => T | null {
  let value: T | null = null
  return () => (value ??= fn())
}

/**
 * TypeScript 7 for TS, JS and React (YAZ-3454): the project is the nearest `tsconfig.json`, `jsconfig.json` or
 * `package.json`, in the vault (YAZ-3458: a marker above the vault would start a helper over that whole folder);
 * none = no helper (S7).
 */
export function typescriptSpec(places: LspPlaces, exists: (p: string) => boolean = existsSync): LanguageSpec {
  const binary = onceFound(() => resolveTypescriptServer({ ...places, platform: process.platform, arch: process.arch, exists }))
  return {
    language: 'typescript',
    projectRoot: (file, vaultRoot) => findProjectRoot(file, TYPESCRIPT_PROJECT_MARKERS, exists, [homedir()], isInside(file, vaultRoot) ? vaultRoot : undefined),
    command: (root) => {
      const bin = binary()
      return bin === null ? null : typescriptServerCommand(bin, root)
    },
    // `lib.*.d.ts` sit beside the binary.
    ownFolder: () => {
      const bin = binary()
      return bin === null ? null : path.dirname(bin)
    },
  }
}
