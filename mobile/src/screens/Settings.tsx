import { useCallback, useState } from 'react'
import { useApp } from '../app/AppState'
import { deviceZone, isTimeZone } from '@shared/friendStats'
import { cleanNickname } from '../app/friendsPort'
import { friendsMessage } from '../auth/friends'
import { vaultId, type PhoneVault } from '../store'
import { Confirm } from './Confirm'
import { eraseQuestion, unsentOnPhone, waitingRemoves } from './eraseWords'
import { Frame, Problem } from './Frame'

/**
 * Settings (decisions 7, 22; round 13, item 4; round 10, item 19): the vaults (switch, add, replace the token, reset the
 * local copy, remove), the Friends part ("Friends use @login", "Vaults that count", "Name"; no sharing switch), and
 * "Sign out and erase this phone".
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
      <h2 className="section">Vaults</h2>
      <ul className="rows" aria-label="Vaults">
        {app.list.vaults.map((v) => (
          <VaultRow key={vaultId(v)} vault={v} more={open === vaultId(v)} onMore={() => setOpen(open === vaultId(v) ? null : vaultId(v))} busy={busy} run={run} />
        ))}
      </ul>
      <button type="button" className="btn btn--wide" style={{ marginTop: 10 }} onClick={() => app.go({ type: 'open', route: { kind: 'add-vault' } })}>
        Add vault
      </button>

      <FriendsPart />

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
            erasing.removes > 0 && (
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
    </Frame>
  )
}

function VaultRow({ vault, more, onMore, busy, run }: { vault: PhoneVault; more: boolean; onMore: () => void; busy: boolean; run: (step: () => Promise<void>) => Promise<void> }) {
  const app = useApp()
  const id = vaultId(vault)
  const isOpen = id === app.vaultKey
  const [asking, setAsking] = useState<'reset' | 'remove' | null>(null)
  return (
    <li>
      <div className="row">
        <button
          type="button"
          className="row__button"
          aria-current={isOpen ? 'true' : undefined}
          aria-label={isOpen ? `${vault.repo}, open` : `Open ${vault.repo}`}
          onClick={() => !isOpen && void run(() => app.switchVault(id))}
          disabled={busy}
        >
          <span className="row__main">{vault.repo}</span> <span className="row__side">{vault.branch}</span>
        </button>
        {isOpen && <span className="row__side">Open</span>}
        <button type="button" className="icon-btn" aria-label={`More for ${vault.repo}`} aria-expanded={more} onClick={onMore}>
          ⋯
        </button>
      </div>
      {more && (
        <div className="sheet">
          {asking === 'reset' ? (
            <Confirm
              question={app.unit(`Reset the copy of ${vault.repo}? Its pages on this phone go, and the vault downloads again. The token stays.`)}
              yes="Reset local copy"
              busy={busy}
              onYes={() => void run(() => app.resetCopy(id)).then(() => setAsking(null))}
              onNo={() => setAsking(null)}
            />
          ) : asking === 'remove' ? (
            <Confirm
              question={app.unit(`Remove ${vault.repo} from this phone? Its token and its pages on this phone go. Answers that are not sent yet are lost. The repo on GitHub does not change.`)}
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
function FriendsPart() {
  const app = useApp()
  const [editing, setEditing] = useState<'account' | 'vaults' | 'name' | 'zone' | null>(null)
  const toggle = (part: 'account' | 'vaults' | 'name' | 'zone') => setEditing(editing === part ? null : part)
  const fa = app.friendsAccount
  const alert = friendsMessage(fa)
  const choices = app.list.vaults.filter((v) => app.accounts[vaultId(v)]?.gists === 'yes')
  const actingVault = fa.kind === 'ok' || fa.kind === 'two-accounts' ? fa.vault : null
  const acting = actingVault === null ? undefined : app.accounts[actingVault]
  const githubName = acting?.name ?? acting?.login ?? app.accounts[app.vaultKey ?? '']?.name ?? app.accounts[app.vaultKey ?? '']?.login ?? ''
  const counting = app.friendsSettings.vaults
  const counts = (id: string) => counting === null || counting.includes(id)
  const countLabel = counting === null ? 'All vaults' : app.list.vaults.filter((v) => counts(vaultId(v))).map((v) => v.repo.split('/')[1]).join(', ') || 'None'
  const [nickname, setNickname] = useState(app.friendsSettings.nickname ?? '')
  // YAZ-5251: the home time zone of the numbers (every device counts the days in it). Not set yet: this phone's zone.
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
        <li>
          <div className="row">
            <button type="button" className="row__button" aria-expanded={editing === 'zone'} onClick={() => toggle('zone')}>
              Home time zone
            </button>
            <span className="row__side">{homeZone ?? 'This phone'}</span>
          </div>
          {editing === 'zone' && (
            <label className="field sheet">
              <span className="field__label">Your days start at midnight in this zone, on each device. Days already sent stay as they are.</span>
              <select
                value={homeZone ?? ''}
                onChange={(e) => {
                  const zone = e.target.value
                  if (isTimeZone(zone)) void app.saveFriendsSettings({ ...app.friendsSettings, zone }).then(() => setEditing(null))
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
            <span className="row__side">{app.friendsSettings.nickname ?? (githubName === '' ? 'From GitHub' : githubName)}</span>
          </div>
          {editing === 'name' && (
            <form
              className="sheet stack"
              onSubmit={(e) => {
                e.preventDefault()
                void app.saveFriendsSettings({ ...app.friendsSettings, nickname: cleanNickname(nickname) }).then(() => setEditing(null))
              }}
            >
              <label className="field">
                <span className="field__label">The name your friends see. Leave it empty to use your GitHub name.</span>
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={githubName || 'Your name'} maxLength={40} autoComplete="nickname" />
              </label>
              <button type="submit" className="btn btn--wide">
                Save name
              </button>
            </form>
          )}
        </li>
      </ul>
    </>
  )
}

/** YAZ-5251: the zones to choose from: the home zone, this phone's, then every zone the runtime knows. */
function zoneChoices(home: string | null): string[] {
  const all = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') ?? []
  return [...new Set([home, deviceZone(), ...all].filter((z): z is string => isTimeZone(z)))]
}
