import { useState } from 'react'
import { HOME_SCREEN, browserFacts, safariStep, whereAmI } from '../pwa/homeScreen'
import { hideHint, hintHidden } from '../store/hintPref'

/** Where this page runs: a browser tab on an iPhone, another browser, or the Home Screen app. */
const runsAs = () => whereAmI(browserFacts())

/** The three lines that Safari shows at the left of the address bar (iOS 26). */
function MenuIcon() {
  return (
    <svg className="install__icon" viewBox="0 0 20 20" width="20" height="20" role="img" aria-label="the three lines">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/**
 * "Add Yaseen Docs to your Home Screen": at the top of the sign-in and of Settings, only in a browser tab (never in the
 * Home Screen app). "Not now" hides it for this browser.
 */
export function InstallHint() {
  const [hidden, setHidden] = useState(hintHidden)
  const kind = runsAs()
  if (kind === 'standalone' || hidden) return null
  return (
    <section className="install" aria-labelledby="install-title">
      <h2 id="install-title" className="install__title">
        {HOME_SCREEN.title}
      </h2>
      <p className="install__text">{HOME_SCREEN.why}</p>
      {kind === 'ios-safari' && (
        <>
          <ol className="guide-steps install__steps">
            {HOME_SCREEN.safari.map((s, i) => (
              <li key={s.tap}>
                {/* The first tap is drawn: the ☰ glyph is small, and VoiceOver reads it as "trigram for heaven". */}
                {i === 0 ? (
                  <>
                    Tap <MenuIcon /> {s.where}.
                  </>
                ) : (
                  safariStep(s)
                )}
              </li>
            ))}
          </ol>
          <p className="muted">{HOME_SCREEN.olderSafari}</p>
        </>
      )}
      {kind === 'ios-other' && <p className="install__text">{HOME_SCREEN.otherIos}</p>}
      {kind === 'not-ios' && <p className="install__text">{HOME_SCREEN.notIos}</p>}
      {kind !== 'not-ios' && <p className="install__text install__apart">{HOME_SCREEN.apart}</p>}
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          hideHint()
          setHidden(true)
        }}
      >
        Not now
      </button>
    </section>
  )
}

/** The sign-in form's one line, on an iPhone outside the Home Screen app. */
export function FormLine() {
  const kind = runsAs()
  return kind === 'ios-safari' || kind === 'ios-other' ? <p className="muted">{HOME_SCREEN.formLine}</p> : null
}
