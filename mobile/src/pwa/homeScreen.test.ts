import { describe, expect, it } from 'vitest'
import { HINT_KEY, hideHint, hintHidden } from '../store/hintPref'
import { HOME_SCREEN, safariLine, whereAmI } from './homeScreen'

/** The install hint (Yaseen: "How do I add it as an app? I can't find those instructions."). */
const SAFARI_26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1'
const FIREFOX_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

describe('whereAmI', () => {
  it('the Home Screen app: standalone (iOS navigator.standalone, or display-mode: standalone)', () => {
    expect(whereAmI({ standalone: true, displayStandalone: false, userAgent: SAFARI_26 })).toBe('standalone')
    expect(whereAmI({ displayStandalone: true, userAgent: ANDROID })).toBe('standalone')
  })
  it('Safari on an iPhone, and on an iPad (it says Macintosh, with touch)', () => {
    expect(whereAmI({ standalone: false, displayStandalone: false, userAgent: SAFARI_26 })).toBe('ios-safari')
    expect(whereAmI({ standalone: false, displayStandalone: false, userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios-safari')
  })
  it('another iPhone browser', () => {
    expect(whereAmI({ displayStandalone: false, userAgent: CHROME_IOS })).toBe('ios-other')
    expect(whereAmI({ displayStandalone: false, userAgent: FIREFOX_IOS })).toBe('ios-other')
  })
  it('not an iPhone: a Mac, Android', () => {
    expect(whereAmI({ displayStandalone: false, userAgent: MAC_CHROME, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('not-ios')
    expect(whereAmI({ displayStandalone: false, userAgent: ANDROID })).toBe('not-ios')
  })
})

describe('the words: one source for the app and the /friend page', () => {
  it("Yaseen's real iOS 26 order: ☰ at the left of the address bar, Share, View More, Add to Home Screen", () => {
    expect(HOME_SCREEN.safari.map((s) => s.tap)).toEqual(['☰', 'Share', 'View More', 'Add to Home Screen'])
    expect(HOME_SCREEN.safari[0].where).toBe('at the left of the address bar')
    expect(safariLine()).toBe('In Safari, tap ☰ at the left of the address bar, then Share, then View More, then Add to Home Screen.')
    expect(HOME_SCREEN.olderSafari).toContain('a square with an arrow up')
    expect(HOME_SCREEN.why).toBe('It opens like an app, works with no signal, and keeps your cards on this phone.')
    expect(HOME_SCREEN.apart).toContain('Add it first, then sign in from the Home Screen app.')
    expect(HOME_SCREEN.notIos).toBe('Open this page in Safari on your iPhone to add it to your Home Screen.')
  })
})

describe('"Not now"', () => {
  it('hides the hint for this browser; a storage that throws is no hide and no throw', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    expect(hintHidden(storage)).toBe(false)
    hideHint(storage)
    expect(hintHidden(storage)).toBe(true)
    expect([...data.keys()]).toEqual([HINT_KEY])
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(hintHidden(broken)).toBe(false)
    expect(() => hideHint(broken)).not.toThrow()
    expect(hintHidden(null)).toBe(false)
  })
})
