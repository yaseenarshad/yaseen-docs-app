/** The shared OS verbs (YAZ-3910 A5): the bridge call each one makes, and the notice each failure gives. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    window: { open: vi.fn().mockResolvedValue({}) },
    shell: { reveal: vi.fn().mockResolvedValue({}), openVsCode: vi.fn().mockResolvedValue({}), openDefault: vi.fn().mockResolvedValue({}) },
  },
}))
import { api, BridgeRequestError } from '../api'
import { osVerbs } from './osVerbs'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('osVerbs', () => {
  it('each verb calls its bridge door with the path; New window opens the vault that holds the file', () => {
    const verbs = osVerbs(vi.fn(), () => 'Plan', () => '/v')
    verbs.reveal('/v/Plan.md')
    verbs.openVsCode('/v/Plan.md')
    verbs.openDefault('/v/Plan.md')
    verbs.openNewWindow('/v/Plan.md')
    expect(api.shell.reveal).toHaveBeenCalledWith({ path: '/v/Plan.md' })
    expect(api.shell.openVsCode).toHaveBeenCalledWith({ path: '/v/Plan.md' })
    expect(api.shell.openDefault).toHaveBeenCalledWith({ path: '/v/Plan.md' })
    expect(api.window.open).toHaveBeenCalledWith({ root: '/v', file: '/v/Plan.md' })
  })

  it('a path in no vault opens no window', () => {
    vi.mocked(api.window.open).mockClear()
    osVerbs(vi.fn(), () => 'Plan').openNewWindow('/elsewhere/Plan.md')
    expect(api.window.open).not.toHaveBeenCalled()
  })

  it('a gone file is named; any other refusal is said as it comes', async () => {
    const notify = vi.fn()
    const verbs = osVerbs(notify, () => 'Plan')
    vi.mocked(api.shell.reveal).mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'gone'))
    vi.mocked(api.shell.openVsCode).mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'gone'))
    vi.mocked(api.shell.openDefault).mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'no app for .xyz'))
    verbs.reveal('/v/Plan.md')
    verbs.openVsCode('/v/Plan.md')
    verbs.openDefault('/v/Plan.xyz')
    await settle()
    expect(notify.mock.calls).toEqual([
      ['Can\'t reveal "Plan" — it is no longer there'],
      ['Can\'t open "Plan" in VS Code — it is no longer there'],
      ['Can\'t open "Plan": no app for .xyz'],
    ])
  })
})
