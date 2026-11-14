/**
 * "GitHub token" (YAZ-5098; round 12, item 8: Settings › Review › "Phone and friends"): the one place the token is
 * pasted on the Mac. One token for "Connect your phone" and for friends (4E5, YAZ-5086). The field is not React state:
 * the token is read from the field on Save, sent to main once (`secrets:set`), and the field is emptied. The row's
 * whole read-back is `secrets:has`. With no token, the row tells how to make one (decisions 13 and 17).
 */
import { useRef, useState } from 'react'
import { removeGithubToken, saveGithubToken, useGithubTokenSaved } from './githubToken'

const PROBLEM = {
  'not-a-token': 'This is not a GitHub token. A token has only letters, digits and _.',
  failed: 'The token could not be saved.',
  'not-removed': 'The token could not be removed.',
} as const

export function GithubTokenControl() {
  const saved = useGithubTokenSaved()
  const field = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<keyof typeof PROBLEM | null>(null)

  const save = async () => {
    const input = field.current
    if (input === null) return
    const pasted = input.value
    setBusy(true)
    const result = await saveGithubToken(pasted)
    setBusy(false)
    if (result === 'saved') {
      input.value = ''
      setTyped(false)
      setProblem(null)
    } else setProblem(result)
  }

  const remove = async () => {
    setBusy(true)
    const done = await removeGithubToken()
    setBusy(false)
    setProblem(done ? null : 'not-removed')
  }

  const status = problem !== null ? PROBLEM[problem] : saved === null ? '…' : saved ? '✓ Token saved.' : 'No token saved.'
  return (
    <>
      <p className={saved === true && problem === null ? 'settings__key-status is-set' : 'settings__key-status'} role="status" data-testid="github-token-status">
        {status}
      </p>
      {saved === false && (
        <ol className="settings__steps">
          <li>On GitHub, open Settings › Developer settings › Personal access tokens › Fine-grained tokens, and click Generate new token.</li>
          <li>Give it access to your vault repos.</li>
          <li>Give it two permissions: Contents (Read and write) and Gists (Read and write).</li>
          <li>Copy the token and paste it here.</li>
        </ol>
      )}
      <div className="settings__options" role="group" aria-label="GitHub token">
        <input
          ref={field}
          type="password"
          className="settings__input settings__input--fill"
          aria-label="GitHub token"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? 'Paste a new token to replace it' : 'Paste your token'}
          onInput={(e) => setTyped(e.currentTarget.value !== '')}
          disabled={busy}
        />
        <button type="button" className="settings__option" onClick={() => void save()} disabled={busy || !typed}>
          Save
        </button>
        <button type="button" className="settings__option" onClick={() => void remove()} disabled={busy || saved !== true}>
          Remove token
        </button>
      </div>
    </>
  )
}
