import { useApp } from '../app/AppState'
import { Fragment } from 'react'
import { HOME_SCREEN, THREE_LINES, safariLine, splitThreeLines } from '../pwa/homeScreen'
import { Frame } from './Frame'

/** GitHub's page that makes a fine-grained token. */
const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/**
 * "Set up your phone" (round 11, item 9): make the repo, make the token, add the app to the Home Screen (YAZ-5644: a
 * choice; a browser tab runs the whole app too). It says the supported setup (round 13, item 4): one GitHub account
 * and one token with Contents and Gists. The token steps are 3E's (proofs 1B and 1C); the permissions are decision 17's.
 */
export function SetupGuide() {
  const app = useApp()
  return (
    <Frame title="Set up your phone" back={() => app.go({ type: 'back' })}>
      <p className="lead">Yaseen Docs works with one GitHub account and one token. Give the token two permissions: Contents and Gists.</p>

      <h2 className="section">1. The repo</h2>
      <ol className="guide-steps">
        <li>Keep your vault in a private GitHub repo. GitHub AutoSync on your Mac keeps it current.</li>
        <li>The vault is the whole repo: its .yaseendocs folder is at the top of the repo.</li>
      </ol>

      <h2 className="section">2. The token</h2>
      <ol className="guide-steps">
        <li>
          On GitHub, open Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token.{' '}
          <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
            Open this page on GitHub
          </a>
        </li>
        <li>Name: Yaseen Docs. Expiration: your choice.</li>
        <li>Repository access: Only select repositories, then your vault repo.</li>
        <li>Repository permissions › Contents: Read and write.</li>
        <li>Account permissions › Gists: Read and write. Friends needs it. Review works without it.</li>
        <li>Generate the token and copy it. Paste it in Yaseen Docs, then choose your vault repo.</li>
      </ol>
      <p className="muted">Or, on your Mac, open Settings › Cards › Connect your phone, and tap Scan a code here.</p>

      <h2 className="section">3. The Home Screen (if you want it)</h2>
      <p className="muted">Yaseen Docs also works in a browser tab, on a phone or a computer.</p>
      <ol className="guide-steps">
        <li>
          <SpokenThreeLines text={safariLine()} />
        </li>
        <li>{HOME_SCREEN.olderSafari}</li>
        <li>Open Yaseen Docs from the Home Screen, and connect your vault there. {HOME_SCREEN.apart.split(', so ')[0]}.</li>
      </ol>
    </Frame>
  )
}

/** The text with each ☰ named for VoiceOver ("the three lines", not "trigram for heaven"). */
function SpokenThreeLines({ text }: { text: string }) {
  return splitThreeLines(text).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && (
        <span role="img" aria-label={THREE_LINES.name}>
          {THREE_LINES.glyph}
        </span>
      )}
      {part}
    </Fragment>
  ))
}

export default SetupGuide
