// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * YAZ-5564: the real entry (`main.tsx`) in a browser tab and in the Home Screen app. The store is a spy: the gate must
 * never open it (a vault that an old tab keeps stays as it is), and the app must.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const opened = vi.fn(async () => {
  throw new Error('no storage in this test')
})
vi.mock('../store', async (real) => ({ ...(await real<object>()), openPhoneStorage: () => opened() }))
vi.mock('../pwa/browser', () => ({ startUpdates: () => null, forgetUpdateMark: () => {} }))

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

beforeEach(() => {
  vi.resetModules()
  opened.mockClear()
  document.body.innerHTML = '<div id="root"></div>'
})
afterEach(() => {
  vi.restoreAllMocks()
  delete (navigator as { standalone?: boolean }).standalone
})

async function start(ua: string, standalone?: boolean) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  if (standalone !== undefined) Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone })
  await act(async () => {
    await import('../main')
    await new Promise((r) => setTimeout(r, 20))
  })
  return document.getElementById('root')!
}

describe('the install gate in the real entry (YAZ-5564)', { timeout: 60_000 }, () => {
  it('Safari tab on an iPhone: the name, why, the three steps with the Share picture; no sign-in, no storage', async () => {
    const root = await start(SAFARI, false)
    expect(root.querySelector('h1')?.textContent).toBe('Yaseen Docs')
    expect(root.textContent).toContain('Install the app first, so your vaults download once.')
    expect([...root.querySelectorAll('ol li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Tap Share.', 'Tap Add to Home Screen.', 'Open Yaseen Docs from its icon on your Home Screen.'])
    expect(root.querySelector('ol li svg[role="img"]')?.getAttribute('aria-label')).toBe('the Share button')
    // No way past it: no field, no button, no link, and no storage opened.
    expect(root.querySelectorAll('input, button, a, form')).toHaveLength(0)
    expect(root.textContent).not.toMatch(/sign in|token|use anyway/i)
    expect(root.textContent).not.toContain('is an app for your phone')
    expect(opened).not.toHaveBeenCalled()
  })

  it('a computer: the same screen and the line that the app is for the phone', async () => {
    const root = await start(MAC_CHROME)
    expect(root.textContent).toContain('Install the app first, so your vaults download once.')
    expect(root.textContent).toContain('Yaseen Docs is an app for your phone. Open this page in Safari on your iPhone.')
    expect(root.querySelectorAll('input, button, form')).toHaveLength(0)
    expect(opened).not.toHaveBeenCalled()
  })

  it('the Home Screen app: no gate, the app opens its storage as before', async () => {
    const root = await start(SAFARI, true)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(root.textContent).not.toContain('Install the app first')
  })
})
