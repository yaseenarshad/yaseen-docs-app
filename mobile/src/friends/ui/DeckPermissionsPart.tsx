import { useEffect, useState } from 'react'
import type { DeckShareMode, DeckSettingsPayload } from '@shared/friendsApi'
import { useApp } from '../../app/AppState'
import { serviceOf } from './lazy'
import { canonicalVaultRepo, type FriendsService } from './service'

export interface DeckPermissionsPartProps {
  currentRepo: string | null
  currentVaultName: string | null
}

const MODE_LABELS: Record<DeckShareMode, string> = {
  none: 'No one',
  all: 'All friends',
  selected: 'Selected friends',
}

/**
 * Settings › Friends › Browse deck permissions (lazy chunk so Settings stays lean on first load).
 * Controls `Who can browse my deck` (`No one` | `All friends` | `Selected friends`) and
 * `Allow friends to browse this vault` (with real GitHub App `installationId`).
 */
export default function DeckPermissionsPart({ currentRepo, currentVaultName }: DeckPermissionsPartProps) {
  const app = useApp()
  const [service, setService] = useState<FriendsService | null>(null)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<DeckSettingsPayload>({ mode: 'none', vaults: [], allowedFriendIds: [] })
  const [friends, setFriends] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const repoSlug = currentRepo ? canonicalVaultRepo(currentRepo) : null
  const vaultAllowed = repoSlug !== null && settings.vaults.some((v) => canonicalVaultRepo(v.repo) === repoSlug)

  useEffect(() => {
    const load = serviceOf(app.services.friends)
    if (load === null) return
    let live = true
    setLoading(true)
    void load()
      .then(async (s) => {
        if (!live) return
        setService(s)
        const [deckSettings, board] = await Promise.all([
          s.getDeckSettings?.().catch(() => null) ?? Promise.resolve(null),
          s.board().catch(() => null),
        ])
        if (!live) return
        if (deckSettings) setSettings(deckSettings)
        if (board && board.kind === 'ok') {
          setFriends(
            board.friends
              .filter((f): f is typeof f & { userId: number } => typeof f.userId === 'number')
              .map((f) => ({ id: f.userId, name: f.name })),
          )
        }
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [app.services.friends])

  const persist = async (next: DeckSettingsPayload) => {
    if (!service?.saveDeckSettings) return
    setSaving(true)
    setSaid(null)
    try {
      const res = await service.saveDeckSettings(next)
      if (!res.ok) {
        setSaid('Could not save deck sharing settings. Try again.')
        return
      }
      setSettings({ mode: res.mode, vaults: res.vaults, allowedFriendIds: res.allowedFriendIds })
      setSaid('Saved.')
    } finally {
      setSaving(false)
    }
  }

  const setMode = (mode: DeckShareMode) => {
    void persist({ ...settings, mode })
  }

  const toggleFriend = (friendId: number) => {
    const has = settings.allowedFriendIds.includes(friendId)
    const allowedFriendIds = has
      ? settings.allowedFriendIds.filter((id) => id !== friendId)
      : [...settings.allowedFriendIds, friendId]
    void persist({ ...settings, allowedFriendIds })
  }

  const toggleVault = async (allow: boolean) => {
    if (!currentRepo || !repoSlug || !service) return
    if (!allow) {
      const vaults = settings.vaults.filter((v) => canonicalVaultRepo(v.repo) !== repoSlug)
      await persist({ ...settings, vaults })
      return
    }
    setSaving(true)
    setSaid(null)
    try {
      const installationId = (await service.findRepoInstallationId?.(currentRepo)) ?? null
      if (!installationId || installationId <= 0) {
        setSaid('Sign in with the Yaseen Docs GitHub App on this repo to let friends browse it.')
        return
      }
      const name = currentVaultName || currentRepo.split('/')[1] || currentRepo
      const vaults = [
        ...settings.vaults.filter((v) => canonicalVaultRepo(v.repo) !== repoSlug),
        { repo: repoSlug, installationId, name },
      ]
      const res = await service.saveDeckSettings?.({ ...settings, vaults })
      if (!res?.ok) {
        setSaid('Could not enable deck browsing for this vault.')
        return
      }
      setSettings({ mode: res.mode, vaults: res.vaults, allowedFriendIds: res.allowedFriendIds })
      setSaid('Saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <li>
      <div className="row">
        <button
          type="button"
          className="row__button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Browse deck permissions
        </button>
        <span className="row__side">{MODE_LABELS[settings.mode]}</span>
      </div>
      {open && (
        <div className="sheet stack" role="region" aria-label="Browse deck permissions">
          <p className="muted" style={{ margin: 0 }}>
            Let friends browse your cards and pages read-only. Review history is always stripped.
          </p>
          <div role="radiogroup" aria-label="Who can browse my deck">
            <div className="field__label" style={{ marginBottom: 4 }}>
              Who can browse my deck
            </div>
            {(['none', 'all', 'selected'] as const).map((m) => (
              <label key={m} className="row">
                <input
                  type="radio"
                  className="check"
                  name="deck-share-mode"
                  checked={settings.mode === m}
                  disabled={saving || loading}
                  onChange={() => setMode(m)}
                />
                <span className="row__main">{MODE_LABELS[m]}</span>
              </label>
            ))}
          </div>
          {settings.mode === 'selected' && (
            <div role="group" aria-label="Friends allowed to browse">
              <div className="field__label" style={{ marginBottom: 4 }}>
                Select friends
              </div>
              {friends.length === 0 ? (
                <p className="muted" style={{ margin: '4px 0' }}>
                  No friends added yet.
                </p>
              ) : (
                friends.map((f) => (
                  <label key={f.id} className="row">
                    <input
                      type="checkbox"
                      className="check"
                      checked={settings.allowedFriendIds.includes(f.id)}
                      disabled={saving || loading}
                      onChange={() => toggleFriend(f.id)}
                    />
                    <span className="row__main">{f.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
          {currentRepo !== null && (
            <label className="row">
              <input
                type="checkbox"
                className="check"
                checked={vaultAllowed}
                disabled={saving || loading}
                onChange={(e) => void toggleVault(e.target.checked)}
              />
              <span className="row__main">
                Allow friends to browse this vault
                <span className="row__side"> ({currentRepo})</span>
              </span>
            </label>
          )}
          {said !== null && (
            <p className="muted" role="status" style={{ margin: 0 }}>
              {said}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
