/** The `app:home` door (YAZ-3886 P2): it answers the home folder it is given, with no argument. */
import { describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { registerHomeIpc } from './home'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

describe('app:home (YAZ-3886 P2)', () => {
  it('answers the home folder', async () => {
    registerHomeIpc(() => '/Users/me')
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === CONTRACT.app.home.channel)
    expect(await (call?.[1] as unknown as (e: unknown) => Promise<unknown>)({ sender: {} })).toEqual({ ok: true, value: '/Users/me' })
  })
})
