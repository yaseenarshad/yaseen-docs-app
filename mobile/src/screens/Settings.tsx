import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
import { deviceZone, isTimeZone } from '@shared/timeZone'
import { FRIENDS_ENABLED } from '@shared/features'
import { cleanNickname, type FriendsPort } from '../app/friendsPort'
import { friendsMessage } from '../auth/friends'
import { serviceOf } from '../friends/ui/lazy'
import { BUILD, buildLine, versionWords } from '../settings/buildInfo'
import { AppearancePart } from '../settings/AppearancePart'
import { UpdateCheck } from '../settings/UpdateCheck'
import { vaultTitle } from '../settings/vaultTitle'
import { PHONE, vaultId, type PhoneVault } from '../store'
import { Confirm } from './Confirm'
import { eraseQuestion, unsentOnPhone, waitingRemoves } from './eraseWords'
import { Frame, Problem } from './Frame'
import { VaultBadge, vaultNumber } from './VaultBadge'
import { InstallHint } from './InstallHint'
import { lazyScreen } from './LazyScreen'

/** The list of What's new, its own chunk: it loads when the person first opens it, never in the first load. */
const WhatsNewList = lazyScreen(() => import('../settings/WhatsNewList'), { waiting: <p className="muted" aria-busy="true">Loading…</p> })
/** YAZ-5559: Vault health, read only, its own chunk (with the shared list of the vault's settings files). */
const VaultHealth = lazyScreen(() => import('../settings/VaultHealth'), { waiting: <p className="muted" aria-busy="true">Vault health…</p> })
/** YAZ-5592: "This vault on mobile" (Folding, Sticky headings), the vault's `.yaseendocs/mobile.json`, its own chunk. */
const MobileVaultPart = lazyScreen(() => import('../settings/MobileVaultPart'))
/** YAZ-5645 slice 2: Settings › GitHub (the accounts signed in with GitHub), its own chunk. */
const GithubPart = lazyScreen(() => import('../settings/GithubPart'))
/** YAZ-6284: Settings › Friends › Browse deck permissions, its own chunk. */
const DeckPermissionsPart = lazyScreen(() => import('../friends/ui/DeckPermissionsPart'))
/** YAZ-6300: Settings › Friends › Profile picture, its own chunk. */
const ProfilePictureRow = lazyScreen(() => import('../friends/ui/ProfilePictureRow'))
/** Settings › Friends › Notifications (Web Push), its own chunk. */
const NotificationsPart = lazyScreen(() => import('../friends/ui/NotificationsPart'))

/**
 * Settings (decisions 7, 22; round 13, item 4; round 10, item 19; YAZ-5659): first the vaults (switch, add, replace the
 * token, reset the local copy, remove), the Friends part ("Friends use @login", "Vaults that count", "Name"; no sharing
 * switch), the version, What's new, the build and Check for updates, then GitHub, and last, apart, "Sign out and erase
 * this phone" (it always asks first).
 */
export function Settings() {
  const app = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The ask's facts, read when the person taps "Sign out and erase this phone" (null: no ask). */
  const [erasing, setErasing] = useState<{ unsent: number; friends: boolean; removes: number } | null>(null)
  const closeErase = useCallback(() => setErasing(null), [])
  const askErase = async () => {
    const [unsent, friends, removes] = await Promise.all([
      unsentOnPhone(app.services.store, app.list.vaults.map(vaultId)).catch(() => 0),
      app.services.friends.hasFriends().catch(() => false),
      waitingRemoves(app.services.store),
    ])
    setErasing({ unsent, friends: friends || removes > 0, removes })
  }

  const run = async (step: () => Promise<void>) => {
    setBusy(true)
    try {
      await step()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame title="Settings" back={() => app.go({ type: 'back' })} tabs={app.phase === 'ready'}>
      <InstallHint />
      {/* YAZ-5659: Settings starts with the vaults; the build and Check for updates sit in About, GitHub last. */}
      <h2 className="section">Vaults</h2>
      <ul className="rows" aria-label="Vaults">
        {app.list.vaults.map((v) => (
          <VaultRow key={vaultId(v)} vault={v} more={open === vaultId(v)} onMore={() => setOpen(open === vaultId(v) ? null : vaultId(v))} busy={busy} run={run} />
        ))}
      </ul>
      <button type="button" className="btn btn--wide" style={{ marginTop: 10 }} onClick={() => app.go({ type: 'open', route: { kind: 'add-vault' } })}>
        Add vault
      </button>
      {app.vaultKey !== null && <VaultHealth />}
      {app.vaultKey !== null && app.phase === 'ready' && <MobileVaultPart />}

      {/* YAZ-5652: only with Friends on (`shared/features.ts`). */}
      {FRIENDS_ENABLED && <FriendsPart />}

      <AppearancePart />

      <AboutPart />

      <GithubPart />

      {/* Never by accident: at the very bottom, apart from the other rows, in red, and it asks first (Cancel has the focus). */}
      <div className="settings__erase">
        <h2 className="section">This phone</h2>
        {erasing !== null ? (
          <Confirm
            question={eraseQuestion({ ...erasing, unit: app.unit })}
            yes="Erase this phone"
            busy={busy}
            onYes={() => void run(app.eraseAll)}
            onNo={closeErase}
            extra={
              // YAZ-5343, the safe way: the Friends tab runs a waiting remove when it reads (with a signal).
              FRIENDS_ENABLED && erasing.removes > 0 && (
                <button type="button" className="btn btn--wide" onClick={() => app.go({ type: 'tab', tab: 'friends' })}>
                  Finish it in Friends
                </button>
              )
            }
          />
        ) : (
          <button type="button" className="btn btn--wide btn--danger" onClick={() => void askErase()}>
            Sign out and erase this phone
          </button>
        )}
      </div>
    </Frame>
  )
}

/**
 * The version (the number, the build's date and time in the phone's own time, the commit) and What's new,
 * closed at first. Open, its list scrolls inside its own short box, so the screen does not grow.
 */
function AboutPart() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <h2 className="section">About Yaseen Docs</h2>
      <ul className="rows">
        <li className="row settings__version-row">
          <span className="row__main">Version</span>
          <span className="row__side settings__version">{versionWords(BUILD)}</span>
        </li>
        <li>
          <div className="row">
            <button type="button" className="row__button whats-new__toggle" aria-expanded={open} aria-controls="whats-new" onClick={() => setOpen(!open)}>
              What's new
              <span className="whats-new__chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
          {open && (
            <div id="whats-new" className="sheet whats-new" tabIndex={0} role="region" aria-label="What's new">
              <WhatsNewList />
            </div>
          )}
        </li>
      </ul>
      {/* YAZ-5555, YAZ-5593, YAZ-5659: under What's new, which build runs, the address it runs from, and Check for updates. */}
      <div className="settings__update">
        <p className="muted settings__build">{buildLine(BUILD)}</p>
        <UpdateCheck />
      </div>
    </>
  )
}

function VaultRow({ vault, more, onMore, busy, run }: { vault: PhoneVault; more: boolean; onMore: () => void; busy: boolean; run: (step: () => Promise<void>) => Promise<void> }) {
  const app = useApp()
  const id = vaultId(vault)
  const isOpen = id === app.vaultKey
  const name = vaultTitle(vault.repo)
  const number = vaultNumber(app.list.vaults, id)
  const [asking, setAsking] = useState<'reset' | 'remove' | null>(null)
  return (
    <li>
      <div className="row vault-row">
        <button
          type="button"
          className="row__button vault-row__button"
          aria-current={isOpen ? 'true' : undefined}
          aria-label={isOpen ? `${name}, ${vault.repo}, open` : `Open ${name}, ${vault.repo}`}
          onClick={() => !isOpen && void run(() => app.switchVault(id))}
          disabled={busy}
        >
          {number !== null && <VaultBadge n={number} />}
          <span className="row__main vault-row__words">
            <span className="vault-row__name">{name}</span>
            <span className="vault-row__path">
              {vault.repo} · {vault.branch}
            </span>
          </span>
        </button>
        {isOpen && <span className="vault-row__open">Open</span>}
        <button type="button" className="icon-btn" aria-label={`More for ${vault.repo}`} aria-expanded={more} onClick={onMore}>
          ⋯
        </button>
      </div>
      {more && (
        <div className="sheet">
          {asking === 'reset' ? (
            <Confirm
              question={`Reset the copy of ${vault.repo}?${app.unit(' Its pages on this phone go, and the vault downloads again. The token stays.')}`}
              yes="Reset local copy"
              busy={busy}
              onYes={() => void run(() => app.resetCopy(id)).then(() => setAsking(null))}
              onNo={() => setAsking(null)}
            />
          ) : asking === 'remove' ? (
            <Confirm
              question={`Remove ${vault.repo} from this phone?${app.unit(' Its token and its pages on this phone go. Answers that are not sent yet are lost. The repo on GitHub does not change.')}`}
              yes="Remove"
              busy={busy}
              onYes={() => void run(() => app.removeVault(id))}
              onNo={() => setAsking(null)}
            />
          ) : (
            <ul className="rows">
              <li className="row">
                <button type="button" className="row__button" onClick={() => app.go({ type: 'open', route: { kind: 'replace-token', vault: id } })}>
                  Replace token
                </button>
              </li>
              <li className="row">
                <button type="button" className="row__button" onClick={() => setAsking('reset')}>
                  Reset local copy
                </button>
              </li>
              <li className="row">
                <button type="button" className="row__button btn--danger" onClick={() => setAsking('remove')}>
                  Remove from this phone
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Decision 22: no sharing switch. The first friend starts the sharing; Settings keeps "Vaults that count" and "Name".
 * Round 13, item 4: "Friends use @login", which the person can change, and the two alerts of 3E.
 */
const EXCLUDED_VAULTS_KEY = 'yaseendocs.friends.excludedVaults'

function firstNameOf(name: string): string {
  const trimmed = name.trim()
  return trimmed === '' ? '' : trimmed.split(/\s+/)[0]
}

type DirectFriendsProfilePort = FriendsPort & {
  getBoard?: () => Promise<{ kind?: string; me?: { nickname?: string | null } } | null>
  updatePrefs?: (prefs: { nickname?: string | null }) => Promise<unknown>
}

function FriendsPart() {
  const app = useApp()
  const [editing, setEditing] = useState<'account' | 'vaults' | 'name' | 'avatar' | 'zone' | 'delete' | null>(null)
  const toggle = (part: 'account' | 'vaults' | 'name' | 'avatar' | 'zone' | 'delete') => setEditing(editing === part ? null : part)
  const [zoneSaid, setZoneSaid] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteSaid, setDeleteSaid] = useState<string | null>(null)
  const [excludedVaults, setExcludedVaults] = useState<string[]>([])
  const [hydratedNickname, setHydratedNickname] = useState<string | null | undefined>(undefined)
  const currentVault = app.list.vaults.find((v) => vaultId(v) === app.vaultKey) ?? app.list.vaults[0] ?? null
  const currentSlug = currentVault?.repo.toLowerCase() ?? null
  const thisVaultIncluded = currentSlug === null || !excludedVaults.some((s) => s.toLowerCase() === currentSlug)

  useEffect(() => {
    let live = true
    void app.services.store
      .getState<string[]>(PHONE, EXCLUDED_VAULTS_KEY)
      .then((saved) => {
        if (!live) return
        if (Array.isArray(saved)) setExcludedVaults(saved.filter((s): s is string => typeof s === 'string'))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [app.services.store])

  useEffect(() => {
    let live = true
    const direct = app.services.friends as DirectFriendsProfilePort
    const loadSvc = serviceOf(app.services.friends)
    const hydrate = async () => {
      let remoteNickname: string | null | undefined
      if (typeof direct.getBoard === 'function') {
        const board = await direct.getBoard().catch(() => null)
        remoteNickname = board?.me?.nickname
      } else if (loadSvc !== null) {
        const svc = await loadSvc().catch(() => null)
        const board = await svc?.board().catch(() => null)
        if (board && board.kind === 'ok') remoteNickname = board.me.nickname
      }
      if (!live || remoteNickname === undefined) return
      setHydratedNickname(remoteNickname)
      if (remoteNickname !== null) {
        setNickname((prev) => (prev === '' ? remoteNickname : prev))
      }
    }
    void hydrate()
    return () => {
      live = false
    }
  }, [app.services.friends])

  const setThisVaultIncluded = (included: boolean) => {
    if (currentVault === null) return
    const slug = currentVault.repo.toLowerCase()
    const next = included
      ? excludedVaults.filter((s) => s.toLowerCase() !== slug)
      : excludedVaults.some((s) => s.toLowerCase() === slug)
      ? excludedVaults
      : [...excludedVaults, currentVault.repo]
    setExcludedVaults(next)
    void app.services.store
      .setState(PHONE, EXCLUDED_VAULTS_KEY, next)
      .then(() => app.services.friends.syncVaultExclusion?.())
      .catch(() => undefined)
  }
  const fa = app.friendsAccount
  // Friends runs on Cloudflare D1 (/api/friends/*), not GitHub Gists — suppress legacy `no-gists` token alert.
  const alert = fa.kind === 'no-gists' ? null : friendsMessage(fa)
  const choices = app.list.vaults.filter((v) => app.accounts[vaultId(v)]?.gists === 'yes')
  const actingVault = fa.kind === 'ok' || fa.kind === 'two-accounts' ? fa.vault : null
  const acting = actingVault === null ? undefined : app.accounts[actingVault]
  const githubName = acting?.name ?? acting?.login ?? app.accounts[app.vaultKey ?? '']?.name ?? app.accounts[app.vaultKey ?? '']?.login ?? ''
  const githubFirstName = firstNameOf(githubName)
  const githubAvatar = acting?.avatarUrl ?? app.accounts[app.vaultKey ?? '']?.avatarUrl ?? null
  const activeNickname = hydratedNickname !== undefined ? hydratedNickname : app.friendsSettings.nickname
  const displayedName = activeNickname ?? (githubFirstName === '' ? 'From GitHub' : githubFirstName)
  const counting = app.friendsSettings.vaults
  const counts = (id: string) => counting === null || counting.includes(id)
  const countLabel = counting === null ? 'All vaults' : app.list.vaults.filter((v) => counts(vaultId(v))).map((v) => v.repo.split('/')[1]).join(', ') || 'None'
  const [nickname, setNickname] = useState(app.friendsSettings.nickname ?? '')
  // The home time zone of the numbers (every device counts the days in it). Not set yet: this phone's zone.
  const phoneZone = deviceZone()
  const homeZone = app.friendsSettings.zone ?? phoneZone
  const zones = editing === 'zone' ? zoneChoices(homeZone) : []

  const setCounts = (id: string, on: boolean) => {
    const all = app.list.vaults.map(vaultId)
    const now = all.filter((v) => (v === id ? on : counts(v)))
    void app.saveFriendsSettings({ ...app.friendsSettings, vaults: now.length === all.length ? null : now })
  }

  return (
    <>
      <h2 className="section">Friends</h2>
      <p className="muted">Your friends see your numbers: cards and minutes for each day, your streak, your totals. Never the text of your cards.</p>
      {alert !== null && (
        <Problem
          message={alert}
          action={fa.kind === 'no-gists' ? 'How to make a token' : undefined}
          onAction={fa.kind === 'no-gists' ? () => app.go({ type: 'open', route: { kind: 'guide' } }) : undefined}
        />
      )}
      <ul className="rows">
        {(fa.kind === 'ok' || fa.kind === 'two-accounts') && (
          <li>
            <div className="row">
              <button type="button" className="row__button" aria-expanded={editing === 'account'} onClick={() => toggle('account')} disabled={choices.length < 2}>
                Friends use @{fa.login}
              </button>
              {choices.length > 1 && <span className="row__side">Change</span>}
            </div>
            {editing === 'account' && (
              <div className="sheet" role="radiogroup" aria-label="Friends use">
                {choices.map((v) => {
                  const login = app.accounts[vaultId(v)]?.login ?? ''
                  return (
                    <label key={vaultId(v)} className="row">
                      <input type="radio" className="check" name="friends-vault" checked={vaultId(v) === fa.vault} onChange={() => void app.chooseFriendsVault(vaultId(v))} />
                      <span className="row__main">
                        @{login} <span className="row__side">({v.repo})</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </li>
        )}
        {currentVault !== null && (
          <li>
            <label className="row">
              <input
                type="checkbox"
                className="check"
                checked={thisVaultIncluded}
                onChange={(e) => setThisVaultIncluded(e.target.checked)}
              />
              <span className="row__main">
                Count this vault in Friends
                {!thisVaultIncluded && <span className="row__side"> (paused for {currentVault.repo})</span>}
              </span>
            </label>
          </li>
        )}
        <li>
          <div className="row">
            <button type="button" className="row__button" aria-expanded={editing === 'vaults'} onClick={() => toggle('vaults')}>
              Vaults that count
            </button>
            <span className="row__side">{countLabel}</span>
          </div>
          {editing === 'vaults' && (
            <div className="sheet" role="group" aria-label="Vaults that count">
              {app.list.vaults.map((v) => (
                <label key={vaultId(v)} className="row">
                  <input type="checkbox" className="check" checked={counts(vaultId(v))} onChange={(e) => setCounts(vaultId(v), e.target.checked)} />
                  <span className="row__main">{v.repo}</span>
                </label>
              ))}
            </div>
          )}
        </li>
        <DeckPermissionsPart
          currentRepo={currentVault?.repo ?? null}
          currentVaultName={currentVault ? vaultTitle(currentVault.repo) : null}
        />
        <li>
          <div className="row">
            <button type="button" className="row__button" aria-expanded={editing === 'zone'} onClick={() => toggle('zone')}>
              Home time zone
            </button>
            <span className="row__side">{homeZone ?? 'This phone'}</span>
          </div>
          {zoneSaid !== null && editing !== 'zone' && (
            <p className="muted" role="status">
              {zoneSaid}
            </p>
          )}
          {editing === 'zone' && (
            <label className="field sheet">
              <span className="field__label">
                Your friends see your days in this time zone. Friends do not see the zone. Each day starts at midnight in it, on each device.
              </span>
              <select
                aria-label="Home time zone"
                value={homeZone ?? ''}
                onChange={(e) => {
                  const zone = e.target.value
                  if (isTimeZone(zone))
                    void app.saveFriendsSettings({ ...app.friendsSettings, zone }).then(() => {
                      setEditing(null)
                      setZoneSaid('Saved. Your days use the new time zone from your next day. Days already sent do not change.')
                    })
                }}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z === phoneZone ? `${z} (this phone)` : z}
                  </option>
                ))}
              </select>
            </label>
          )}
        </li>
        <li>
          <div className="row">
            <button type="button" className="row__button" aria-expanded={editing === 'name'} onClick={() => toggle('name')}>
              Name
            </button>
            <span className="row__side">{displayedName}</span>
          </div>
          {editing === 'name' && (
            <form
              className="sheet stack"
              onSubmit={(e) => {
                e.preventDefault()
                const clean = cleanNickname(nickname)
                setHydratedNickname(clean)
                const direct = app.services.friends as DirectFriendsProfilePort
                const loadSvc = serviceOf(app.services.friends)
                void app
                  .saveFriendsSettings({ ...app.friendsSettings, nickname: clean })
                  .then(async () => {
                    if (typeof direct.updatePrefs === 'function') {
                      await direct.updatePrefs({ nickname: clean }).catch(() => undefined)
                    } else if (loadSvc !== null) {
                      const svc = await loadSvc().catch(() => null)
                      await svc?.updatePrefs?.({ nickname: clean }).catch(() => undefined)
                    }
                    setEditing(null)
                  })
              }}
            >
              <label className="field">
                <span className="field__label">The name your friends see. Leave empty to use your GitHub first name.</span>
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={githubFirstName || 'Your name'} maxLength={40} autoComplete="nickname" />
              </label>
              <button type="submit" className="btn btn--wide">
                Save name
              </button>
            </form>
          )}
        </li>
        <ProfilePictureRow
          open={editing === 'avatar'}
          onToggle={() => toggle('avatar')}
          displayName={displayedName === 'From GitHub' ? githubFirstName || 'You' : displayedName}
          fallbackAvatarUrl={githubAvatar}
        />
        <NotificationsPart />
        <li>
          <div className="row">
            <button type="button" className="row__button btn--danger" aria-expanded={editing === 'delete'} onClick={() => toggle('delete')}>
              Delete my Friends data
            </button>
          </div>
          {deleteSaid !== null && editing !== 'delete' && (
            <p className="muted" role="status">
              {deleteSaid}
            </p>
          )}
          {editing === 'delete' && (
            <div className="sheet">
              <Confirm
                question="Delete all your Friends data? This removes your profile, friendships, invites, cheers, and shared cards from the Friends server. Your vault and cards on GitHub are not touched."
                yes="Delete my Friends data"
                busy={deleteBusy}
                onYes={() => {
                  setDeleteBusy(true)
                  setDeleteSaid(null)
                  void (app.services.friends.deleteMe?.() ?? Promise.resolve({ ok: false as const, error: 'unavailable' }))
                    .then((res) => {
                      setDeleteSaid(res.ok ? 'Your Friends data has been deleted.' : 'Could not delete your Friends data. Try again.')
                      setEditing(null)
                    })
                    .finally(() => setDeleteBusy(false))
                }}
                onNo={() => setEditing(null)}
              />
            </div>
          )}
        </li>
      </ul>
    </>
  )
}

/** The zones to choose from: the home zone, this phone's, then every zone the runtime knows. */
function zoneChoices(home: string | null): string[] {
  const all = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') ?? []
  return [...new Set([home, deviceZone(), ...all].filter((z): z is string => isTimeZone(z)))]
}
