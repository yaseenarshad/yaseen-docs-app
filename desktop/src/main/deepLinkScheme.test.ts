import { describe, expect, it, vi } from 'vitest'
import { claimDeepLinkScheme } from './deepLinkScheme'

describe('claimDeepLinkScheme', () => {
  it('claims yaseendocs:// on a normal launch', () => {
    const app = { setAsDefaultProtocolClient: vi.fn(() => true) }
    claimDeepLinkScheme(app, {})
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith('yaseendocs')
  })

  it('leaves the machine handler alone under the e2e harness (YASEEN_DOCS_E2E=1)', () => {
    const app = { setAsDefaultProtocolClient: vi.fn(() => true) }
    claimDeepLinkScheme(app, { YASEEN_DOCS_E2E: '1' })
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})
