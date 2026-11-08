import { afterEach, expect, it, vi } from 'vitest'
import { appCommand, type AutomationApp } from './app'
import { checked } from './contract'

afterEach(() => vi.useRealTimers())
const host = () => ({ updater: { state: vi.fn(() => ({ kind: 'idle' })), notes: vi.fn(async () => []), check: vi.fn(async () => ({ kind: 'ready' })), checks: false }, diagnostics: vi.fn(async () => ({ memory: null })), restart: vi.fn() }) as unknown as AutomationApp
it('acknowledges a plain restart before invoking shutdown', async () => {
  vi.useFakeTimers(); const app = host()
  expect(await checked('app.restart', appCommand(app, 'app.restart'))).toMatchObject({ accepted: true, receiptsExpireOnRestart: true })
  expect(app.restart).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  expect(app.restart).toHaveBeenCalledExactlyOnceWith('app')
})
it('preserves disabled update checks and refuses an install without a staged update', async () => {
  const app = host()
  expect(await checked('update.check', appCommand(app, 'update.check'))).toEqual({ kind: 'idle' })
  expect(app.updater.check).not.toHaveBeenCalled()
  await expect(appCommand(app, 'update.restart')).rejects.toMatchObject({ code: 'UPDATE_NOT_READY' })
  expect(app.restart).not.toHaveBeenCalled()
  vi.mocked(app.updater.state).mockReturnValue({ kind: 'manual', version: 'next' })
  expect(await checked('update.restart', appCommand(app, 'update.restart'))).toMatchObject({ accepted: false, manual: true, url: expect.stringContaining('releases/latest') })
})
it('schedules only an explicitly ready update through the update restart path', async () => {
  vi.useFakeTimers(); const app = host()
  vi.mocked(app.updater.state).mockReturnValue({ kind: 'ready', version: 'next' })
  expect(await checked('update.restart', appCommand(app, 'update.restart'))).toMatchObject({ accepted: true })
  await vi.advanceTimersByTimeAsync(100)
  expect(app.restart).toHaveBeenCalledExactlyOnceWith('update')
})
