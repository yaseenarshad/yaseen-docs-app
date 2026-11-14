import { useRef, useState, type FormEvent } from 'react'
import { useApp } from '../app/AppState'
import { FORWARD_LABEL, SAVE_FAILED, signInHelp, type Help } from '../app/help'
import type { SignInOutcome } from '../auth/signIn'
import { vaultId } from '../store'
import { Confirm } from './Confirm'
import { Frame, Problem } from './Frame'

/**
 * - `first`: the phone has no vault (row F1).
 * - `add`: one more vault, from Settings (decision 13: the same form).
 * - `again`: a new token for a vault on the phone (row N6, "Replace token"). The repo is fixed.
 */
export type SignInMode = { kind: 'first' } | { kind: 'add' } | { kind: 'again'; vault: string }

/**
 * The sign-in screen (decision 13): two fields, `owner/repo` and the token, and one button "Connect vault". One link
 * "How to make a token" opens "Set up your phone". "Scan a code" reads the Mac's code (round 11, item 23). The token is
 * pasted here, inside the installed app: Safari and the app do not share storage.
 */
export function SignIn({ mode }: { mode: SignInMode }) {
  const app = useApp()
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState<Help | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const repoField = useRef<HTMLInputElement>(null)
  /** Set in the same turn as the tap: a second tap before the next render sees it (YAZ-5178). */
  const checking = useRef(false)
  const again = mode.kind === 'again' ? (app.list.vaults.find((v) => vaultId(v) === mode.vault) ?? null) : null

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (checking.current) return
    checking.current = true
    setBusy(true)
    setHelp(null)
    let outcome: SignInOutcome
    try {
      outcome = mode.kind === 'again' ? await app.replaceToken(mode.vault, token) : await app.addVault({ repo, token })
    } catch {
      checking.current = false
      setBusy(false)
      setHelp(SAVE_FAILED)
      return
    }
    checking.current = false
    setBusy(false)
    if (outcome.ok) return
    setHelp(signInHelp(outcome.error))
    setOpenId(outcome.error.kind === 'already-added' ? vaultId(outcome.error) : null)
  }

  const forward = () => {
    switch (help?.forward) {
      case 'token-guide':
      case 'repo-guide':
        app.go({ type: 'open', route: { kind: 'guide' } })
        break
      case 'edit-repo':
        repoField.current?.focus()
        break
      case 'open-vault':
        if (openId !== null) void app.switchVault(openId)
        break
      case 'retry':
        void submit()
        break
    }
  }

  const ready = app.phase === 'ready'
  const title = mode.kind === 'first' ? 'Notecards' : mode.kind === 'add' ? 'Add a vault' : 'Sign in again'
  return (
    <Frame title={title} back={mode.kind === 'first' || (mode.kind === 'again' && !ready) ? undefined : () => app.go({ type: 'back' })}>
      <form className="stack" onSubmit={submit} noValidate>
        {mode.kind === 'first' && <p className="lead">Connect the GitHub repo that holds your vault.</p>}
        {again !== null && <p className="lead">{app.unit(`GitHub needs a new token for ${again.repo}. The pages on this phone stay.`)}</p>}
        {mode.kind !== 'again' && (
          <label className="field">
            <span className="field__label">Repo</span>
            <input
              ref={repoField}
              name="repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
            />
          </label>
        )}
        <label className="field">
          <span className="field__label">Token</span>
          <input
            name="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste a GitHub token"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          {busy ? 'Checking…' : mode.kind === 'again' ? 'Save token' : 'Connect vault'}
        </button>
        {help !== null && <Problem message={help.message} action={FORWARD_LABEL[help.forward]} onAction={forward} />}
        {/* Said once: a token problem already offers the guide. */}
        {help?.forward !== 'token-guide' && (
          <div>
            <button type="button" className="link-btn" onClick={() => app.go({ type: 'open', route: { kind: 'guide' } })}>
              How to make a token
            </button>
          </div>
        )}
      </form>
      <p className="section">Or</p>
      <button type="button" className="btn btn--wide" onClick={() => app.go({ type: 'open', route: { kind: 'scan', vault: mode.kind === 'again' ? mode.vault : undefined } })}>
        Scan a code
      </button>
      <p className="muted">On your Mac: Settings › Review › Connect your phone.</p>
      {mode.kind === 'again' && !ready && again !== null && (
        <div>
          {asking ? (
            <Confirm
              question={app.unit(`Remove ${again.repo} from this phone? Its pages on this phone go, and answers that are not sent yet are lost. The repo on GitHub does not change.`)}
              yes="Remove"
              onYes={() => void app.removeVault(mode.vault)}
              onNo={() => setAsking(false)}
            />
          ) : (
            <button type="button" className="link-btn btn--danger" onClick={() => setAsking(true)}>
              Remove from this phone
            </button>
          )}
        </div>
      )}
    </Frame>
  )
}
