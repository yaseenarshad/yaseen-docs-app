import { useEffect, useRef, useState } from 'react'
import type { AutoSyncStatus, GithubAuthStatus, GithubInstalledRepo, SettingsState } from '@shared/types'
import { api } from '../api'
import type { ReadOnlyVaultState } from '../vault/readOnlyVault'
import { Segmented } from './controls'
import { ON_OFF_OPTIONS, SHOW_HIDE_OPTIONS } from './options'
import type { SettingsSyncCtx } from './SyncVaultControl'

export type CardsWizardStep = 'sync' | 'readonly' | 'friends' | 'learn'

const STEPS: readonly { id: 'ids' | CardsWizardStep; num: number; label: string }[] = [
  { id: 'ids', num: 1, label: 'Page IDs' },
  { id: 'sync', num: 2, label: 'Cloud Sync' },
  { id: 'readonly', num: 3, label: 'Read Only' },
  { id: 'friends', num: 4, label: 'Friends' },
  { id: 'learn', num: 5, label: 'Learn & Skills' },
]

function hasGithubBridgeMethod(name: 'authStatus' | 'signIn' | 'onAuthChanged' | 'listRepos' | 'connectRepo' | 'manageRepos'): boolean {
  if (typeof window === 'undefined') return false
  const gh = (window as unknown as { yaseenDocs?: { github?: Record<string, unknown> } }).yaseenDocs?.github
  return typeof gh?.[name] === 'function'
}

export interface CardsSetupWizardProps {
  autoSync: AutoSyncStatus
  sync?: SettingsSyncCtx
  root?: string
  readOnlyVault?: Pick<ReadOnlyVaultState, 'settings' | 'save'>
  settings: SettingsState
  onChange: (next: SettingsState) => void
  openCourse?: () => void
  alreadySynced: boolean
  onClose: () => void
}

/**
 * 5-step Cards onboarding walkthrough (YAZ-6225): opens right after Cards (and Page IDs) turn on
 * for a vault. Walks the user through Cloud Sync (with Docs App Sync as the #1 primary path and
 * inline GitHub sign-in + repo connection), Read Only protection, Friends education, and the
 * default Card Skill + Cards Course finish step.
 */
export function CardsSetupWizard({
  autoSync,
  sync,
  root,
  readOnlyVault,
  settings,
  onChange,
  openCourse,
  alreadySynced,
  onClose,
}: CardsSetupWizardProps) {
  const [step, setStep] = useState<CardsWizardStep>(alreadySynced ? 'readonly' : 'sync')
  const [syncDone, setSyncDone] = useState(alreadySynced)
  const [busy, setBusy] = useState(false)
  const [waitingSignIn, setWaitingSignIn] = useState(false)
  const [pickingRepo, setPickingRepo] = useState(false)
  const [repos, setRepos] = useState<GithubInstalledRepo[] | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef(true)

  const needsRepo = sync?.status?.repo === undefined || sync.status.repo.remoteUrl === null

  useEffect(() => {
    liveRef.current = true
    const before = document.activeElement
    dialogRef.current?.focus()
    return () => {
      liveRef.current = false
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const loadRepos = async () => {
    if (!hasGithubBridgeMethod('listRepos')) {
      sync?.setEnabled(true)
      setSyncDone(true)
      setStep('readonly')
      return
    }
    setPickingRepo(true)
    setFeedback(null)
    setRepos(null)
    try {
      const list = await api.github.listRepos()
      if (!liveRef.current) return
      setRepos(list)
    } catch {
      if (!liveRef.current) return
      setRepos([])
      setFeedback('Could not load your GitHub repositories. Try again.')
    }
  }

  const finishDocsAppSync = async (auth: GithubAuthStatus | null) => {
    if (needsRepo && root !== undefined && auth?.signedIn === true && hasGithubBridgeMethod('listRepos')) {
      await loadRepos()
      return
    }
    sync?.setEnabled(true)
    if (!liveRef.current) return
    setSyncDone(true)
    setFeedback(null)
    setStep('readonly')
  }

  useEffect(() => {
    if (!waitingSignIn || !hasGithubBridgeMethod('onAuthChanged')) return
    return api.github.onAuthChanged((next) => {
      if (!liveRef.current) return
      if (next.signedIn) {
        setWaitingSignIn(false)
        void finishDocsAppSync(next)
      } else if (next.error !== undefined) {
        setWaitingSignIn(false)
        setFeedback(next.error)
      }
    })
  }, [waitingSignIn, needsRepo, root, sync]) // eslint-disable-line react-hooks/exhaustive-deps -- reacts to sign-in completion

  const goToStep = (next: CardsWizardStep) => {
    if (next !== 'sync') {
      setWaitingSignIn(false)
      setPickingRepo(false)
    }
    setStep(next)
  }

  const handleDocsAppSync = async () => {
    if (syncDone) return
    setBusy(true)
    setFeedback(null)
    try {
      const auth = hasGithubBridgeMethod('authStatus') ? await api.github.authStatus().catch(() => null) : null
      if (!liveRef.current) return
      if (auth !== null && !auth.signedIn && !auth.hasManualToken && hasGithubBridgeMethod('signIn')) {
        const res = await api.github.signIn()
        if (!liveRef.current) return
        if (res.signedIn) {
          await finishDocsAppSync(res)
          return
        }
        if (res.error !== undefined && res.error !== '') {
          setFeedback(res.error)
          return
        }
        setWaitingSignIn(true)
        setFeedback('Finish signing in with GitHub in your browser. This step continues automatically.')
        return
      }
      await finishDocsAppSync(auth)
    } catch {
      if (liveRef.current) setFeedback('Could not start GitHub sign-in. Try again.')
    } finally {
      if (liveRef.current) setBusy(false)
    }
  }

  const handlePickRepo = async (fullName: string) => {
    if (root === undefined || !hasGithubBridgeMethod('connectRepo')) return
    setBusy(true)
    setFeedback(null)
    try {
      const res = await api.github.connectRepo(root, fullName)
      if (!liveRef.current) return
      if (res.ok) {
        setPickingRepo(false)
        setSyncDone(true)
        setStep('readonly')
      } else {
        setFeedback(res.error ?? 'Could not connect this folder to GitHub.')
      }
    } catch {
      if (liveRef.current) setFeedback('Could not connect this folder to GitHub. Try again.')
    } finally {
      if (liveRef.current) setBusy(false)
    }
  }

  const handleAutoSync = async () => {
    if (syncDone) return
    if (sync?.addToAutoSync === undefined) {
      setStep('readonly')
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const res = await sync.addToAutoSync()
      if (!liveRef.current) return
      if (res.ok && res.method === 'deep-link') {
        setSyncDone(true)
        setStep('readonly')
      } else if (res.ok) {
        setFeedback('Opened GitHub AutoSync. Click Add folder there, then continue.')
      } else {
        setFeedback('Could not open GitHub AutoSync.')
      }
    } catch {
      if (liveRef.current) setFeedback('Could not open GitHub AutoSync.')
    } finally {
      if (liveRef.current) setBusy(false)
    }
  }

  const activeIdx = STEPS.findIndex((s) => s.id === step)

  return (
    <div className="confirm-overlay" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="cards-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cards-wizard-title"
        data-testid="cards-setup-wizard"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cards-wizard__head">
          <span className="cards-wizard__kicker">Cards setup</span>
          <button type="button" className="cards-wizard__close" aria-label="Close Cards setup" onClick={onClose}>
            ×
          </button>
        </div>

        <nav className="cards-wizard__stepper" aria-label="Cards setup steps">
          {STEPS.map((s, idx) => {
            const isCurrent = s.id === step
            const isDone = s.id === 'ids' || (s.id === 'sync' && syncDone && !isCurrent) || idx < activeIdx
            const cls = [
              'cards-wizard__pill',
              isCurrent ? 'cards-wizard__pill--active' : '',
              isDone && !isCurrent ? 'cards-wizard__pill--done' : '',
            ]
              .filter(Boolean)
              .join(' ')
            if (s.id === 'ids') {
              return (
                <span key={s.id} className={cls} aria-current={undefined}>
                  ✓ 1. {s.label}
                </span>
              )
            }
            const target = s.id
            return (
              <button
                key={s.id}
                type="button"
                className={cls}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => goToStep(target)}
              >
                {isDone && !isCurrent ? `✓ ${s.num}. ` : `${s.num}. `}
                {s.label}
              </button>
            )
          })}
        </nav>

        {step === 'sync' && (
          <div className="cards-wizard__body" data-testid="cards-wizard-step-sync">
            <h2 className="cards-wizard__title" id="cards-wizard-title">
              Sync this vault to review on your phone?
            </h2>
            <p className="cards-wizard__desc">
              Page IDs and Cards are on. Sync to GitHub so you can review cards on your phone at{' '}
              <strong>docs.yaseenarshad.com</strong>. Pick <strong>Docs App Sync</strong> below, or add this folder to{' '}
              <strong>GitHub AutoSync</strong> if you use that app. Pick only one so both do not clash.
            </p>

            {syncDone && (
              <p className="cards-wizard__status" role="status">
                {autoSync.vaultSynced
                  ? 'Synced by GitHub AutoSync. Keep Docs App Sync off so both do not clash.'
                  : 'Cloud sync is on for this vault.'}
              </p>
            )}

            {pickingRepo && (
              <div className="cards-wizard__repos" data-testid="wizard-repo-picker">
                <p className="cards-wizard__subhead">Choose a GitHub repository for this vault</p>
                {repos === null ? (
                  <p className="setting__hint">Loading your repositories…</p>
                ) : repos.length === 0 ? (
                  <div className="cards-wizard__repo-list">
                    <span className="setting__hint">No repositories allowed yet.</span>
                    {hasGithubBridgeMethod('manageRepos') && (
                      <button type="button" className="settings__option" onClick={() => void api.github.manageRepos()}>
                        Choose repos on GitHub ↗
                      </button>
                    )}
                    <button type="button" className="settings__option" onClick={() => void loadRepos()}>
                      Refresh list
                    </button>
                  </div>
                ) : (
                  <div className="cards-wizard__repo-list" role="group" aria-label="Choose a GitHub repository">
                    {repos.map((r) => (
                      <button
                        key={r.fullName}
                        type="button"
                        className="settings__option"
                        disabled={busy}
                        onClick={() => void handlePickRepo(r.fullName)}
                      >
                        {r.fullName}
                      </button>
                    ))}
                    {hasGithubBridgeMethod('manageRepos') && (
                      <button type="button" className="settings__option" disabled={busy} onClick={() => void api.github.manageRepos()}>
                        Choose other repos ↗
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {feedback !== null && (
              <p className="setting__hint" role="status">
                {feedback}
              </p>
            )}

            <div className="cards-wizard__actions">
              {!syncDone && !pickingRepo && (
                <button
                  type="button"
                  className="confirm__btn cards-wizard__btn--primary"
                  disabled={busy || waitingSignIn}
                  onClick={() => void handleDocsAppSync()}
                >
                  {waitingSignIn ? 'Waiting for GitHub sign-in…' : 'Use Docs App Sync'}
                </button>
              )}
              {!syncDone && autoSync.installed && !pickingRepo && (
                <button
                  type="button"
                  className="confirm__btn"
                  disabled={busy || waitingSignIn}
                  onClick={() => void handleAutoSync()}
                >
                  Add to GitHub AutoSync
                </button>
              )}
              <button
                type="button"
                className={syncDone ? 'confirm__btn cards-wizard__btn--primary' : 'confirm__btn'}
                disabled={busy}
                onClick={() => goToStep('readonly')}
              >
                {syncDone ? 'Next: Read Only →' : 'Not now'}
              </button>
            </div>
          </div>
        )}

        {step === 'readonly' && (
          <div className="cards-wizard__body" data-testid="cards-wizard-step-readonly">
            <h2 className="cards-wizard__title" id="cards-wizard-title">
              Protect this vault with Read Only?
            </h2>
            <p className="cards-wizard__desc">
              Turn on <strong>Read Only</strong> so pages open locked and stray edits cannot happen while you review cards.
              You can unlock one page or the whole vault anytime from the lock button in the sidebar.
            </p>
            {readOnlyVault !== undefined && (
              <div className="cards-wizard__row">
                <span className="cards-wizard__row-label">Read only for this vault</span>
                <Segmented
                  options={ON_OFF_OPTIONS}
                  value={readOnlyVault.settings.on}
                  onChange={(on) => readOnlyVault.save({ on })}
                  ariaLabel="Read only for this vault"
                />
              </div>
            )}
            <div className="cards-wizard__footer">
              <button type="button" className="confirm__btn" onClick={() => setStep('sync')}>
                ← Back
              </button>
              <button type="button" className="confirm__btn cards-wizard__btn--primary" onClick={() => setStep('friends')}>
                Next: Friends →
              </button>
            </div>
          </div>
        )}

        {step === 'friends' && (
          <div className="cards-wizard__body" data-testid="cards-wizard-step-friends">
            <h2 className="cards-wizard__title" id="cards-wizard-title">
              Stay accountable with Friends
            </h2>
            <p className="cards-wizard__desc">
              Friends shares only your study numbers (cards reviewed, minutes, and streaks) — never your card text or page
              titles. Counting is on by default once you sign in with GitHub and add a friend or join a group.
            </p>
            <ul className="cards-wizard__list">
              <li>
                <strong>Desktop:</strong> Open <strong>Inbox</strong>, then click the <strong>Friends icon</strong> in the top-right bar.
              </li>
              <li>
                <strong>Phone (docs.yaseenarshad.com):</strong> Tap the <strong>Friends</strong> tab at the bottom.
              </li>
              <li>
                <strong>Settings:</strong> Open <strong>Settings › Cards › Friends</strong> to choose which vaults count or delete your Friends data.
              </li>
            </ul>
            <div className="cards-wizard__footer">
              <button type="button" className="confirm__btn" onClick={() => setStep('readonly')}>
                ← Back
              </button>
              <button type="button" className="confirm__btn cards-wizard__btn--primary" onClick={() => setStep('learn')}>
                Next: Learn &amp; Skills →
              </button>
            </div>
          </div>
        )}

        {step === 'learn' && (
          <div className="cards-wizard__body" data-testid="cards-wizard-step-learn">
            <h2 className="cards-wizard__title" id="cards-wizard-title">
              Card Skill &amp; Cards Course
            </h2>
            <div className="cards-wizard__row">
              <div>
                <div className="cards-wizard__row-label">Card skill in the sidebar</div>
                <div className="cards-wizard__row-hint">
                  A read-only guide for you and your AI agent on how to write good cards.
                </div>
              </div>
              <Segmented
                options={SHOW_HIDE_OPTIONS}
                value={settings.cardSkillInSidebar}
                onChange={(cardSkillInSidebar) => onChange({ ...settings, cardSkillInSidebar })}
                ariaLabel="Card skill in the sidebar"
              />
            </div>
            <div className="cards-wizard__course">
              <div className="cards-wizard__row-label">Cards Course</div>
              <p className="cards-wizard__desc">
                New to cards? Take the short interactive Cards Course to learn how to write, schedule, and review cards in minutes.
              </p>
            </div>
            <div className="cards-wizard__footer">
              <button type="button" className="confirm__btn" onClick={() => setStep('friends')}>
                ← Back
              </button>
              <div className="cards-wizard__footer-right">
                <button
                  type="button"
                  className={openCourse !== undefined ? 'confirm__btn' : 'confirm__btn cards-wizard__btn--primary'}
                  onClick={onClose}
                >
                  Done
                </button>
                {openCourse !== undefined && (
                  <button
                    type="button"
                    className="confirm__btn cards-wizard__btn--primary"
                    onClick={() => {
                      onClose()
                      openCourse()
                    }}
                  >
                    Start Cards Course
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
