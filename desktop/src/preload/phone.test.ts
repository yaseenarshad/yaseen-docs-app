// @vitest-environment jsdom
/**
 * YAZ-5218 (CP2): `phone.code` gets the phone code (made from the GitHub token) only during a user gesture. The preload
 * runs in its own world, so page code cannot fake `navigator.userActivation`. Main checks again (`main/ipc/phone.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcRenderer } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { bridge } from './index'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
  webFrame: {},
  webUtils: {},
}))

const activation = (isActive: boolean | undefined) =>
  isActive === undefined ? Reflect.deleteProperty(navigator, 'userActivation') : Object.defineProperty(navigator, 'userActivation', { value: { isActive }, configurable: true })

beforeEach(() => vi.mocked(ipcRenderer.invoke).mockReset().mockResolvedValue({ ok: true, value: { ok: false, problem: 'no-token' } }))
afterEach(() => void Reflect.deleteProperty(navigator, 'userActivation'))

describe('phone.code needs a click or a key (YAZ-5218)', () => {
  it('phone.code is refused with no user gesture', async () => {
    activation(false)
    await expect(bridge.phone.code('/v')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('a page with no userActivation at all is refused too (the gate fails closed)', async () => {
    activation(undefined)
    await expect(bridge.phone.code('/v')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('phone.code invokes during a gesture', async () => {
    activation(true)
    await bridge.phone.code('/v')
    expect(ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(CONTRACT.phone.code.channel, '/v')
  })
})
