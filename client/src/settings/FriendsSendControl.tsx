/**
 * "Friends" (YAZ-5086, YAZ-6220; Settings › Cards › "Friends"):
 * Shows send status, a `Show Friends in Inbox` toggle (default ON), `Vaults that count` checkboxes,
 * and a `Delete my Friends data` button with confirmation.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import type { DeckSettingsPayload, DeckShareMode, DeckVaultConfig } from '@shared/friendsApi'
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

const AVATAR_SIZE = 256
const AVATAR_MAX_BYTES = 48 * 1024

function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read the selected image.'))
    }
    img.src = url
  })
}

/**
 * Center-crops an image file to 256x256 and encodes as WebP (or JPEG fallback),
 * stepping quality down so the payload stays <= 48 KB.
 */
export async function encodeAvatarFile(
  file: File,
): Promise<{ contentType: 'image/webp' | 'image/jpeg'; dataBase64: string }> {
  const img = await loadImageFromFile(file)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image processing is unavailable.')
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  if (srcW <= 0 || srcH <= 0) throw new Error('Invalid image dimensions.')
  const side = Math.min(srcW, srcH)
  const sx = (srcW - side) / 2
  const sy = (srcH - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)

  const qualities = [0.86, 0.72, 0.58, 0.44, 0.3]
  for (const mime of ['image/webp', 'image/jpeg'] as const) {
    const prefix = `data:${mime};base64,`
    for (const q of qualities) {
      const dataUrl = canvas.toDataURL(mime, q)
      if (!dataUrl.startsWith(prefix)) break
      const dataBase64 = dataUrl.slice(prefix.length)
      if (dataBase64.length > 0 && base64ByteLength(dataBase64) <= AVATAR_MAX_BYTES) {
        return { contentType: mime, dataBase64 }
      }
    }
  }
  throw new Error('Photo is too large after compression. Try a simpler image.')
}

export function FriendsSendControl() {
  const [view, setView] = useState<FriendsSendView | null>(null)
  const [showInInbox, setShowInInbox] = useState<boolean>(() => readShowFriendsInInbox())
  const [nickname, setNickname] = useState('')
  const [savedNickname, setSavedNickname] = useState('')
  const [githubName, setGithubName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [hasCustomAvatar, setHasCustomAvatar] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [allVaults, setAllVaults] = useState<string[]>([])
  const [countedVaults, setCountedVaults] = useState<string[]>([])
  const [knownVaults, setKnownVaults] = useState<{ path: string; name: string; included: boolean }[]>([])
  const [savingVaults, setSavingVaults] = useState(false)
  const [friendsList, setFriendsList] = useState<{ id: number; name: string; login: string }[]>([])
  const [deckSettings, setDeckSettings] = useState<DeckSettingsPayload>({ mode: 'none', vaults: [], allowedFriendIds: [] })
  const [installableRepos, setInstallableRepos] = useState<DeckVaultConfig[]>([])
  const [savingDeck, setSavingDeck] = useState(false)
  const [deckError, setDeckError] = useState<string | null>(null)
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
          const me = res.board.me as typeof res.board.me & { hasCustomAvatar?: boolean }
          const picked = me.vaults ?? []
          setCountedVaults(picked)
          setAllVaults((prev) => Array.from(new Set([...prev, ...picked])))
          const nick = me.nickname ?? ''
          setNickname(nick)
          setSavedNickname(nick)
          setGithubName(me.name || me.login || '')
          setAvatarUrl(me.avatarUrl ?? null)
          setHasCustomAvatar(Boolean(me.hasCustomAvatar))
          setFriendsList(res.board.friends.map((f) => ({ id: f.id, name: f.name, login: f.login })))
        },
        () => undefined,
      )
    }
    if (typeof api.friends.getDeckSettings === 'function') {
      api.friends.getDeckSettings().then(
        (res) => {
          if (!live || !res.ok) return
          setDeckSettings(res.settings)
        },
        () => undefined,
      )
    }
    if (typeof api.friends.listInstallableRepos === 'function') {
      api.friends.listInstallableRepos().then(
        (res) => {
          if (!live || !res.ok) return
          setInstallableRepos(res.repos)
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

  const handleAvatarPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || avatarBusy || typeof api.friends.uploadAvatar !== 'function') return
    setAvatarBusy(true)
    setAvatarNotice(null)
    setAvatarError(null)
    try {
      const encoded = await encodeAvatarFile(file)
      const res = await api.friends.uploadAvatar(encoded)
      if (res.ok) {
        setAvatarUrl(res.avatarUrl)
        setHasCustomAvatar(true)
        setAvatarNotice('Profile picture updated.')
      } else {
        setAvatarError(res.error || 'Could not upload profile picture.')
      }
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not upload profile picture.')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleResetAvatar = async () => {
    if (avatarBusy || typeof api.friends.deleteAvatar !== 'function') return
    setAvatarBusy(true)
    setAvatarNotice(null)
    setAvatarError(null)
    try {
      const res = await api.friends.deleteAvatar()
      if (res.ok) {
        setAvatarUrl(res.avatarUrl)
        setHasCustomAvatar(false)
        setAvatarNotice('Reset to GitHub photo.')
      } else {
        setAvatarError(res.error || 'Could not reset profile picture.')
      }
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not reset profile picture.')
    } finally {
      setAvatarBusy(false)
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

  const persistDeckSettings = async (next: DeckSettingsPayload) => {
    if (savingDeck || typeof api.friends.saveDeckSettings !== 'function') return
    const prev = deckSettings
    setDeckSettings(next)
    setSavingDeck(true)
    setDeckError(null)
    try {
      const res = await api.friends.saveDeckSettings(next)
      if (res.ok) {
        setDeckSettings(res.settings)
      } else {
        setDeckSettings(prev)
        setDeckError(res.error)
      }
    } catch (err) {
      setDeckSettings(prev)
      setDeckError(err instanceof Error ? err.message : 'Could not save deck permissions.')
    } finally {
      setSavingDeck(false)
    }
  }

  const setDeckMode = (mode: DeckShareMode) => {
    void persistDeckSettings({ ...deckSettings, mode })
  }

  const toggleAllowedFriend = (friendId: number, allowed: boolean) => {
    const nextIds = allowed
      ? Array.from(new Set([...deckSettings.allowedFriendIds, friendId]))
      : deckSettings.allowedFriendIds.filter((id) => id !== friendId)
    void persistDeckSettings({ ...deckSettings, allowedFriendIds: nextIds })
  }

  const toggleBrowsableVault = (repoCfg: DeckVaultConfig, allowed: boolean) => {
    const slug = repoCfg.repo.toLowerCase()
    const nextVaults = allowed
      ? [...deckSettings.vaults.filter((v) => v.repo.toLowerCase() !== slug), { ...repoCfg, repo: slug }]
      : deckSettings.vaults.filter((v) => v.repo.toLowerCase() !== slug)
    void persistDeckSettings({ ...deckSettings, vaults: nextVaults })
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
          placeholder={githubName || 'Your GitHub first name'}
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
        <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
          Default is your GitHub first name. Any custom name you save is shown as-typed.
        </span>
      </label>

      <div className="friends-settings__avatar" style={{ marginTop: 12 }}>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>Profile picture</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div
            className="friends-settings__avatar-preview"
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-subtle, rgba(127, 127, 127, 0.16))',
              color: 'var(--fg-muted)',
              fontWeight: 600,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Profile picture"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <span>{(nickname.trim() || githubName.trim() || '?')[0].toUpperCase()}</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="friends-settings__avatar-status" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              {hasCustomAvatar ? 'Custom photo' : 'From GitHub'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                aria-label="Choose profile picture"
                onChange={(e) => void handleAvatarPick(e)}
              />
              <button
                type="button"
                className="settings__btn"
                disabled={avatarBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarBusy ? 'Saving…' : 'Upload photo'}
              </button>
              {hasCustomAvatar && (
                <button
                  type="button"
                  className="settings__btn"
                  disabled={avatarBusy}
                  onClick={() => void handleResetAvatar()}
                >
                  Reset to GitHub photo
                </button>
              )}
            </div>
          </div>
        </div>
        {avatarNotice && (
          <p className="settings__key-status" role="status" style={{ marginTop: 6 }}>
            {avatarNotice}
          </p>
        )}
        {avatarError && (
          <p className="settings__key-status" role="alert" style={{ color: 'var(--danger, #dc2626)', marginTop: 6 }}>
            {avatarError}
          </p>
        )}
      </div>

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

      <div className="friends-settings__deck" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 6 }}>Browse deck permissions</legend>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>Who can browse my deck</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} role="radiogroup" aria-label="Who can browse my deck">
            {(
              [
                { id: 'none', label: 'No one' },
                { id: 'all', label: 'All friends' },
                { id: 'selected', label: 'Selected friends' },
              ] as const
            ).map((opt) => (
              <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="radio"
                  name="friends-deck-share-mode"
                  checked={deckSettings.mode === opt.id}
                  disabled={savingDeck}
                  onChange={() => setDeckMode(opt.id)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          {deckSettings.mode === 'selected' && (
            <div style={{ marginTop: 8, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {friendsList.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>No friends yet.</span>
              ) : (
                friendsList.map((f) => (
                  <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={deckSettings.allowedFriendIds.includes(f.id)}
                      disabled={savingDeck}
                      onChange={(e) => toggleAllowedFriend(f.id, e.target.checked)}
                    />
                    <span>{f.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>@{f.login}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <legend style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>Vaults friends can browse</legend>
          {installableRepos.length === 0 ? (
            <p className="settings__key-status" style={{ margin: 0 }}>
              Connect a GitHub App repository to allow friends to browse it.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {installableRepos.map((repo) => {
                const checked = deckSettings.vaults.some((v) => v.repo.toLowerCase() === repo.repo.toLowerCase())
                return (
                  <label key={repo.repo} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }} title={repo.repo}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={savingDeck}
                      onChange={(e) => toggleBrowsableVault(repo, e.target.checked)}
                    />
                    <span>{repo.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{repo.repo}</span>
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>

        {deckError && (
          <p className="settings__key-status" role="alert" style={{ color: 'var(--danger, #dc2626)', marginTop: 6 }}>
            {deckError}
          </p>
        )}
      </div>

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
