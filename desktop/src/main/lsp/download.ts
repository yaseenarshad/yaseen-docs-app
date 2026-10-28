import { createHash } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import type { LspLanguage } from '@shared/lsp'
import type { LspInstallError, LspInstallProgress, LspInstallResult } from '@shared/lspInstall'
import { PYRIGHT_PIN, TYPESCRIPT_PINS } from './pins'
import { readTar } from './tar'

/**
 * THE HELPERS' DOWNLOAD (YAZ-3500; YAZ-3439 "Download the helpers on first switch-on, after a box that
 * explains"). The app ships no language helper. The first switch-on of Settings › Code › "Jump across
 * files" shows a box, and its "Download and turn on" calls `lsp.install`, which runs this. Electron-free:
 * `ipc/lsp.ts` passes in the folder and `fetch` (Electron's `net.fetch`, which takes the system proxy).
 *
 * WHAT. The pinned packages of this platform (`pins.ts`, made from the lockfile by `tools/lspPins.mjs`):
 * TypeScript 7 `@typescript/typescript-<platform>-<arch>` and `pyright`. The URL, the version and the sha512
 * come from that table only; the renderer names none of them, and no version is looked up.
 *
 * HOW, for each helper whose folder is missing:
 *  1. download the npm tarball into memory (about 10 MB and 5 MB), hashing it as it arrives;
 *  2. refuse it unless its sha512 is the pinned `integrity` ("The download did not match. Try again later.");
 *  3. gunzip it (`zlib`) and read the tar (`tar.ts`, no new dependency) into `<lspRoot>/.partial-XXXX/`,
 *     without the `*.map` files;
 *  4. rename that folder to `<lspRoot>/<name>-<version>/` (one disk, so the rename is atomic): a helper
 *     folder is whole or not there.
 * A failure, Cancel, or the quit (`cancel`, from the quit sequence) deletes the `.partial-` folder; a
 * `.partial-` folder that a killed app left is deleted at the next start (`sweep`). Folders of older
 * pinned versions go after a download that worked.
 */

export interface HelperPin {
  /** The npm package. */
  package: string
  version: string
  /** The npm registry tarball. */
  url: string
  /** The lockfile's `sha512-<base64>` of the tarball. */
  integrity: string
}

/** The TypeScript 7 binary's name in its package's `lib/`. */
export const tscBinary = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'tsc.exe' : 'tsc')
/** pyright's entry script, at its package's top. */
export const PYRIGHT_ENTRY = 'langserver.index.js'

export interface PlatformHelper {
  helper: LspLanguage
  pin: HelperPin
  /** The file that starts it, relative to its folder: `lib/tsc` (`lib\tsc.exe`), `langserver.index.js`. */
  entry: string
}

/** The folder name prefix of a download under way. */
export const PARTIAL = '.partial-'
/** A tarball bigger than this is no helper (the real ones are 10 MB and 5 MB). */
const MAX_BYTES = 200 * 1024 * 1024

export function typescriptPin(platform: NodeJS.Platform, arch: string): HelperPin | null {
  return TYPESCRIPT_PINS[`${platform}-${arch}`] ?? null
}

/** The helpers of a platform; null where TypeScript 7 has no pinned package (the app ships macOS and Windows). */
export function helpersFor(platform: NodeJS.Platform, arch: string): PlatformHelper[] | null {
  const ts = typescriptPin(platform, arch)
  if (ts === null) return null
  return [
    { helper: 'typescript', pin: ts, entry: path.join('lib', tscBinary(platform)) },
    { helper: 'python', pin: PYRIGHT_PIN, entry: PYRIGHT_ENTRY },
  ]
}

/** `<lspRoot>/<name>-<version>`: `typescript-darwin-arm64-7.0.2`, `pyright-1.1.414`. */
export function helperFolder(lspRoot: string, pin: HelperPin): string {
  return path.join(lspRoot, `${baseName(pin)}-${pin.version}`)
}

const baseName = (pin: HelperPin): string => pin.package.slice(pin.package.lastIndexOf('/') + 1)

class InstallFailure extends Error {
  constructor(
    readonly kind: LspInstallError,
    readonly detail?: string,
  ) {
    super(detail === undefined ? kind : `${kind}: ${detail}`)
  }
}

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * A path of the archive under the helper's folder: the top folder (`package/`) dropped. Null for the top
 * folder itself. A path that climbs out (`..`) or names a drive refuses the whole archive.
 */
export function safeRelative(archivePath: string): string | null {
  const parts = archivePath.split('/').filter((s) => s !== '' && s !== '.')
  if (parts.length < 2) return null
  const rest = parts.slice(1)
  if (rest.some((s) => s === '..' || s.includes('\\') || s.includes(':') || s.includes('\0'))) throw new InstallFailure('unpack', `unsafe path in the archive: ${archivePath}`)
  return path.join(...rest)
}

export type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>

export interface InstallerOptions {
  /** `<userData>/lsp`. */
  lspRoot: string
  /** `helpersFor(process.platform, process.arch)`. */
  helpers: PlatformHelper[] | null
  fetch: Fetch
  platform?: NodeJS.Platform
  log?: (message: string) => void
}

/** One download at a time; a second `install` joins the one under way. */
export class HelperInstaller {
  private running: { promise: Promise<LspInstallResult>; controller: AbortController } | null = null
  private readonly listeners = new Set<(p: LspInstallProgress) => void>()
  private readonly platform: NodeJS.Platform
  private readonly log: (message: string) => void

  constructor(private readonly opts: InstallerOptions) {
    this.platform = opts.platform ?? process.platform
    this.log = opts.log ?? ((message) => console.warn(`[lsp] ${message}`))
  }

  get installing(): boolean {
    return this.running !== null
  }

  /** The helpers whose downloaded folder is not there. */
  missing(exists: (p: string) => boolean = existsSync): PlatformHelper[] {
    return (this.opts.helpers ?? []).filter((h) => !exists(path.join(helperFolder(this.opts.lspRoot, h.pin), h.entry)))
  }

  /** Downloads every missing helper. Never rejects: a failure is `{ ok: false, error }`. */
  install(onProgress?: (p: LspInstallProgress) => void): Promise<LspInstallResult> {
    if (onProgress !== undefined) this.listeners.add(onProgress)
    if (this.running === null) {
      const controller = new AbortController()
      const promise = this.run(controller.signal).finally(() => {
        this.running = null
        this.listeners.clear()
      })
      this.running = { promise, controller }
    }
    return this.running.promise
  }

  /** Stops the download under way, and resolves once its `.partial-` folder is deleted. */
  async cancel(): Promise<void> {
    const running = this.running
    if (running === null) return
    running.controller.abort()
    await running.promise
  }

  /** Deletes the `.partial-` folders a killed app left. Not while a download runs. */
  sweep(): void {
    if (this.running === null) this.removePartials()
  }

  /** The quit, after `cancel` (or its time limit): every `.partial-` folder goes, even one a slow download still holds. */
  sweepAfterQuit(): void {
    this.removePartials()
  }

  private removePartials(): void {
    let names: string[]
    try {
      names = readdirSync(this.opts.lspRoot)
    } catch {
      return
    }
    for (const name of names) if (name.startsWith(PARTIAL)) rmSync(path.join(this.opts.lspRoot, name), { recursive: true, force: true })
  }

  private emit(p: LspInstallProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(p)
      } catch {
        // A window that went away: its progress goes nowhere.
      }
    }
  }

  private async run(signal: AbortSignal): Promise<LspInstallResult> {
    if (this.opts.helpers === null) return { ok: false, error: 'unsupported' }
    try {
      await mkdir(this.opts.lspRoot, { recursive: true })
      this.removePartials()
      const todo = this.missing()
      for (const [i, helper] of todo.entries()) await this.installOne(helper, i + 1, todo.length, signal)
      await this.removeOldVersions()
      return { ok: true }
    } catch (err) {
      const failure = signal.aborted ? new InstallFailure('cancelled') : err instanceof InstallFailure ? err : (err as NodeJS.ErrnoException)?.code !== undefined ? new InstallFailure('disk', (err as NodeJS.ErrnoException).code) : new InstallFailure('unpack', said(err))
      this.log(`helper download failed: ${failure.message}`)
      return failure.detail === undefined ? { ok: false, error: failure.kind } : { ok: false, error: failure.kind, detail: failure.detail }
    }
  }

  private async installOne(helper: PlatformHelper, index: number, count: number, signal: AbortSignal): Promise<void> {
    const work = await mkdtemp(path.join(this.opts.lspRoot, PARTIAL))
    try {
      const bytes = await this.download(helper, index, count, signal)
      this.emit({ helper: helper.helper, phase: 'unpack', received: bytes.length, total: bytes.length, index, count })
      let archive: Buffer
      try {
        archive = await promisify(gunzip)(bytes)
      } catch (err) {
        throw new InstallFailure('unpack', said(err))
      }
      let files: ReturnType<typeof readTar>
      try {
        files = readTar(archive)
      } catch (err) {
        throw new InstallFailure('unpack', said(err))
      }
      const out = path.join(work, 'package')
      const made = new Set<string>()
      for (const file of files) {
        if (signal.aborted) throw new InstallFailure('cancelled')
        const rel = safeRelative(file.path)
        if (rel === null || rel.endsWith('.map')) continue
        const to = path.join(out, rel)
        const dir = path.dirname(to)
        if (!made.has(dir)) {
          await mkdir(dir, { recursive: true })
          made.add(dir)
        }
        await writeFile(to, file.data, { mode: (file.mode & 0o111) !== 0 ? 0o755 : 0o644 })
      }
      const entry = path.join(out, helper.entry)
      if (!existsSync(entry)) throw new InstallFailure('unpack', `${helper.pin.package}@${helper.pin.version} has no ${helper.entry}`)
      if (helper.helper === 'typescript' && this.platform !== 'win32') await chmod(entry, 0o755)
      if (signal.aborted) throw new InstallFailure('cancelled')
      const final = helperFolder(this.opts.lspRoot, helper.pin)
      // A folder there has no entry (`missing` said so): nothing of it is worth keeping.
      await rm(final, { recursive: true, force: true })
      await rename(out, final)
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  /** The tarball's bytes, checked against the pin. */
  private async download(helper: PlatformHelper, index: number, count: number, signal: AbortSignal): Promise<Buffer> {
    const { pin } = helper
    let res: Response
    try {
      res = await this.opts.fetch(pin.url, { signal })
    } catch (err) {
      throw signal.aborted ? new InstallFailure('cancelled') : new InstallFailure('offline', said(err))
    }
    if (!res.ok || res.body === null) throw new InstallFailure('http', `HTTP ${res.status}`)
    const length = Number(res.headers.get('content-length'))
    const total = Number.isFinite(length) && length > 0 ? length : null
    const hash = createHash('sha512')
    const chunks: Buffer[] = []
    let received = 0
    let shown = -1
    this.emit({ helper: helper.helper, phase: 'download', received, total, index, count })
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        hash.update(chunk)
        chunks.push(chunk)
        received += chunk.length
        if (received > MAX_BYTES) throw new InstallFailure('http', 'the file is too big')
        // One event per whole percent (or per 512 KB with no size): never one per chunk.
        const step = total === null ? Math.floor(received / (512 * 1024)) : Math.floor((received * 100) / total)
        if (step !== shown) {
          shown = step
          this.emit({ helper: helper.helper, phase: 'download', received, total, index, count })
        }
      }
    } catch (err) {
      await reader.cancel().catch(() => undefined)
      if (err instanceof InstallFailure) throw err
      throw signal.aborted ? new InstallFailure('cancelled') : new InstallFailure('offline', said(err))
    }
    const actual = `sha512-${hash.digest('base64')}`
    if (actual !== pin.integrity) {
      this.log(`${pin.package}@${pin.version}: expected ${pin.integrity}, got ${actual}`)
      throw new InstallFailure('mismatch')
    }
    return Buffer.concat(chunks, received)
  }

  /** After a download that worked: the folders of other versions of the same helpers. */
  private async removeOldVersions(): Promise<void> {
    const keep = new Set((this.opts.helpers ?? []).map((h) => path.basename(helperFolder(this.opts.lspRoot, h.pin))))
    const prefixes = (this.opts.helpers ?? []).map((h) => `${baseName(h.pin)}-`)
    for (const name of await readdir(this.opts.lspRoot)) {
      if (keep.has(name)) continue
      if (prefixes.some((p) => name.startsWith(p) && /^\d/.test(name.slice(p.length)))) await rm(path.join(this.opts.lspRoot, name), { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
