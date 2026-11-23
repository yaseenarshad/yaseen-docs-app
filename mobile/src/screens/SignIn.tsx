import { useRef, useState, type FormEvent } from 'react'
import { useApp } from '../app/AppState'
import { FORWARD_LABEL, SAVE_FAILED, signInHelp, type Help } from '../app/help'
import { cleanToken } from '../auth/input'
import type { SignInOutcome } from '../auth/signIn'
import { vaultId } from '../store'
import { Confirm } from './Confirm'
import { Frame, Problem } from './Frame'
import { InstallHint } from './InstallHint'
import { lazyScreen } from './LazyScreen'
import { GITHUB_CHOOSE_REPOS } from '../auth/githubAppConfig'

/** The repo list loads as its own chunk when the person taps "Show my repos". */
const RepoPicker = lazyScreen(() => import('./RepoPicker'), { waiting: <div className="lazy-screen" aria-busy="true" /> })

/**
 * YAZ-5645: `start` is the first step of every mode: one button, "Sign in with GitHub". GitHub asks which repos the app
 * may use; back in the app, the picker lists those repos. "Use a token instead" (decision D4) opens the token steps.
 * YAZ-5408, for a new vault (`first`, `add`):
 * - `token`: the token is the one field. "Show my repos" lists the repos it reaches.
 * - `pick`: the repo list (`RepoPicker`); a tap runs the same sign-in.
 * - `typed`: the fallback, "Type the repo name": the repo field (empty: its example text is never a value) and the token.
 */
type Step = 'start' | 'token' | 'pick' | 'typed'

/**
 * - `first`: the phone has no vault (row F1).
 * - `add`: one more vault, from Settings (decision 13: the same form).
 * - `again`: a new token for a vault on the phone (row N6, "Replace token"). The repo is fixed.
 */
export type SignInMode = { kind: 'first' } | { kind: 'add' } | { kind: 'again'; vault: string }

/**
 * The sign-in screen (decision 13): the token first, then the repo from the token's list. One link
 * "How to make a token" opens "Set up your phone".
 * YAZ-5644: THE ONE SIGN-IN SCREEN, in a browser tab and in the Home Screen app alike: the first sign-in, Add vault and
 * Sign in again all open it (`Shell.tsx`). "Sign in with GitHub" (YAZ-5645) replaces its token form here, and only here.
 */
export function SignIn({ mode }: { mode: SignInMode }) {
  const app = useApp()
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState<Help | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [step, setStep] = useState<Step>('start')
  const [leaving, setLeaving] = useState(false)
  const repoField = useRef<HTMLInputElement>(null)
  /** Set in the same turn as the tap: a second tap before the next render sees it. */
  const checking = useRef(false)
  const again = mode.kind === 'again' ? (app.list.vaults.find((v) => vaultId(v) === mode.vault) ?? null) : null

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (checking.current) return
    if (mode.kind !== 'again' && step === 'token') {
      // The list needs a token: a text that is not one says so here, with no call.
      if (cleanToken(token) === null) return setHelp(signInHelp({ kind: 'bad-token' }))
      setHelp(null)
      return setStep('pick')
    }
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

  const typed = () => {
    setHelp(null)
    setStep('typed')
  }
  /** Same window: the Home Screen app keeps the sign-in (iOS opens github.com in a sheet and comes back). */
  const toGithub = (another = false) => {
    if (leaving) return
    setLeaving(true)
    setHelp(null)
    void app.signInWithGithub(mode, another).catch(() => (setLeaving(false), setHelp(SAVE_FAILED)))
  }
  const existingGithub = mode.kind === 'add' && step === 'start' && app.github.kind === 'none' ? (app.githubAccounts[0] ?? null) : null
  const picking = mode.kind !== 'again' ? (app.github.kind === 'picking' ? app.github.login : existingGithub) : null
  const chooseRepos = () => void app.manageRepos('picker', picking ?? undefined).catch(() => (app.services.goToGithub ?? ((to: string) => location.assign(to)))(GITHUB_CHOOSE_REPOS))
  const useToken = () => {
    app.endGithub()
    setHelp(null)
    setStep('token')
  }
  const failed = app.github.kind === 'failed' ? app.github.help : null
  const retrySelectAccount = app.github.kind === 'failed' && app.github.selectAccount === true
  const ready = app.phase === 'ready'
  const title = mode.kind === 'first' ? 'Yaseen Docs' : mode.kind === 'add' ? 'Add a vault' : 'Sign in again'
  return (
    <Frame title={title} back={mode.kind === 'first' || (mode.kind === 'again' && !ready) ? undefined : () => app.go({ type: 'back' })}>
      {mode.kind !== 'again' && (step === 'start' || step === 'token') && picking === null && <InstallHint />}
      {picking !== null ? (
        <RepoPicker
          source={{ kind: 'github', login: picking }}
          onOtherToken={useToken}
          onTyped={() => (app.endGithub(), typed())}
          onChooseRepos={chooseRepos}
          onSignInGithub={() => toGithub()}
          onAnotherAccount={mode.kind === 'add' ? () => toGithub(true) : undefined}
        />
      ) : step === 'start' ? (
        <div className="stack">
          {mode.kind === 'first' && <p className="lead">Your vault is a repo on GitHub. Sign in, then choose it.</p>}
          {mode.kind === 'add' && <p className="lead">Sign in with GitHub, then choose the repo.</p>}
          {again !== null && <p className="lead">{`GitHub needs you to sign in again for ${again.repo}.${app.unit(' The pages on this phone stay.')}`}</p>}
          {failed !== null && <Problem message={failed.message} action={FORWARD_LABEL[failed.forward]} onAction={() => (failed.forward === 'choose-repos' ? chooseRepos() : toGithub(retrySelectAccount))} />}
          <button type="button" className="btn btn--primary" disabled={leaving} aria-busy={leaving} onClick={() => toGithub(retrySelectAccount)}>
            {leaving ? 'Opening GitHub…' : 'Sign in with GitHub'}
          </button>
          {mode.kind !== 'again' && <p className="muted">GitHub asks which repos Yaseen Docs may use. Access then renews by itself.</p>}
          {help !== null && <Problem message={help.message} action={FORWARD_LABEL[help.forward]} onAction={() => toGithub(retrySelectAccount)} />}
          <div className="repo-picker__ways">
            <button type="button" className="link-btn" onClick={useToken}>
              Use a token instead
            </button>
            {(mode.kind === 'add' || mode.kind === 'again') && (
              <button type="button" className="link-btn" onClick={() => toGithub(true)}>
                Another GitHub account
              </button>
            )}
          </div>
        </div>
      ) : step === 'pick' && mode.kind !== 'again' ? (
        <RepoPicker source={{ kind: 'token', token }} onOtherToken={() => setStep('token')} onTyped={typed} />
      ) : (
      <form className="stack" onSubmit={submit} noValidate>
        {mode.kind === 'first' && <p className="lead">Paste your GitHub token. Then choose the repo of your vault.</p>}
        {mode.kind === 'add' && <p className="lead">Paste a GitHub token. Then choose the repo.</p>}
        {again !== null && <p className="lead">{`GitHub needs a new token for ${again.repo}.${app.unit(' The pages on this phone stay.')}`}</p>}
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
        {step === 'typed' && mode.kind !== 'again' && (
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
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          {busy ? 'Checking…' : mode.kind === 'again' ? 'Save token' : step === 'token' ? 'Show my repos' : 'Connect vault'}
        </button>
        {help !== null && <Problem message={help.message} action={FORWARD_LABEL[help.forward]} onAction={forward} />}
        <div className="repo-picker__ways">
          {mode.kind !== 'again' &&
            (step === 'token' ? (
              <button type="button" className="link-btn" onClick={typed}>
                Type the repo name
              </button>
            ) : (
              <button type="button" className="link-btn" onClick={() => (setHelp(null), setStep('token'))}>
                Choose from my repos
              </button>
            ))}
          <button type="button" className="link-btn" onClick={() => (setHelp(null), setStep('start'))}>
            Sign in with GitHub instead
          </button>
          {/* Said once: a token problem already offers the guide. */}
          {help?.forward !== 'token-guide' && (
            <button type="button" className="link-btn" onClick={() => app.go({ type: 'open', route: { kind: 'guide' } })}>
              How to make a token
            </button>
          )}
        </div>
      </form>
      )}
      {mode.kind === 'again' && !ready && again !== null && (
        <div>
          {asking ? (
            <Confirm
              question={`Remove ${again.repo} from this phone?${app.unit(' Its pages on this phone go, and answers that are not sent yet are lost. The repo on GitHub does not change.')}`}
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
