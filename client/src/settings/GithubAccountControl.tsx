import { useEffect, useState } from 'react'
import type { GithubAuthStatus } from '@shared/types'
import { api } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { GithubTokenControl } from './GithubTokenControl'

/**
 * Unified Mac GitHub App sign-in row (YAZ-6190, D4; Settings › Sync › "GitHub").
 * Mirrors mobile's Settings › GitHub: 1-click Sign in with GitHub, @login, Manage repos ↗,
 * Sign out (with confirmation), and a collapsed "Use a token instead" fallback.
 */
export function GithubAccountControl() {
  const [auth, setAuth] = useState<GithubAuthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [askingSignOut, setAskingSignOut] = useState(false)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    let live = true
    const gh = typeof window !== 'undefined' ? (window as unknown as { yaseenDocs?: { github?: { authStatus?: unknown; onAuthChanged?: unknown } } }).yaseenDocs?.github : undefined
    if (typeof gh?.authStatus === 'function') {
      void api.github.authStatus().then(
        (res) => live && setAuth(res),
        () => live && setAuth({ signedIn: false, hasManualToken: false }),
      )
    } else {
      setAuth({ signedIn: false, hasManualToken: false })
    }
    const unsub = typeof gh?.onAuthChanged === 'function' ? api.github.onAuthChanged((next) => live && setAuth(next)) : () => undefined
    return () => {
      live = false
      unsub()
    }
  }, [])

  const signIn = async () => {
    if (typeof api.github.signIn !== 'function') return
    setBusy(true)
    try {
      setAuth(await api.github.signIn())
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    if (typeof api.github.signOut !== 'function') return
    setBusy(true)
    try {
      setAuth(await api.github.signOut())
    } finally {
      setBusy(false)
    }
  }

  const manageRepos = () => {
    if (typeof api.github.manageRepos !== 'function') return
    void api.github.manageRepos().catch(() => undefined)
  }

  if (auth === null) {
    return <p className="settings__key-status" role="status">…</p>
  }

  return (
    <div className="sync-account">
      {auth.signedIn ? (
        <>
          <p className="settings__key-status is-set" role="status" data-testid="github-account-status">
            <strong>@{auth.login}</strong> · Signed in with GitHub. Access renews by itself.
          </p>
          <div className="settings__options" role="group" aria-label="GitHub account actions">
            <button type="button" className="settings__option" onClick={manageRepos} disabled={busy}>
              Manage repos on GitHub ↗
            </button>
            <button type="button" className="settings__option" onClick={() => setAskingSignOut(true)} disabled={busy}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="settings__key-status" role="status" data-testid="github-account-status">
            {auth.error ?? (auth.pending ? 'Finish signing in with GitHub in your browser…' : auth.hasManualToken ? 'Using a pasted GitHub token.' : 'Not signed in.')}
          </p>
          <div className="settings__options" role="group" aria-label="GitHub sign-in">
            <button type="button" className="settings__option settings__option--active" onClick={() => void signIn()} disabled={busy}>
              {auth.pending ? 'Open GitHub sign-in again' : 'Sign in with GitHub'}
            </button>
            <button type="button" className="settings__option" onClick={() => setShowToken((v) => !v)} aria-expanded={showToken}>
              {showToken ? 'Hide token' : 'Use a token instead'}
            </button>
          </div>
          {showToken && (
            <div className="sync-account__token">
              <GithubTokenControl />
            </div>
          )}
        </>
      )}

      {askingSignOut && (
        <ConfirmSheet
          labelId="sign-out-github-text"
          text={
            <>
              <span className="confirm__title">Sign out of @{auth.login} on this Mac?</span>
              Your local files stay on this Mac. Built-in GitHub sync pauses until you sign in again.
            </>
          }
          confirmLabel="Sign out"
          danger
          keys="contained"
          onConfirm={() => {
            setAskingSignOut(false)
            void signOut()
          }}
          onCancel={() => setAskingSignOut(false)}
        />
      )}
    </div>
  )
}
