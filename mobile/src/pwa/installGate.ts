import { whereAmI, type BrowserFacts } from './homeScreen'

/**
 * YAZ-5564: the app runs only as the Home Screen app. In a browser tab it shows one welcome screen (`InstallGate.tsx`):
 * no sign-in and no vault download, so each vault downloads once, in the app. A vault that an old tab already keeps
 * stays where it is (the gate opens no storage).
 *
 * - `app`: the Home Screen app (`navigator.standalone === true` on iOS, or `(display-mode: standalone)`).
 * - `phone`: a browser tab on an iPhone, iPad or Android phone: the steps.
 * - `desktop`: any other browser: the steps, and a line that the app is for the phone.
 */
export type Gate = 'app' | 'phone' | 'desktop'

export const GATE_WORDS = {
  title: 'Yaseen Docs',
  why: 'Install the app first, so your vaults download once.',
  steps: ['Tap Share', 'Tap Add to Home Screen.', 'Open Yaseen Docs from its icon on your Home Screen.'],
  desktop: 'Yaseen Docs is an app for your phone. Open this page in Safari on your iPhone.',
} as const

export function gateOf(f: BrowserFacts, asInstalled = false): Gate {
  const where = whereAmI(f)
  if (asInstalled || where === 'standalone') return 'app'
  return where !== 'not-ios' || /Android/.test(f.userAgent) ? 'phone' : 'desktop'
}

/**
 * The dev and test override: `?as-installed` runs the app in a plain tab, for `npm run mobile:dev` on the Mac and the
 * fixtures build. Only those builds read it: in the real build the test is `false` at build time, so the flag is not
 * in the bundle (`src/firstLoad.test.ts` checks it).
 */
export const asInstalled = (search: string): boolean => (import.meta.env.DEV || import.meta.env.MODE === 'fixtures') && /[?&]as-installed(=|&|$)/.test(search)
