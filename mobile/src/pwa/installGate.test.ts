import { describe, expect, it } from 'vitest'
import { asInstalled, gateOf } from './installGate'

/** YAZ-5564: a browser tab or the Home Screen app. */
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

describe('the install gate (YAZ-5564)', () => {
  it('the Home Screen app: navigator.standalone on iOS, or display-mode standalone', () => {
    expect(gateOf({ standalone: true, displayStandalone: false, userAgent: SAFARI })).toBe('app')
    expect(gateOf({ displayStandalone: true, userAgent: ANDROID })).toBe('app')
    expect(gateOf({ standalone: false, displayStandalone: true, userAgent: SAFARI })).toBe('app')
  })

  it('a browser tab on a phone: the steps', () => {
    expect(gateOf({ standalone: false, displayStandalone: false, userAgent: SAFARI })).toBe('phone')
    expect(gateOf({ standalone: false, displayStandalone: false, userAgent: CHROME_IOS })).toBe('phone')
    expect(gateOf({ standalone: false, displayStandalone: false, userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('phone')
    expect(gateOf({ displayStandalone: false, userAgent: ANDROID })).toBe('phone')
  })

  it('a computer: the same screen, with the line that the app is for the phone', () => {
    expect(gateOf({ displayStandalone: false, userAgent: MAC_CHROME, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop')
    expect(gateOf({ displayStandalone: false, userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop')
  })

  it('the dev and fixtures override: `?as-installed` only, never a look-alike', () => {
    expect(gateOf({ displayStandalone: false, userAgent: MAC_CHROME }, true)).toBe('app')
    expect(asInstalled('?as-installed')).toBe(true)
    expect(asInstalled('?x=1&as-installed=1')).toBe(true)
    expect(asInstalled('')).toBe(false)
    expect(asInstalled('?as-installed-not')).toBe(false)
    expect(asInstalled('?installed')).toBe(false)
  })
})
