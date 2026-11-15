// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOOD, mount, signInWithForm, type Harness } from './testing'

/** The install hint on the sign-in screen and in Settings. */
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1'

let h: Harness | null = null
beforeEach(() => localStorage.clear())
afterEach(() => {
  h?.unmount()
  h = null
  vi.restoreAllMocks()
  delete (navigator as { standalone?: boolean }).standalone
})
const card = (x: Harness) => x.host.querySelector('section.install')
const asIphone = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)

describe('the install hint', () => {
  it('Safari on an iPhone: the card is at the top, BEFORE the sign-in form, with the steps, the ☰ picture, the why and the data note', async () => {
    asIphone(SAFARI)
    h = await mount()
    const c = card(h)!
    expect(c).not.toBeNull()
    expect(c.compareDocumentPosition(h.host.querySelector('form')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(c.querySelector('h2')?.textContent).toBe('Add Notecard to your Home Screen')
    // Yaseen's order on iOS 26; the first tap is the drawn ☰ (three lines), with a VoiceOver name.
    expect([...c.querySelectorAll('ol li')].map((li) => li.textContent!.replace(/\s+/g, ' '))).toEqual(['Tap at the left of the address bar.', 'Tap Share.', 'Tap View More.', 'Tap Add to Home Screen.'])
    expect(c.querySelector('ol li svg[role="img"]')?.getAttribute('aria-label')).toBe('the three lines')
    expect(c.textContent).toContain('a square with an arrow up')
    expect(c.textContent).toContain('It opens like an app, works with no signal, and keeps your cards on this phone.')
    expect(c.textContent).toContain('Add it first, then sign in from the Home Screen app.')
    // The form says the same in one line.
    expect(h.host.querySelector('form')!.textContent).toContain('Sign in from the Home Screen app')
  })

  it('another iPhone browser: its own short line', async () => {
    asIphone(CHROME_IOS)
    h = await mount()
    expect(card(h)!.textContent).toContain('In Chrome or Firefox, open the Share menu, then tap Add to Home Screen.')
  })

  it('not an iPhone: one line', async () => {
    h = await mount()
    expect(card(h)!.textContent).toContain('Open this page in Safari on your iPhone to add it to your Home Screen.')
    expect(h.host.querySelector('form')!.textContent).not.toContain('Sign in from the Home Screen app')
  })

  it('inside the Home Screen app: no card, no line', async () => {
    asIphone(SAFARI)
    ;(navigator as { standalone?: boolean }).standalone = true
    h = await mount()
    expect(card(h)).toBeNull()
    expect(h.text()).not.toContain('Home Screen app')
  })

  it('only on the token step: after "Show my repos" the list has the room', async () => {
    asIphone(SAFARI)
    h = await mount()
    await h.type('Token', GOOD)
    await h.click('Show my repos')
    await h.waitText('Choose the repo of your vault')
    expect(card(h)).toBeNull()
  })

  it('"Not now" hides it for this browser, on the sign-in and in Settings', async () => {
    asIphone(SAFARI)
    h = await mount()
    await h.click('Not now')
    expect(card(h)).toBeNull()
    h.unmount()
    h = await mount()
    expect(card(h)).toBeNull()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    expect(card(h)).toBeNull()
  })

  it('Settings shows it at the top when not hidden', async () => {
    asIphone(SAFARI)
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    const c = card(h)!
    expect(c).not.toBeNull()
    expect(c.compareDocumentPosition(h.host.querySelector('.section')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
