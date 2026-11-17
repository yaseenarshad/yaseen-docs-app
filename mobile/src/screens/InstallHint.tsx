import { useState } from 'react'
import { HOME_SCREEN, browserFacts, hintKind, safariStep } from '../pwa/homeScreen'
import { hideHint, hintHidden } from '../store/hintPref'

/** The three lines that Safari shows at the left of the address bar (iOS 26). */
function MenuIcon() {
  return (
    <svg className="install__icon" viewBox="0 0 20 20" width="20" height="20" role="img" aria-label="the three lines">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/**
 * YAZ-5644: "Add Yaseen Docs to your Home Screen. It opens like an app." One light line at the top of the sign-in and
 * of Settings, only in a browser tab on a phone or a tablet (`hintKind`): never on a computer, never in the Home Screen
 * app. The tab runs the whole app, so this is a choice, never a wall. "How" opens the steps; ✕ ("Not now") hides it for
 * this browser, and it stays hidden.
 */
export function InstallHint() {
  const [hidden, setHidden] = useState(hintHidden)
  const [open, setOpen] = useState(false)
  const kind = hintKind(browserFacts())
  if (kind === null || hidden) return null
  return (
    <section className="install" aria-labelledby="install-title">
      <div className="install__bar">
        <p id="install-title" className="install__line">
          <b>{HOME_SCREEN.title}.</b> {HOME_SCREEN.short}
        </p>
        <button type="button" className="link-btn install__how" aria-expanded={open} aria-controls="install-steps" onClick={() => setOpen(!open)}>
          How
        </button>
        <button
          type="button"
          className="icon-btn install__close"
          aria-label="Not now"
          onClick={() => {
            hideHint()
            setHidden(true)
          }}
        >
          ✕
        </button>
      </div>
      {open && (
        <div id="install-steps" className="install__more">
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
          {kind === 'android' && <p className="install__text">{HOME_SCREEN.android}</p>}
          {kind !== 'android' && <p className="install__text install__apart">{HOME_SCREEN.apart}</p>}
        </div>
      )}
    </section>
  )
}
