import { useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
import { vaultId } from '../store'
import { Confirm } from '../screens/Confirm'
import './githubPart.css'

/** A GitHub account signed in on this phone, and the repos of the vaults that use it. */
interface Account {
  login: string
  repos: string[]
}

/**
 * Settings › GitHub (YAZ-5645 slice 2, mockup 1), its own chunk: each account signed in with GitHub on this phone,
 * "Manage repos on GitHub" (GitHub's repo page; the Setup URL brings the person back to Settings), "Sign out of this
 * account" (it asks first; the sign-in ends on GitHub too, decision D7), and "Add another GitHub account" (GitHub's
 * account picker). No account (only pasted tokens): nothing shows. No network call: the phone's storage only.
 */
export default function GithubPart() {
  const app = useApp()
  const { tokens } = app.services
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const vaults = app.list.vaults
  useEffect(() => {
    let live = true
    void (async () => {
      const logins = await tokens.githubAccounts()
      const uses = await Promise.all(vaults.map(async (v) => ({ repo: v.repo, login: (await tokens.githubOf(vaultId(v)))?.toLowerCase() ?? null })))
      if (live) setAccounts(logins.map((login) => ({ login, repos: uses.filter((u) => u.login === login.toLowerCase()).map((u) => u.repo) })))
    })().catch(() => live && setAccounts([]))
    return () => {
      live = false
    }
  }, [tokens, vaults])
  if (accounts === null || accounts.length === 0) return null

  const signOut = async (login: string) => {
    setBusy(true)
    try {
      await app.signOutGithub(login)
      setAccounts((all) => all?.filter((a) => a.login !== login) ?? null)
      setAsking(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="section">GitHub</h2>
      <ul className="rows" aria-label="GitHub">
        {accounts.map((a) => (
          <li key={a.login}>
            <div className="row github-account">
              <span className="row__main">
                <strong>@{a.login}</strong>
                <span className="muted github-account__note">
                  {/* YAZ-5659: no "Vaults: …" here, the Vaults section lists them. */}
                  Signed in with GitHub. Access renews by itself.
                </span>
              </span>
            </div>
            <div className="row">
              <button type="button" className="row__button" onClick={() => void app.manageRepos('settings', a.login)}>
                Manage repos on GitHub
              </button>
              <span className="row__side" aria-hidden="true">
                ↗
              </span>
            </div>
            {asking === a.login ? (
              <Confirm
                question={signOutQuestion(a, app.unit)}
                yes="Sign out"
                busy={busy}
                onYes={() => void signOut(a.login)}
                onNo={() => setAsking(null)}
              />
            ) : (
              <div className="row">
                <button type="button" className="row__button btn--danger" aria-label={`Sign out of @${a.login}`} onClick={() => setAsking(a.login)}>
                  Sign out of this account
                </button>
              </div>
            )}
          </li>
        ))}
        <li className="row">
          <button type="button" className="row__button" onClick={() => void app.signInWithGithub({ kind: 'add' }, true)}>
            Add another GitHub account
          </button>
          <span className="row__side" aria-hidden="true">
            +
          </span>
        </li>
      </ul>
    </>
  )
}

/** What signing out of one account does: its vaults stay, readable, and wait for a sign-in again. */
function signOutQuestion(a: Account, unit: (text: string) => string): string {
  const which = a.repos.length === 0 ? '' : ` ${a.repos.join(', ')} stop${a.repos.length === 1 ? 's' : ''} syncing until you sign in again.`
  return `Sign out of @${a.login} on this phone?${which}${unit(' The pages on this phone and answers not sent yet stay.')} The sign-in also ends on GitHub.`
}
