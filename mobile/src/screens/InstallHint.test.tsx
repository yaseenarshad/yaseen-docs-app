// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HINT_KEY } from '../store/hintPref'
import { GOOD, mount, signInWithForm, type Harness } from './testing'

/**
 * YAZ-5644: the install hint, a light line on the sign-in and in Settings, only in a phone's or a tablet's browser tab.
 * The tab runs the whole app (no wall): the sign-in form is right there.
 */
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

let h: Harness | null = null
beforeEach(() => localStorage.clear())
afterEach(() => {
  h?.unmount()
  h = null
  vi.restoreAllMocks()
  delete (navigator as { standalone?: boolean }).standalone
  delete (navigator as { maxTouchPoints?: number }).maxTouchPoints
})
const card = (x: Harness) => x.host.querySelector('section.install')
const as = (ua: string, touch = 0) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  // jsdom has no `maxTouchPoints`: an own value for this test.
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touch })
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(/Macintosh/.test(ua) ? 'MacIntel' : 'iPhone')
}

describe('the install hint', () => {
  it('Safari on an iPhone: ONE light line above the sign-in form; How opens the steps, the ☰ picture, the why and the copy note', async () => {
    as(SAFARI)
    h = await mount()
    const c = card(h)!
    expect(c).not.toBeNull()
    expect(c.compareDocumentPosition(h.host.querySelector('form')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(c.querySelector('.install__line')?.textContent).toBe('Add Yaseen Docs to your Home Screen. It opens like an app.')
    expect(c.querySelectorAll('ol li')).toHaveLength(0)
    expect(h.button('How')?.getAttribute('aria-expanded')).toBe('false')
    await h.click('How')
    expect(h.button('How')?.getAttribute('aria-expanded')).toBe('true')
    // Yaseen's order on iOS 26; the first tap is the drawn ☰ (three lines), with a VoiceOver name.
    expect([...c.querySelectorAll('ol li')].map((li) => li.textContent!.replace(/\s+/g, ' '))).toEqual(['Tap at the left of the address bar.', 'Tap Share.', 'Tap View More.', 'Tap Add to Home Screen.'])
    expect(c.querySelector('ol li svg[role="img"]')?.getAttribute('aria-label')).toBe('the three lines')
    expect(c.textContent).toContain('a square with an arrow up')
    expect(c.textContent).toContain('It opens like an app, works with no signal, and keeps your cards on this phone.')
    expect(c.textContent).toContain('The Home Screen app keeps its own copy of your vault, so you sign in there once more. This tab keeps working too.')
    await h.click('How')
    expect(c.querySelectorAll('ol li')).toHaveLength(0)
    // No wall: the tab signs in here (the old "Sign in from the Home Screen app" line is gone).
    expect(h.text()).not.toContain('Sign in from the Home Screen app')
  })

  it('another iPhone browser, an iPad (it says Macintosh, with touch), Android: each its own steps', async () => {
    as(CHROME_IOS)
    h = await mount()
    await h.click('How')
    expect(card(h)!.textContent).toContain('In Chrome or Firefox, open the Share menu, then tap Add to Home Screen.')
    h.unmount()
    vi.restoreAllMocks()
    as(IPAD, 5)
    h = await mount()
    await h.click('How')
    expect(card(h)!.querySelectorAll('ol li')).toHaveLength(4)
    h.unmount()
    vi.restoreAllMocks()
    as(ANDROID)
    h = await mount()
    await h.click('How')
    expect(card(h)!.textContent).toContain('In Chrome, open the ⋮ menu, then tap Add to Home screen.')
    // An Android Home Screen app shares the browser's data: no "own copy" line.
    expect(card(h)!.textContent).not.toContain('its own copy')
  })

  it('a computer: no hint; the sign-in form is all there is', async () => {
    as(MAC_CHROME)
    h = await mount()
    expect(card(h)).toBeNull()
    expect(h.host.querySelector('input[name="token"]')).not.toBeNull()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    expect(card(h)).toBeNull()
  })

  it('inside the Home Screen app: no hint', async () => {
    as(SAFARI)
    ;(navigator as { standalone?: boolean }).standalone = true
    h = await mount()
    expect(card(h)).toBeNull()
    expect(h.text()).not.toContain('Home Screen')
  })

  it('only on the token step: after "Show my repos" the list has the room', async () => {
    as(SAFARI)
    h = await mount()
    await h.type('Token', GOOD)
    await h.click('Show my repos')
    await h.waitText('Choose the repo of your vault')
    expect(card(h)).toBeNull()
  })

  it('✕ ("Not now") hides it for this browser, and it stays hidden: on the sign-in and in Settings', async () => {
    as(SAFARI)
    h = await mount()
    await h.click('Not now')
    expect(card(h)).toBeNull()
    expect(localStorage.getItem(HINT_KEY)).toBe('hidden')
    h.unmount()
    h = await mount()
    expect(card(h)).toBeNull()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    expect(card(h)).toBeNull()
  })

  it('Settings shows it at the top when not hidden', async () => {
    as(SAFARI)
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    const c = card(h)!
    expect(c).not.toBeNull()
    expect(c.compareDocumentPosition(h.host.querySelector('.section')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
