/**
 * The REAL `codesign`, `hdiutil` and `ditto` (YAZ-2976 S8, S10, S13) on tiny bundles in a temp
 * folder. Every signature is ad-hoc (`--sign -`): no certificate, no keychain. A bundle signed with
 * an explicit requirement (`-r='designated => identifier "…"'`) stands in for a build of "Yaseen
 * Local Signing", whose requirement holds no `cdhash` either. `hdiutil attach` runs with `-nobrowse`
 * (the updater's own arguments), so Finder shows nothing.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { createUpdater, ownRequirement, parseRequirement, runFile, type UpdaterHost } from './updater'

const DR = 'identifier "com.test.yaseendocs"'
/** `hdiutil create` takes ~5 s and `attach` ~3 s on a dev Mac; the CI macOS runner is slower (vitest.config.ts). */
const SLOW = 120_000
let dir: string

/** A minimal app: `Contents/Info.plist` + `Contents/MacOS/x` (a copy of `/usr/bin/true`), ad-hoc signed. */
async function bundle(path: string, id: string, requirement?: string): Promise<string> {
  await mkdir(join(path, 'Contents', 'MacOS'), { recursive: true })
  await cp('/usr/bin/true', join(path, 'Contents', 'MacOS', 'x'))
  await writeFile(
    join(path, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>x</string><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`,
  )
  await runFile('/usr/bin/codesign', ['--sign', '-', '--force', ...(requirement === undefined ? [] : [`-r=designated => ${requirement}`]), path])
  return path
}

const verify = (requirement: string, path: string) => runFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement}`, path])

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yd-codesign-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe.skipIf(process.platform !== 'darwin')('the designated requirement (real codesign)', () => {
  it('an ad-hoc build has only a cdhash requirement → ownRequirement is null (S13); that requirement refuses another bundle (S10)', async () => {
    const a = await bundle(join(dir, 'A.app'), 'com.test.a')
    const b = await bundle(join(dir, 'B.app'), 'com.test.b')
    const { stdout, stderr } = await runFile('/usr/bin/codesign', ['-d', '-r-', a])
    const cdhash = parseRequirement(`${stdout}\n${stderr}`)
    expect(cdhash).toMatch(/^cdhash H"[0-9a-f]{40}"/)
    await expect(ownRequirement(runFile, a)).resolves.toBeNull()
    await expect(verify(cdhash!, a)).resolves.toBeDefined()
    await expect(verify(cdhash!, b)).rejects.toThrow(/requirement/)
  })

  it('an explicit requirement is read back as it is, accepts a build that meets it and refuses one that does not', async () => {
    const running = await bundle(join(dir, 'Running.app'), 'com.test.yaseendocs', DR)
    await expect(ownRequirement(runFile, running)).resolves.toBe(DR)
    await expect(verify(DR, await bundle(join(dir, 'Same.app'), 'com.test.yaseendocs'))).resolves.toBeDefined()
    await expect(verify(DR, await bundle(join(dir, 'Other.app'), 'com.test.other'))).rejects.toThrow(/requirement/)
  })

  it('an unsigned bundle → null', async () => {
    const plain = join(dir, 'Plain.app')
    await mkdir(join(plain, 'Contents'), { recursive: true })
    await expect(ownRequirement(runFile, plain)).resolves.toBeNull()
  })
})

describe.skipIf(process.platform !== 'darwin')('a download end to end (real hdiutil, codesign, ditto)', () => {
  /** A `.dmg` that holds `Yaseen Docs.app` with this bundle id, as the release's asset. */
  async function dmgWith(name: string, id: string): Promise<Uint8Array<ArrayBuffer>> {
    const src = join(dir, `${name}-src`)
    await bundle(join(src, 'Yaseen Docs.app'), id)
    const out = join(dir, `${name}.dmg`)
    await runFile('/usr/bin/hdiutil', ['create', '-quiet', '-ov', '-fs', 'HFS+', '-format', 'UDZO', '-volname', 'Yaseen Docs', '-srcfolder', src, out])
    return new Uint8Array(await readFile(out))
  }

  async function updaterFor(name: string, dmg: Uint8Array<ArrayBuffer>) {
    const userData = join(dir, `${name}-userData`)
    await mkdir(userData, { recursive: true })
    const app = await bundle(join(dir, `${name}-Applications`, 'Yaseen Docs.app'), 'com.test.yaseendocs', DR)
    const sha = createHash('sha256').update(dmg).digest('hex')
    const host: UpdaterHost = {
      async fetch(url) {
        if (url.endsWith('/latest')) return Response.json({ tag_name: 'v1.0.13', name: '', published_at: '', body: '', assets: [{ name: 'Yaseen.Docs-1.0.13-arm64.dmg', digest: `sha256:${sha}`, browser_download_url: 'https://dl.test/x.dmg' }] })
        return new Response(dmg)
      },
      run: runFile,
      spawnDetached: () => undefined,
      userData,
      bundle: app,
      version: '1.0.12',
      platform: 'darwin',
      isPackaged: true,
      feed: 'https://feed.test/releases',
      pid: process.pid,
    }
    // `check()` answers `downloading` (S6); the push after it is how the download ended.
    let end!: (state: UpdateState) => void
    const ended = new Promise<UpdateState>((resolve) => (end = resolve))
    return { updater: createUpdater(host, (state) => state.kind !== 'downloading' && end(state)), ended, app, userData }
  }

  it('S8: a build that meets our requirement is staged beside the app, and the .dmg is detached and deleted', async () => {
    const { updater, ended, app, userData } = await updaterFor('good', await dmgWith('good', 'com.test.yaseendocs'))
    await expect(updater.check()).resolves.toEqual({ kind: 'downloading', version: '1.0.13' })
    await expect(ended).resolves.toEqual({ kind: 'ready', version: '1.0.13' })
    await expect(verify(DR, `${app}.update`)).resolves.toBeDefined()
    expect(await readFile(join(`${app}.update`, 'Contents', 'Info.plist'), 'utf8')).toContain('com.test.yaseendocs')
    expect(existsSync(join(userData, 'updates', '1.0.13.dmg'))).toBe(false)
    const { stdout } = await runFile('/usr/bin/hdiutil', ['info'])
    expect(stdout).not.toContain(userData) // `hdiutil info` names each attached image by its path
  }, SLOW)

  it('S10: a build that does not meet it (another identity) is refused: idle, nothing staged, nothing left mounted', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { updater, ended, app, userData } = await updaterFor('bad', await dmgWith('bad', 'com.test.other'))
    await updater.check()
    await expect(ended).resolves.toEqual({ kind: 'idle' })
    expect(String(error.mock.calls[0][0])).toMatch(/requirement/)
    error.mockRestore()
    expect(existsSync(`${app}.update`)).toBe(false)
    const { stdout } = await runFile('/usr/bin/hdiutil', ['info'])
    expect(stdout).not.toContain(userData) // `hdiutil info` names each attached image by its path
  }, SLOW)
})
