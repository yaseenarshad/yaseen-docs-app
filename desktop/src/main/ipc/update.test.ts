/**
 * The `update:check` door (YAZ-4371, the "What's new" sheet's "Update to v<latest>") against the REAL
 * updater on a fake host: no Mac, so a newer release is `manual` (S13) and nothing downloads or touches
 * a disk. `updater.test.ts` tests the check itself; this proves the door is that check: one check, its
 * state as the answer, a second call during a check joining it (S6), and none in a dev run (S7).
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { createUpdater, type UpdaterHost } from '../updater'
import { registered } from './ipcFixture'
import { registerUpdateIpc } from './update'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

const FEED = 'https://feed.test/releases'

beforeEach(() => vi.mocked(ipcMain.handle).mockClear())

/** `releases/latest` answers when the test lets it: so a second call can land during the check. */
function setup(overrides: Partial<UpdaterHost> = {}) {
  let answer!: (res: Response) => void
  const fetch = vi.fn((url: string) => (url === `${FEED}/latest` ? new Promise<Response>((r) => (answer = r)) : Promise.resolve(new Response('', { status: 404 }))))
  const host: UpdaterHost = {
    fetch,
    run: vi.fn(),
    spawnDetached: vi.fn(),
    userData: join(tmpdir(), 'yd-update-ipc-never-written'),
    bundle: '/Applications/Yaseen Docs.app',
    version: '2.10',
    platform: 'linux',
    isPackaged: true,
    feed: FEED,
    pid: 1,
    ...overrides,
  }
  const states: unknown[] = []
  const updater = createUpdater(host, (s) => states.push(s))
  registerUpdateIpc(updater, { openExternal: vi.fn(), restartToUpdate: vi.fn() })
  const check = () => registered(CONTRACT.update.check)({})
  const latest = (tag: string) => answer(Response.json({ tag_name: tag, name: tag, published_at: null, body: '', assets: [{ name: `Yaseen.Docs-${tag}-arm64.dmg`, browser_download_url: 'https://dl.test/x.dmg', digest: 'sha256:00' }] }))
  return { fetch, check, latest, states }
}

describe('update:check (YAZ-4371)', () => {
  it('runs one check and answers the state it finds; a second call during the check joins it', async () => {
    const { fetch, check, latest, states } = setup()
    const first = check()
    const second = check()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    latest('v2.11')
    const answer = { ok: true, value: { kind: 'manual', version: '2.11' } }
    await expect(first).resolves.toEqual(answer)
    await expect(second).resolves.toEqual(answer)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${FEED}/latest`])
    expect(states).toEqual([{ kind: 'manual', version: '2.11' }]) // pushed to every window too
  })

  it('a check that cannot reach GitHub fails, so the sheet can say so', async () => {
    const { check } = setup({ fetch: () => Promise.reject(new TypeError('fetch failed')) })
    await expect(check()).resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('fetch failed') } })
  })

  it('S7: a dev run with no feed answers the state and fetches nothing', async () => {
    const { fetch, check } = setup({ isPackaged: false, feed: undefined })
    await expect(check()).resolves.toEqual({ ok: true, value: { kind: 'idle' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
