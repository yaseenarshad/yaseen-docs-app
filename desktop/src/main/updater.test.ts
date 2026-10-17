/**
 * The updater against a fake host (YAZ-2976 D2, D7): a fake GitHub feed, fake `codesign`/`hdiutil`/
 * `ditto` runners, and real files in a temp `userData`. `updater.swap.test.ts` and
 * `updater.codesign.test.ts` run the real shell and the real tools on temp folders.
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { compareVersions, createUpdater, newer, parseRequirement, pickAsset, SWAP_SCRIPT, type UpdaterHost } from './updater'

const FEED = 'https://feed.test/releases'
const REQ = 'identifier "com.yasinarshad.yaseendocs" and certificate leaf = H"0344c2f9faa1bce22513313ac09924367c5670fe"'
const DMG = new TextEncoder().encode('the bytes of a fake dmg')
const SHA = createHash('sha256').update(DMG).digest('hex')

let dir: string
let userData: string
let bundle: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yd-updater-'))
  userData = join(dir, 'userData')
  bundle = join(dir, 'Applications', 'Yaseen Docs.app')
  await mkdir(userData, { recursive: true })
  await mkdir(bundle, { recursive: true })
})
afterEach(async () => {
  vi.useRealTimers()
  await chmod(join(dir, 'Applications'), 0o755).catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
})

const release = (tag: string, assets: Array<{ name: string; digest?: string | null }> = [{ name: `Yaseen.Docs-${tag.replace(/^v/, '')}-arm64.dmg`, digest: `sha256:${SHA}` }]) => ({
  tag_name: tag,
  name: `Yaseen Docs ${tag}`,
  published_at: '2026-10-17T12:00:00Z',
  body: `Notes of ${tag}`,
  assets: assets.map((a) => ({ ...a, browser_download_url: `https://dl.test/${a.name}` })),
})

/** A fake host: `latest` is what `releases/latest` answers; `requirement` what `codesign -d -r-` prints. */
function fake(opts: { latest?: unknown; list?: unknown; requirement?: string | Error; body?: () => BodyInit; overrides?: Partial<UpdaterHost>; verify?: Error } = {}) {
  const calls: Array<[string, readonly string[]]> = []
  const fetched: string[] = []
  const host: UpdaterHost = {
    async fetch(url) {
      fetched.push(url)
      if (url === `${FEED}/latest`) return Response.json(opts.latest ?? release('v1.0.13'))
      if (url === `${FEED}?per_page=20`) return Response.json(opts.list ?? [])
      if (url.startsWith('https://dl.test/')) return new Response(opts.body?.() ?? DMG)
      return new Response('', { status: 404 })
    },
    async run(file, args) {
      calls.push([file, args])
      if (file === '/usr/bin/codesign' && args[0] === '-d') {
        const r = opts.requirement ?? `designated => ${REQ}`
        if (r instanceof Error) throw r
        return { stdout: `Executable=${bundle}/Contents/MacOS/Yaseen Docs\n${r}\n`, stderr: '' }
      }
      if (file === '/usr/bin/codesign' && opts.verify !== undefined) throw opts.verify
      return { stdout: '', stderr: '' }
    },
    spawnDetached: vi.fn(),
    userData,
    bundle,
    version: '1.0.12',
    platform: 'darwin',
    isPackaged: true,
    feed: FEED,
    pid: 4242,
    ...opts.overrides,
  }
  const states: UpdateState[] = []
  const updater = createUpdater(host, (s) => states.push(s))
  return { updater, host, calls, fetched, states }
}

describe('newer / compareVersions', () => {
  it('compares x.y.z as numbers, ignores a leading v, and equal is not newer', () => {
    expect(newer('1.0.13', '1.0.12')).toBe(true)
    expect(newer('1.0.10', '1.0.9')).toBe(true)
    expect(newer('1.0.9', '1.0.10')).toBe(false)
    expect(newer('v1.1.0', '1.0.99')).toBe(true)
    expect(newer('v1.0.12', '1.0.12')).toBe(false)
    expect(newer('1.0.12', 'v1.0.12')).toBe(false)
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0)
  })
})

describe('pickAsset (S2)', () => {
  it('takes the -arm64.dmg with a sha256 digest, and nothing else', () => {
    expect(pickAsset(release('v1.0.13'))).toEqual({ url: 'https://dl.test/Yaseen.Docs-1.0.13-arm64.dmg', sha256: SHA })
    expect(pickAsset(release('v1.0.13', [{ name: 'Yaseen.Docs-1.0.13-arm64.dmg', digest: null }]))).toBeNull()
    expect(pickAsset(release('v1.0.13', [{ name: 'Yaseen.Docs-1.0.13-arm64.dmg' }]))).toBeNull()
    expect(pickAsset(release('v1.0.13', [{ name: 'Yaseen.Docs-1.0.13-win-x64-setup.exe', digest: `sha256:${SHA}` }, { name: 'Yaseen.Docs-1.0.13-arm64.dmg.blockmap', digest: `sha256:${SHA}` }]))).toBeNull()
    expect(pickAsset({ ...release('v1.0.13'), assets: undefined })).toBeNull()
  })
})

describe('parseRequirement', () => {
  it('reads the designated line, with or without the implicit "# " prefix', () => {
    expect(parseRequirement(`Executable=/x\ndesignated => ${REQ}\n`)).toBe(REQ)
    expect(parseRequirement('Executable=/x\n# designated => cdhash H"c66e349c74f82d9abe250860fb3d47146c2c3a0e"\n')).toBe('cdhash H"c66e349c74f82d9abe250860fb3d47146c2c3a0e"')
    expect(parseRequirement('/x: code object is not signed at all\n')).toBeNull()
  })
})

describe('check', () => {
  it('S1: nothing newer → idle, no download, no codesign', async () => {
    const { updater, calls, fetched, states } = fake({ latest: release('v1.0.12') })
    await expect(updater.check()).resolves.toEqual({ kind: 'idle' })
    expect(fetched).toEqual([`${FEED}/latest`])
    expect([calls, states]).toEqual([[], []])
  })

  it('a pre-release tag is never an update: idle, nothing fetched but the check', async () => {
    const { updater, fetched, states } = fake({ latest: release('v1.0.13-beta.1') })
    await expect(updater.check()).resolves.toEqual({ kind: 'idle' })
    expect([fetched, states]).toEqual([[`${FEED}/latest`], []])
  })

  it.each([
    ['no -arm64.dmg', [{ name: 'Yaseen.Docs-1.0.13-win-x64-setup.exe', digest: `sha256:${SHA}` }]],
    ['a null digest', [{ name: 'Yaseen.Docs-1.0.13-arm64.dmg', digest: null }]],
  ])('S2: a newer release with %s is ignored: idle, nothing fetched but the check', async (_case, assets) => {
    const { updater, calls, fetched, states } = fake({ latest: release('v1.0.13', assets) })
    await expect(updater.check()).resolves.toEqual({ kind: 'idle' })
    expect([fetched, calls, states]).toEqual([[`${FEED}/latest`], [], []])
  })

  it('S3: GitHub refuses → the check rejects and the state does not change', async () => {
    const { updater, states } = fake({ overrides: { fetch: async () => new Response('rate limited', { status: 403 }) } })
    await expect(updater.check()).rejects.toThrow('403')
    expect([updater.state(), states]).toEqual([{ kind: 'idle' }, []])
  })

  it.each<[string, Partial<UpdaterHost> | ((h: { bundle: string; dir: string }) => Promise<Partial<UpdaterHost>>), string | Error | undefined]>([
    ['Windows (D3)', { platform: 'win32' }, undefined],
    ['an unpackaged run', { isPackaged: false }, undefined],
    ['a copy on the mounted .dmg', { bundle: '/Volumes/Yaseen Docs 1.0.12-arm64/Yaseen Docs.app' }, undefined],
    ['App Translocation', { bundle: '/private/var/folders/xy/T/AppTranslocation/0A1B/d/Yaseen Docs.app' }, undefined],
    [
      'a folder the user cannot write',
      async ({ dir }) => {
        await chmod(join(dir, 'Applications'), 0o555)
        return {}
      },
      undefined,
    ],
    ['an ad-hoc build', {}, '# designated => cdhash H"c66e349c74f82d9abe250860fb3d47146c2c3a0e"'],
    ['an unsigned build', {}, new Error('code object is not signed at all')],
  ])('S13: %s → manual, with the version, and nothing downloads', async (_case, overrides, requirement) => {
    const o = typeof overrides === 'function' ? await overrides({ bundle, dir }) : overrides
    const { updater, fetched, calls, states } = fake({ overrides: o, requirement })
    await expect(updater.check()).resolves.toEqual({ kind: 'manual', version: '1.0.13' })
    expect(states).toEqual([{ kind: 'manual', version: '1.0.13' }])
    expect(fetched).toEqual([`${FEED}/latest`])
    expect(calls.filter(([f]) => f !== '/usr/bin/codesign')).toEqual([]) // at most the `codesign -d` of S13
  })

  it('S8, S11: downloads to .part, checks the sha256, mounts out of sight, verifies against our requirement, stages with ditto, then cleans up → ready', async () => {
    const updates = join(userData, 'updates')
    await mkdir(updates, { recursive: true })
    await writeFile(join(updates, '1.0.11.dmg.part'), 'the last, broken download') // S12: deleted by the next one
    await mkdir(`${bundle}.update/Contents`, { recursive: true }) // a staged copy from a failed swap (S23)
    const { updater, calls, fetched, states } = fake()
    await expect(updater.check()).resolves.toEqual({ kind: 'ready', version: '1.0.13' })
    expect(states).toEqual([{ kind: 'downloading', version: '1.0.13' }, { kind: 'ready', version: '1.0.13' }])
    expect(fetched).toEqual([`${FEED}/latest`, 'https://dl.test/Yaseen.Docs-1.0.13-arm64.dmg'])
    const mount = calls[1][1][5]
    expect(mount).toMatch(/yaseen-docs-update-/)
    expect(calls).toEqual([
      ['/usr/bin/codesign', ['-d', '-r-', bundle]],
      ['/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, join(updates, '1.0.13.dmg')]],
      ['/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${REQ}`, join(mount, 'Yaseen Docs.app')]],
      ['/usr/bin/ditto', [join(mount, 'Yaseen Docs.app'), `${bundle}.update`]],
      ['/usr/bin/hdiutil', ['detach', mount, '-force']],
    ])
    expect(existsSync(`${bundle}.update`)).toBe(false) // the fake ditto copies nothing: the old staged copy went first
    expect(existsSync(updates)).toBe(false) // the old .part went first, and the .dmg after staging
    expect(existsSync(mount)).toBe(false)
  })

  it('S9: a wrong sha256 → rejects, back to idle, the file is gone, and nothing is mounted', async () => {
    const { updater, calls, states } = fake({ body: () => new TextEncoder().encode('tampered bytes') })
    await expect(updater.check()).rejects.toThrow('sha256')
    expect(states).toEqual([{ kind: 'downloading', version: '1.0.13' }, { kind: 'idle' }])
    expect(calls.map(([f, a]) => `${f} ${a[0]}`)).toEqual(['/usr/bin/codesign -d']) // no hdiutil, no ditto
    expect(existsSync(join(userData, 'updates'))).toBe(false)
  })

  it('S10: a build that does not meet our requirement → rejects, back to idle, detached, nothing staged', async () => {
    const { updater, calls, states } = fake({ verify: new Error('test-requirement: code failed to satisfy specified code requirement(s)') })
    await expect(updater.check()).rejects.toThrow('requirement')
    expect(states.at(-1)).toEqual({ kind: 'idle' })
    expect(calls.map(([f, a]) => `${f} ${a[0]}`)).toEqual(['/usr/bin/codesign -d', '/usr/bin/hdiutil attach', '/usr/bin/codesign --verify', '/usr/bin/hdiutil detach'])
    expect(existsSync(`${bundle}.update`)).toBe(false)
    expect(existsSync(join(userData, 'updates'))).toBe(false) // a failed download leaves nothing (S11)
  })

  it('a stalled check stops after 30 s, so the next check can run (the JSON requests carry the timeout signal)', async () => {
    const timeout = new AbortController()
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const signals: Array<AbortSignal | undefined> = []
    const { updater } = fake({
      overrides: {
        fetch: (url, init) => (signals.push(init?.signal), url.endsWith('/latest') && signals.length === 1 ? new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))) : Promise.resolve(Response.json(release('v1.0.12')))),
      },
    })
    const stalled = updater.check()
    expect(spy).toHaveBeenCalledWith(30_000)
    timeout.abort(new Error('timed out'))
    await expect(stalled).rejects.toThrow('timed out')
    await expect(updater.check()).resolves.toEqual({ kind: 'idle' })
    expect(signals).toEqual([timeout.signal, timeout.signal])
    spy.mockRestore()
  })

  it('a download with no data for 60 s stops, however long it ran: back to idle, nothing left on disk', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const { updater, states } = fake({
      overrides: {
        async fetch(url, init) {
          if (url.endsWith('/latest')) return Response.json(release('v1.0.13'))
          signal = init?.signal
          // A body that sends a chunk now and one 50 s later, then nothing; the real `net.fetch` errors it on abort, as here.
          return new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(DMG.slice(0, 4))
                setTimeout(() => c.enqueue(DMG.slice(4, 8)), 50_000)
                init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason))
              },
            }),
          )
        },
      },
    })
    const check = updater.check()
    const failed = expect(check).rejects.toThrow('stalled')
    // The writes are real file I/O, so wait for each chunk on disk before the clock moves.
    const written = (n: number) => vi.waitFor(() => expect(statSync(join(userData, 'updates', '1.0.13.dmg.part')).size).toBe(n))
    await written(4)
    await vi.advanceTimersByTimeAsync(50_000)
    await written(8)
    await vi.advanceTimersByTimeAsync(59_000) // 109 s in: 60 s after the LAST chunk is the limit, not 60 s after the start
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(signal?.aborted).toBe(true)
    await failed
    expect(states.at(-1)).toEqual({ kind: 'idle' })
    expect(existsSync(join(userData, 'updates'))).toBe(false)
  })

  it('S6: a check during the download answers downloading and fetches nothing; two checks at once share one request; ready answers ready', async () => {
    let release_!: () => void
    const held = new Promise<void>((r) => (release_ = r))
    const body = () =>
      new ReadableStream<Uint8Array>({
        async start(c) {
          await held
          c.enqueue(DMG)
          c.close()
        },
      })
    const { updater, fetched } = fake({ body })
    const first = updater.check()
    const twin = updater.check()
    await vi.waitFor(() => expect(updater.state()).toEqual({ kind: 'downloading', version: '1.0.13' }))
    await expect(updater.check()).resolves.toEqual({ kind: 'downloading', version: '1.0.13' })
    release_()
    await expect(first).resolves.toEqual({ kind: 'ready', version: '1.0.13' })
    await expect(twin).resolves.toEqual({ kind: 'ready', version: '1.0.13' })
    await expect(updater.check()).resolves.toEqual({ kind: 'ready', version: '1.0.13' })
    expect(fetched).toEqual([`${FEED}/latest`, 'https://dl.test/Yaseen.Docs-1.0.13-arm64.dmg'])
  })
})

describe('the updated-to marker (S24)', () => {
  beforeEach(() => void vi.useFakeTimers())

  it('holding this version → updated at start, and the file is deleted; creating the updater touches nothing', async () => {
    await writeFile(join(userData, 'updated-to'), '1.0.12')
    const { updater, states } = fake({ latest: release('v1.0.12') })
    expect(updater.state()).toEqual({ kind: 'idle' })
    expect(existsSync(join(userData, 'updated-to'))).toBe(true)
    updater.start()
    expect(updater.state()).toEqual({ kind: 'updated', version: '1.0.12' })
    expect(existsSync(join(userData, 'updated-to'))).toBe(false)
    await expect(updater.check()).resolves.toEqual({ kind: 'updated', version: '1.0.12' }) // nothing newer keeps the pill
    expect(states).toEqual([])
  })

  it('holding another version (the swap did not land) → idle, and the file is deleted all the same', async () => {
    await writeFile(join(userData, 'updated-to'), '1.0.13')
    const { updater } = fake({ overrides: { isPackaged: false, feed: undefined } }) // read even in a run that never checks
    updater.start()
    expect(updater.state()).toEqual({ kind: 'idle' })
    expect(existsSync(join(userData, 'updated-to'))).toBe(false)
  })
})

describe('notes (D5, D8)', () => {
  const list = ['v1.0.10', 'v1.0.14', 'v1.0.13', 'v1.0.12', 'v1.0.11', 'v1.0.9', 'v1.0.8'].map((t) => release(t))
  const drafts = [{ ...release('v1.0.15'), draft: true }, { ...release('v1.0.16'), prerelease: true }]

  it('the releases newer than this app, newest first, as ReleaseNote', async () => {
    const { updater } = fake({ list: [...drafts, ...list] })
    await expect(updater.notes()).resolves.toEqual([
      { version: '1.0.14', title: 'Yaseen Docs v1.0.14', date: '2026-10-17T12:00:00Z', body: 'Notes of v1.0.14' },
      { version: '1.0.13', title: 'Yaseen Docs v1.0.13', date: '2026-10-17T12:00:00Z', body: 'Notes of v1.0.13' },
    ])
  })

  it('none newer → the last 5 releases, newest first; a null name or body has a fallback', async () => {
    const { updater } = fake({ list: [...list, { ...release('v1.0.7'), name: null, body: null }], overrides: { version: '1.0.14' } })
    const notes = await updater.notes()
    expect(notes.map((n) => n.version)).toEqual(['1.0.14', '1.0.13', '1.0.12', '1.0.11', '1.0.10'])
    const { updater: old } = fake({ list: [{ ...release('v1.0.7'), name: null, body: null }], overrides: { version: '1.0.14' } })
    await expect(old.notes()).resolves.toEqual([{ version: '1.0.7', title: 'v1.0.7', date: '2026-10-17T12:00:00Z', body: '' }])
  })

  it('rejects when GitHub cannot be reached (S18)', async () => {
    const { updater } = fake({ overrides: { fetch: () => Promise.reject(new TypeError('fetch failed')) } })
    await expect(updater.notes()).rejects.toThrow('fetch failed')
  })
})

describe('start (D7, S3, S7)', () => {
  it('checks 10 s after start, then every 12 hours; a failed check is silent', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { updater, fetched } = fake({ overrides: { fetch: vi.fn(async (url: string) => (fetched.push(url), new Response('', { status: 500 }))) } })
    updater.start()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetched).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(fetched).toEqual([`${FEED}/latest`])
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000)
    expect(fetched).toEqual([`${FEED}/latest`, `${FEED}/latest`])
    expect(updater.state()).toEqual({ kind: 'idle' })
    expect(error).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('S7: a dev run with no feed never checks; YASEEN_DOCS_UPDATE_FEED turns it on', async () => {
    vi.useFakeTimers()
    const dev = fake({ overrides: { isPackaged: false, feed: undefined } })
    dev.updater.start()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(dev.fetched).toEqual([])
    const e2e = fake({ overrides: { isPackaged: false } })
    e2e.updater.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(e2e.fetched).toEqual([`${FEED}/latest`])
    expect(e2e.updater.state()).toEqual({ kind: 'manual', version: '1.0.13' }) // an unpackaged run cannot replace itself (S13)
  })
})

describe('installOnExit (S21, S22)', () => {
  it('does nothing with no update staged', async () => {
    const { updater, host } = fake({ latest: release('v1.0.12') })
    await updater.check()
    updater.installOnExit(true)
    expect(host.spawnDetached).not.toHaveBeenCalled()
  })

  it('with an update staged starts the detached swap with this PID, the bundle, the marker, the version and the reopen flag', async () => {
    const { updater, host } = fake()
    await updater.check()
    updater.installOnExit(true)
    updater.installOnExit(false)
    expect(vi.mocked(host.spawnDetached).mock.calls).toEqual([
      ['/bin/sh', ['-c', SWAP_SCRIPT, 'sh', '4242', bundle, join(userData, 'updated-to'), '1.0.13', '1']],
      ['/bin/sh', ['-c', SWAP_SCRIPT, 'sh', '4242', bundle, join(userData, 'updated-to'), '1.0.13', '0']],
    ])
  })

  it('a swap that cannot start never throws: the app still exits', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { updater } = fake({ overrides: { spawnDetached: () => { throw new Error('EAGAIN') } } })
    await updater.check()
    expect(() => updater.installOnExit(false)).not.toThrow()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
