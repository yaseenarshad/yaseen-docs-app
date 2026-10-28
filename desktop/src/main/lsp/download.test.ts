import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { installErrorText, type LspInstallProgress } from '@shared/lspInstall'
import { HelperInstaller, PARTIAL, helperFolder, helpersFor, safeRelative, type PlatformHelper } from './download'
import { PYRIGHT_PIN, TYPESCRIPT_PINS } from './pins'
import { resolvePyright } from './python'
import { readTar } from './tar'
import { resolveTypescriptServer } from './typescript'

/**
 * The helpers' download (YAZ-3500) against a FAKE npm registry: a local HTTP server in this test, never the
 * network. Real tarballs made by the system `tar` (bsdtar on macOS: pax headers for the long path).
 * Success; a hash mismatch; offline; the quit in the middle of a download; the second switch-on (no
 * download); a 404; two calls at once; the leftovers of a killed app.
 */

const sha512 = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const LONG = `dist/typeshed-fallback/stdlib/${'deep/'.repeat(18)}module.pyi`

/** An npm tarball (`package/…`) holding `files`, as bytes. */
function tarball(files: Record<string, string>, exec: string[] = []): Buffer {
  const src = mkdtempSync(path.join(tmpdir(), 'yaz-3500-tgz-'))
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(src, 'package', rel)), { recursive: true })
      writeFileSync(path.join(src, 'package', rel), text, { mode: exec.includes(rel) ? 0o755 : 0o644 })
    }
    // COPYFILE_DISABLE: no `._` AppleDouble files from bsdtar.
    execFileSync('tar', ['-czf', path.join(src, 'p.tgz'), '-C', src, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    return readFileSync(path.join(src, 'p.tgz'))
  } finally {
    rmSync(src, { recursive: true, force: true })
  }
}

const TS_TGZ = tarball({ 'package.json': '{"version":"7.0.2"}', 'lib/tsc': '#!/bin/sh\necho tsc\n', 'lib/lib.es5.d.ts': 'declare var NaN: number', LICENSE: 'Apache-2.0' }, ['lib/tsc'])
const PY_TGZ = tarball({ 'package.json': '{"version":"1.1.414"}', 'langserver.index.js': "require('./dist/pyright-langserver')", 'dist/pyright-langserver.js': '// server', 'dist/pyright-langserver.js.map': '{}', [LONG]: 'def f(): ...' })

/** The fake registry: each path answers its bytes; `stall` sends half and then nothing. */
let server: Server
let base = ''
const routes = new Map<string, { bytes: Buffer; status?: number; stall?: boolean }>()
const requests: string[] = []
const stalled: ServerResponse[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? '')
    const route = routes.get(req.url ?? '')
    if (route === undefined || (route.status ?? 200) !== 200) {
      res.writeHead(route?.status ?? 404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-length': String(route.bytes.length), 'content-type': 'application/octet-stream' })
    if (route.stall) {
      res.write(route.bytes.subarray(0, route.bytes.length >> 1))
      stalled.push(res)
      return
    }
    res.end(route.bytes)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const res of stalled) res.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

let lspRoot = ''
beforeEach(() => {
  lspRoot = path.join(mkdtempSync(path.join(tmpdir(), 'yaz-3500-userdata-')), 'lsp')
  routes.clear()
  requests.length = 0
  routes.set('/ts.tgz', { bytes: TS_TGZ })
  routes.set('/py.tgz', { bytes: PY_TGZ })
})
afterEach(() => rmSync(path.dirname(lspRoot), { recursive: true, force: true }))

/** The helpers of darwin-arm64, pointed at the fake registry with the fixtures' own sha512. */
function fakeHelpers(over: { ts?: Partial<PlatformHelper['pin']>; py?: Partial<PlatformHelper['pin']> } = {}): PlatformHelper[] {
  const [ts, py] = helpersFor('darwin', 'arm64')!
  return [
    { ...ts, pin: { ...ts.pin, url: `${base}/ts.tgz`, integrity: sha512(TS_TGZ), ...over.ts } },
    { ...py, pin: { ...py.pin, url: `${base}/py.tgz`, integrity: sha512(PY_TGZ), ...over.py } },
  ]
}

const installer = (helpers: PlatformHelper[] | null = fakeHelpers()) => new HelperInstaller({ lspRoot, helpers, platform: 'darwin', fetch: (url, init) => fetch(url, init), log: () => undefined })
const leftovers = () => (existsSync(lspRoot) ? readdirSync(lspRoot).filter((n) => n.startsWith(PARTIAL)) : [])

describe('the pinned table (YAZ-3500)', () => {
  it('pins TypeScript 7 for each shipped platform and pyright, on the npm registry, by sha512', () => {
    expect(Object.keys(TYPESCRIPT_PINS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64'])
    for (const pin of [...Object.values(TYPESCRIPT_PINS), PYRIGHT_PIN]) {
      expect(pin.url.startsWith('https://registry.npmjs.org/')).toBe(true)
      expect(pin.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/)
    }
    expect(helpersFor('darwin', 'arm64')!.map((h) => [h.helper, h.pin.package, h.entry])).toEqual([
      ['typescript', '@typescript/typescript-darwin-arm64', path.join('lib', 'tsc')],
      ['python', 'pyright', 'langserver.index.js'],
    ])
    expect(helpersFor('win32', 'x64')![0].entry).toBe(path.join('lib', 'tsc.exe'))
    expect(helpersFor('linux', 'x64')).toBeNull()
    expect(helperFolder('/u/lsp', TYPESCRIPT_PINS['darwin-arm64'])).toBe(path.join('/u/lsp', `typescript-darwin-arm64-${TYPESCRIPT_PINS['darwin-arm64'].version}`))
    expect(helperFolder('/u/lsp', PYRIGHT_PIN)).toBe(path.join('/u/lsp', `pyright-${PYRIGHT_PIN.version}`))
  })
})

describe('the download (YAZ-3500)', () => {
  it('success: both helpers checked, unpacked to <userData>/lsp/<name>-<version>/, tsc runnable, no .map, no .partial- left; the resolvers find them', async () => {
    mkdirSync(path.join(lspRoot, 'pyright-1.1.1'), { recursive: true }) // an older pinned version
    const steps: LspInstallProgress[] = []
    const res = await installer().install((p) => steps.push(p))
    expect(res).toEqual({ ok: true })
    const ts = helperFolder(lspRoot, TYPESCRIPT_PINS['darwin-arm64'])
    const py = helperFolder(lspRoot, PYRIGHT_PIN)
    expect(readFileSync(path.join(ts, 'lib', 'tsc'), 'utf8')).toContain('echo tsc')
    expect(statSync(path.join(ts, 'lib', 'tsc')).mode & 0o777).toBe(0o755)
    expect(existsSync(path.join(ts, 'lib', 'lib.es5.d.ts'))).toBe(true)
    expect(existsSync(path.join(py, 'dist', 'pyright-langserver.js'))).toBe(true)
    expect(existsSync(path.join(py, 'dist', 'pyright-langserver.js.map'))).toBe(false)
    expect(readFileSync(path.join(py, ...LONG.split('/')), 'utf8')).toBe('def f(): ...')
    expect(leftovers()).toEqual([])
    expect(existsSync(path.join(lspRoot, 'pyright-1.1.1'))).toBe(false)
    // Progress: each helper's download, in whole steps, then its unpack.
    expect(steps.filter((s) => s.phase === 'unpack').map((s) => [s.helper, s.index, s.count])).toEqual([
      ['typescript', 1, 2],
      ['python', 2, 2],
    ])
    expect(steps.at(-2)).toMatchObject({ helper: 'python', phase: 'download', received: PY_TGZ.length, total: PY_TGZ.length })
    // Packaged (no dev copies): the resolvers take the downloaded copies.
    expect(resolveTypescriptServer({ lspRoot, devCopies: false, appPath: '', platform: 'darwin', arch: 'arm64', exists: existsSync })).toBe(path.join(ts, 'lib', 'tsc'))
    expect(resolvePyright({ lspRoot, devCopies: false, appPath: '', exists: existsSync })).toBe(path.join(py, 'langserver.index.js'))
  })

  it('a second switch-on with the helpers there downloads nothing', async () => {
    expect(await installer().install()).toEqual({ ok: true })
    const before = requests.length
    const again = installer()
    expect(again.missing()).toEqual([])
    expect(await again.install()).toEqual({ ok: true })
    expect(requests.length).toBe(before)
  })

  it('only the missing helper downloads (a new pinned version of one)', async () => {
    expect(await installer().install()).toEqual({ ok: true })
    rmSync(helperFolder(lspRoot, PYRIGHT_PIN), { recursive: true })
    requests.length = 0
    expect(await installer().install()).toEqual({ ok: true })
    expect(requests).toEqual(['/py.tgz'])
  })

  it('a hash mismatch: refused, nothing kept, and the box says "The download did not match. Try again later."', async () => {
    routes.set('/py.tgz', { bytes: tarball({ 'langserver.index.js': 'evil()' }) })
    const res = await installer().install()
    expect(res).toEqual({ ok: false, error: 'mismatch' })
    if (!res.ok) expect(installErrorText(res)).toBe('The download did not match. Try again later.')
    expect(existsSync(helperFolder(lspRoot, PYRIGHT_PIN))).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('offline: one sentence, nothing on disk', async () => {
    const res = await new HelperInstaller({ lspRoot, helpers: fakeHelpers(), platform: 'darwin', fetch: () => Promise.reject(new TypeError('fetch failed')), log: () => undefined }).install()
    expect(res).toMatchObject({ ok: false, error: 'offline' })
    if (!res.ok) expect(installErrorText(res)).toBe("Couldn't download the helper tools. Check your internet connection and try again.")
    expect(existsSync(helperFolder(lspRoot, TYPESCRIPT_PINS['darwin-arm64']))).toBe(false)
    expect(leftovers()).toEqual([])
    // A closed port, through the real fetch.
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    expect(await installer(fakeHelpers({ ts: { url: `http://127.0.0.1:${port}/ts.tgz` } })).install()).toMatchObject({ ok: false, error: 'offline' })
  })

  it('HTTP 404: the box names it, nothing on disk', async () => {
    routes.set('/ts.tgz', { bytes: Buffer.alloc(0), status: 404 })
    const res = await installer().install()
    expect(res).toEqual({ ok: false, error: 'http', detail: 'HTTP 404' })
    if (!res.ok) expect(installErrorText(res)).toBe('The download failed (HTTP 404). Try again later.')
    expect(readdirSync(lspRoot)).toEqual([])
  })

  it('the quit in the middle of a download (cancel) leaves no half folder', async () => {
    routes.set('/ts.tgz', { bytes: TS_TGZ, stall: true })
    const one = installer()
    let partialSeen = false
    const res = one.install((p) => {
      if (p.phase === 'download' && p.received > 0 && !partialSeen) {
        partialSeen = leftovers().length === 1
        void one.cancel()
      }
    })
    expect(one.installing).toBe(true)
    expect(await res).toEqual({ ok: false, error: 'cancelled' })
    expect(partialSeen).toBe(true)
    expect(one.installing).toBe(false)
    expect(readdirSync(lspRoot)).toEqual([])
  })

  it('two windows at once: one download, one answer', async () => {
    const one = installer()
    const [a, b] = await Promise.all([one.install(), one.install()])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(requests.filter((r) => r === '/ts.tgz')).toHaveLength(1)
  })

  it('a .partial- folder a killed app left is deleted at the next start, and by the next download', async () => {
    mkdirSync(path.join(lspRoot, `${PARTIAL}abc`, 'package'), { recursive: true })
    installer().sweep()
    expect(leftovers()).toEqual([])
    mkdirSync(path.join(lspRoot, `${PARTIAL}def`), { recursive: true })
    expect(await installer().install()).toEqual({ ok: true })
    expect(leftovers()).toEqual([])
  })

  it('a platform with no pinned TypeScript 7: refused with one sentence', async () => {
    const res = await installer(null).install()
    expect(res).toEqual({ ok: false, error: 'unsupported' })
    expect(requests).toEqual([])
  })

  it('an archive without the helper entry, or one that climbs out of its folder, is refused', async () => {
    const noEntry = tarball({ 'package.json': '{}' })
    routes.set('/ts.tgz', { bytes: noEntry })
    expect(await installer(fakeHelpers({ ts: { integrity: sha512(noEntry) } })).install()).toMatchObject({ ok: false, error: 'unpack' })
    expect(leftovers()).toEqual([])
    expect(() => safeRelative('package/../../etc/passwd')).toThrow('unsafe path')
    expect(safeRelative('package')).toBeNull()
    expect(safeRelative('package/lib/tsc')).toBe(path.join('lib', 'tsc'))
  })
})

describe('the tar reader (YAZ-3500)', () => {
  it('reads files, modes and long names; skips folders; refuses a bad checksum and a cut archive', async () => {
    const { gunzipSync } = await import('node:zlib')
    const files = readTar(gunzipSync(PY_TGZ))
    expect(files.map((f) => f.path).sort()).toEqual(['package/dist/pyright-langserver.js', 'package/dist/pyright-langserver.js.map', `package/${LONG}`, 'package/langserver.index.js', 'package/package.json'].sort())
    const ts = readTar(gunzipSync(TS_TGZ)).find((f) => f.path === 'package/lib/tsc')!
    expect(ts.mode & 0o111).not.toBe(0)
    const raw = Buffer.from(gunzipSync(TS_TGZ))
    const bad = Buffer.from(raw)
    bad[0] ^= 0xff
    expect(() => readTar(bad)).toThrow('checksum')
    expect(() => readTar(raw.subarray(0, 700))).toThrow('ends inside a file')
    expect(readTar(gunzipSync(gzipSync(Buffer.alloc(1024))))).toEqual([])
  })
})
