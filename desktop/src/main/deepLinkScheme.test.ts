import { describe, expect, it, vi } from 'vitest'
import { claimDeepLinkScheme } from './deepLinkScheme'

describe('claimDeepLinkScheme', () => {
  it('claims yaseendocs:// and Draw\'s yaseendraw:// on a normal launch (YAZ-3028 D7)', () => {
    const app = { setAsDefaultProtocolClient: vi.fn(() => true) }
    claimDeepLinkScheme(app, {})
    expect(app.setAsDefaultProtocolClient.mock.calls).toEqual([['yaseendocs'], ['yaseendraw']])
  })

  it('leaves the machine handler alone under the e2e harness (YASEEN_DOCS_E2E=1)', () => {
    const app = { setAsDefaultProtocolClient: vi.fn(() => true) }
    claimDeepLinkScheme(app, { YASEEN_DOCS_E2E: '1' })
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})
