/**
 * The `app:sound` door (YAZ-3267 D15; the kind check is the YAZ-3248 rulings): it takes exactly the
 * string `'land'` or `'trash'`. `playSound` is mocked: no test plays a real sound.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { playSound } from '../sounds'
import { registerSoundIpc } from './sound'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
vi.mock('../sounds', () => ({ playSound: vi.fn() }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const sound = (...args: unknown[]) => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === CONTRACT.app.sound.channel)
  if (call === undefined) throw new Error('no handler registered for app:sound')
  return (call[1] as unknown as Handler)({ sender: {} }, ...args)
}

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(playSound).mockClear()
  registerSoundIpc()
})

describe('app:sound (YAZ-3267 D15)', () => {
  it("'land' and 'trash' play their sound, and the door answers at once", async () => {
    expect(await sound('land')).toEqual({ ok: true, value: undefined })
    expect(await sound('trash')).toEqual({ ok: true, value: undefined })
    expect(vi.mocked(playSound).mock.calls).toEqual([['land'], ['trash']])
  })

  it('any other kind is BAD_REQUEST and plays nothing: an array, another string, an object, nothing', async () => {
    for (const kind of [['land'], ['trash'], 'x', 'Land', 'land ', '', 'toString', '__proto__', { kind: 'land' }, {}, 42, null, undefined]) {
      expect(await sound(kind)).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: "'kind' must be 'land' or 'trash'" } })
    }
    expect(playSound).not.toHaveBeenCalled()
  })
})
