/**
 * "Friends" (YAZ-5086, YAZ-6220; Settings › Cards › "Friends"):
 * Shows send status, a `Show Friends in Inbox` toggle (default ON), `Vaults that count` checkboxes,
 * and a `Delete my Friends data` button with confirmation.
 */
import { useEffect, useState } from 'react'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import type { FriendsSendView } from '@shared/types'
import { api } from '../api'
import { useUnit } from '../vault/unitWord'

export const FRIENDS_INBOX_VISIBLE_KEY = 'friends:showInInbox'
export const FRIENDS_INBOX_VISIBILITY_EVENT = 'friends:inbox-visibility-changed'

export function readShowFriendsInInbox(): boolean {
  try {
    return localStorage.getItem(FRIENDS_INBOX_VISIBLE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeShowFriendsInInbox(show: boolean): void {
  try {
    localStorage.setItem(FRIENDS_INBOX_VISIBLE_KEY, show ? 'true' : 'false')
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent(FRIENDS_INBOX_VISIBILITY_EVENT, { detail: show }))
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function ago(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${plural(min, 'minute')} ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${plural(h, 'hour')} ago` : `${plural(Math.round(h / 24), 'day')} ago`
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function whom(v: FriendsSendView): string {
  const parts = [v.friends > 0 && plural(v.friends, 'friend'), v.groups > 0 && plural(v.groups, 'group')].filter(Boolean)
  return parts.join(' and ')
}

/** "1 vault … is" or "2 vaults … are". */
const vaults = (n: number, rest: string, one: string, many: string) => `${n === 1 ? `1 vault that counts for friends ${one}` : `${n} vaults that count for friends ${many}`} ${rest}`

function missingWords(v: FriendsSendView): string {
  const behind = v.behind ?? 0
  const unreadable = v.unreadable ?? 0
  const notHere = Math.max(0, v.missing - behind - unreadable)
  const one = (n: number) => (n === 1 ? 'it' : 'each')
  const parts: string[] = []
  if (notHere > 0) parts.push(vaults(notHere, `not on this Mac. Clone ${one(notHere)} from GitHub, then open ${one(notHere)} once in this app, and the numbers go.`, 'is', 'are'))
  if (behind > 0) parts.push(vaults(behind, `older on this Mac than on GitHub. Open ${one(behind)} in this app to sync ${behind === 1 ? 'it' : 'them'}, and the numbers go.`, 'is', 'are'))
  if (unreadable > 0)
    parts.push(vaults(unreadable, `could not be read on this Mac: a link inside it, or a file the app cannot open.${v.retryAt === null ? '' : ` Next try at ${clock(v.retryAt)}.`}`, '', ''))
  return parts.join(' ').replace(/ {2,}/g, ' ')
}

/** One line for the state, or null while main has not answered. */
function sendLine(v: FriendsSendView, now: number): string {
  switch (v.status) {
    case 'no-token':
      return 'Save a GitHub token above first.'
    case 'no-friends':
      return 'No friends yet, so nothing is sent. Add a friend in the phone app.'
    case 'no-list':
      return `No friends list on ${v.login ? `@${v.login}` : 'this token\'s GitHub account'}, so nothing is sent. Friends use the GitHub account of the phone app. Add a friend there, or save a token of that account above.`
    case 'missing-vaults':
      return `Not sent: ${missingWords(v)}`
    case 'phone-first':
      return 'Not sent: open the phone app once. It finishes a change to your friends list, then this Mac sends again.'
    case 'no-gists':
      return 'Not sent: the token has no Gists permission. On GitHub, give it Gists (Read and write), then save it again above.'
    case 'sign-in-again':
      return 'Not sent: GitHub does not accept the token. Make a new token and save it above.'
    case 'offline':
      return 'Not sent: no connection to GitHub. The app tries again when your cards change.'
    case 'slowed':
      return `Sent less often now: GitHub allows 100 changes an hour.${v.retryAt === null ? '' : ` Next try at ${clock(v.retryAt)}.`}`
    case 'needs-repair':
      return `Not sent. ${LIST_NEEDS_REPAIR}`
    case 'needs-newer-app':
      return 'Not sent: your friends list is from a newer app. Update this app.'
    case 'list-elsewhere':
      return `Not sent: your friends list is in the vault ${v.home ?? 'of the phone app'}. Open that vault once in this app, and the numbers go.`
    case 'no-list-access':
      return 'Not sent: the token cannot read the vault that holds your friends list. On GitHub, give it Contents (Read and write) on that vault, then save it again above.'
    case 'failed':
      return `Not sent: something went wrong. The app tries again ${v.retryAt === null ? 'when your cards change' : `at ${clock(v.retryAt)}`}.`
    default: {
      if (v.friends + v.groups === 0) return 'No friends yet, so nothing is sent. Add a friend in the phone app.'
      return v.lastSentAt === null ? `Sent to ${whom(v)} when your cards change.` : `Sent to ${whom(v)}. Last sent ${ago(v.lastSentAt, now)}.`
    }
  }
}

export function FriendsSendControl() {
  const [view, setView] = useState<FriendsSendView | null>(null)
  const [showInInbox, setShowInInbox] = useState<boolean>(() => readShowFriendsInInbox())
  const [nickname, setNickname] = useState('')
  const [savedNickname, setSavedNickname] = useState('')
  const [githubName, setGithubName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [allVaults, setAllVaults] = useState<string[]>([])
  const [countedVaults, setCountedVaults] = useState<string[]>([])
  const [knownVaults, setKnownVaults] = useState<{ path: string; name: string; included: boolean }[]>([])
  const [savingVaults, setSavingVaults] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null)
  const unit = useUnit()

  useEffect(() => {
    let live = true
    api.friends.status().then(
      (v) => {
        if (!live) return
        setView(v)
        const kv = (v as FriendsSendView & { knownVaults?: { path: string; name: string; included: boolean }[] }).knownVaults
        if (Array.isArray(kv) && kv.length > 0) setKnownVaults(kv)
      },
      () => undefined,
    )
    if (typeof api.friends.board === 'function') {
      api.friends.board(false).then(
        (res) => {
          if (!live || !res.ok) return
          const picked = res.board.me.vaults ?? []
          setCountedVaults(picked)
          setAllVaults((prev) => Array.from(new Set([...prev, ...picked])))
          const nick = res.board.me.nickname ?? ''
          setNickname(nick)
          setSavedNickname(nick)
          setGithubName(res.board.me.name || res.board.me.login || '')
        },
        () => undefined,
      )
    }
    if (typeof api.state?.get === 'function') {
      api.state.get().then(
        (st) => {
          if (!live || !st?.folders) return
          const names = Object.entries(st.folders).map(([p, f]) => f.name || p.split('/').pop() || p)
          setAllVaults((prev) => Array.from(new Set([...prev, ...names])))
        },
        () => undefined,
      )
    }
    return () => {
      live = false
    }
  }, [])

  const toggleShowInInbox = (next: boolean) => {
    setShowInInbox(next)
    writeShowFriendsInInbox(next)
  }

  const saveDisplayName = async () => {
    const trimmed = nickname.trim()
    if (savingName || trimmed === savedNickname || typeof api.friends.updatePrefs !== 'function') return
    setSavingName(true)
    try {
      const res = await api.friends.updatePrefs({ nickname: trimmed === '' ? null : trimmed })
      if (res.ok) {
        const next = res.nickname ?? ''
        setNickname(next)
        setSavedNickname(next)
      }
    } finally {
      setSavingName(false)
    }
  }

  const toggleKnownVault = async (vaultPath: string, included: boolean) => {
    if (savingVaults || typeof api.friends.setVaultIncluded !== 'function') return
    setKnownVaults((prev) => prev.map((v) => (v.path === vaultPath ? { ...v, included } : v)))
    setSavingVaults(true)
    try {
      const res = await api.friends.setVaultIncluded(vaultPath, included)
      if (res.ok && Array.isArray(res.knownVaults)) setKnownVaults(res.knownVaults)
    } finally {
      setSavingVaults(false)
    }
  }

  const toggleVault = async (vault: string) => {
    if (savingVaults || typeof api.friends.updatePrefs !== 'function') return
    const next = countedVaults.includes(vault) ? countedVaults.filter((v) => v !== vault) : [...countedVaults, vault]
    setCountedVaults(next)
    setSavingVaults(true)
    try {
      const res = await api.friends.updatePrefs({ vaults: next })
      if (res.ok) setCountedVaults(res.vaults)
    } finally {
      setSavingVaults(false)
    }
  }

  const handleDeleteMe = async () => {
    if (deleting || typeof api.friends.deleteMe !== 'function') return
    setDeleting(true)
    setDeleteNotice(null)
    try {
      const res = await api.friends.deleteMe()
      if (res.ok) {
        setConfirmDelete(false)
        setCountedVaults([])
        setDeleteNotice('Your Friends data has been deleted.')
        api.friends.status().then((v) => setView(v), () => undefined)
      } else {
        setDeleteNotice(`Could not delete Friends data: ${res.error}`)
      }
    } catch {
      setDeleteNotice('Could not delete Friends data.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="friends-settings">
      <p className="settings__key-status">{unit('Only your numbers: cards, minutes and streaks, with your GitHub name and picture. Never your cards or your pages.')}</p>
      <p className="settings__key-status" role="status">
        {view === null ? '…' : sendLine(view, Date.now())}
      </p>

      <label className="friends-settings__toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={showInInbox}
          onChange={(e) => toggleShowInInbox(e.target.checked)}
        />
        <span>Show Friends in Inbox</span>
      </label>

      <label className="friends-settings__name" style={{ display: 'block', marginTop: 12 }}>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>Display name</span>
        <input
          type="text"
          className="settings__input"
          aria-label="Display name"
          placeholder={githubName || 'Your GitHub name'}
          value={nickname}
          disabled={savingName}
          onChange={(e) => setNickname(e.target.value)}
          onBlur={() => void saveDisplayName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
              void saveDisplayName()
            }
          }}
        />
      </label>

      {knownVaults.length > 0 ? (
        <fieldset className="friends-settings__vaults" style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <legend style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>Vaults counted</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {knownVaults.map((v) => (
              <label key={v.path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }} title={v.path}>
                <input
                  type="checkbox"
                  checked={v.included}
                  disabled={savingVaults}
                  onChange={(e) => void toggleKnownVault(v.path, e.target.checked)}
                />
                <span>{v.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : allVaults.length > 0 ? (
        <fieldset className="friends-settings__vaults" style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <legend style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>Vaults counted</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {allVaults.map((vault) => (
              <label key={vault} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={countedVaults.includes(vault)}
                  disabled={savingVaults}
                  onChange={() => void toggleVault(vault)}
                />
                <span>{vault}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="friends-settings__danger" style={{ marginTop: 14 }}>
        {!confirmDelete ? (
          <button
            type="button"
            className="settings__btn settings__btn--danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete my Friends data
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Delete all Friends stats, groups, and shared cards?</span>
            <button type="button" className="settings__btn" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button type="button" className="settings__btn settings__btn--danger" disabled={deleting} onClick={() => void handleDeleteMe()}>
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
          </div>
        )}
        {deleteNotice !== null && <p className="settings__key-status" role="status">{deleteNotice}</p>}
      </div>
    </div>
  )
}
