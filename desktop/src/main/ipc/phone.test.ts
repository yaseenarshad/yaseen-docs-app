/**
 * `phone:code` (YAZ-5098): the ONE door through which a renderer gets anything made from the GitHub token, and what it
 * gets is a QR grid, never the token as text. Only the app's own page in a window of the app, in front, for a vault
 * of that window. The other secret doors stay "write and ask, never read".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { PhoneCodeAnswer } from '@shared/types'
import { registerPhoneIpc } from './phone'
import { registered } from './ipcFixture'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

const TOKEN = 'github_pat_EXAMPLE0' + 'x'.repeat(74)
const frame = { url: 'app://yaseen/index.html?win=w1' }
const sender = { id: 1, mainFrame: frame, isDestroyed: () => false }
const event = { sender, senderFrame: frame }
const bad = { ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST' }) }
const GRID = [[true, false], [false, true]]

let focused: boolean
const build = vi.fn(async (_root: string): Promise<PhoneCodeAnswer> => ({ ok: true, repo: 'yaseen/vault', branch: 'main', grid: GRID }))

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear()
  build.mockClear()
  focused = true
  registerPhoneIpc({ idFor: (wc) => (wc.id === 1 ? 'w1' : undefined) }, {
    rendererUrl: 'app://yaseen/index.html',
    isFocused: () => focused,
    roots: () => ['/vaults/a'],
    build,
  })
})

const code = (e: unknown, ...args: unknown[]) => registered(CONTRACT.phone.code)(e, ...args)

describe('phone:code (YAZ-5098)', () => {
  it("answers the grid for a vault of the sender's window", async () => {
    expect(await code(event, '/vaults/a')).toEqual({ ok: true, value: { ok: true, repo: 'yaseen/vault', branch: 'main', grid: GRID } })
    expect(build).toHaveBeenCalledExactlyOnceWith('/vaults/a')
  })

  it('refuses an unknown, destroyed, sub-frame or foreign-page sender, and a window that is not in front', async () => {
    expect(await code({ ...event, sender: { ...sender, id: 9 } }, '/vaults/a')).toEqual(bad)
    expect(await code({ ...event, sender: { ...sender, isDestroyed: () => true } }, '/vaults/a')).toEqual(bad)
    expect(await code({ ...event, senderFrame: { ...frame } }, '/vaults/a')).toEqual(bad)
    expect(await code({ ...event, senderFrame: null }, '/vaults/a')).toEqual(bad)
    const evil = { url: 'https://evil.example/index.html' }
    expect(await code({ sender: { ...sender, mainFrame: evil }, senderFrame: evil }, '/vaults/a')).toEqual(bad)
    focused = false
    expect(await code(event, '/vaults/a')).toEqual(bad)
    expect(build).not.toHaveBeenCalled()
  })

  it('refuses a folder that is not a vault of that window, and a root that is not a string', async () => {
    expect(await code(event, '/vaults/b')).toEqual(bad)
    expect(await code(event, '/')).toEqual(bad)
    expect(await code(event, 7)).toEqual(bad)
    expect(await code(event)).toEqual(bad)
    expect(build).not.toHaveBeenCalled()
  })

  it("a failure gives plain words, never the failure's own text (it could hold the token)", async () => {
    build.mockRejectedValueOnce(new Error(`git said ${TOKEN}`))
    const answer = await code(event, '/vaults/a')
    expect(answer).toEqual({ ok: false, error: expect.objectContaining({ code: 'IO_ERROR' }) })
    expect(JSON.stringify(answer)).not.toContain('github_pat_')
  })

  it('no channel of the contract reads a secret: `secrets` writes and asks, `phone` answers a grid', () => {
    expect(Object.keys(CONTRACT.secrets).sort()).toEqual(['has', 'set'])
    expect(Object.keys(CONTRACT.phone)).toEqual(['code'])
  })
})
