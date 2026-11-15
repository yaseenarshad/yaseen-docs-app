import { GATE_WORDS } from '../pwa/installGate'

/** Safari's Share button: a square with an arrow up. */
function ShareIcon() {
  return (
    <svg className="install__icon" viewBox="0 0 20 20" width="20" height="20" role="img" aria-label="the Share button">
      <path d="M10 2.5v10M6.5 6 10 2.5 13.5 6M7.5 8.5H5.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

/**
 * YAZ-5564: the only screen of a browser tab (`pwa/installGate.ts`): the name, why, and the steps to the Home Screen
 * app. No sign-in, no download, no way past it. `desktop`: one more line, that the app is for the phone.
 */
export function InstallGate({ desktop }: { desktop: boolean }) {
  const [share, ...rest] = GATE_WORDS.steps
  return (
    <div className="app">
      <main className="screen install-gate">
        <h1 className="title">{GATE_WORDS.title}</h1>
        <p className="install__text">{GATE_WORDS.why}</p>
        {desktop && <p className="install__text">{GATE_WORDS.desktop}</p>}
        <ol className="guide-steps install__steps">
          <li>
            {share}
            <ShareIcon />.
          </li>
          {rest.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </main>
    </div>
  )
}
