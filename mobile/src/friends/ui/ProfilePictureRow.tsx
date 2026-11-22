import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../app/AppState'
import type { FriendsPort } from '../../app/friendsPort'
import { encodeAvatarImage } from './avatarEncode'
import { initialOf } from './board'
import './friends.css'
import { serviceOf } from './lazy'
import type { FriendsService } from './service'

export interface ProfilePictureRowProps {
  open: boolean
  onToggle: () => void
  displayName: string
  fallbackAvatarUrl: string | null
}

type DirectFriendsProfileMethods = FriendsPort & {
  getBoard?: () => Promise<{ kind?: string; me?: { avatar?: string | null; avatarUrl?: string | null; hasCustomAvatar?: boolean } } | null>
  uploadAvatar?: (payload: { contentType: string; dataBase64: string }) => Promise<{ ok: true; avatarUrl: string; hasCustomAvatar: true } | { ok: false; error: string }>
  deleteAvatar?: () => Promise<{ ok: true; avatarUrl: string | null; hasCustomAvatar: false } | { ok: false; error: string }>
}

/**
 * Settings › Friends › Profile picture (YAZ-6300, lazy chunk so Settings stays lean on first load).
 * Matches the 2-click `.row` + `.sheet` pattern of `Name`.
 */
export default function ProfilePictureRow({ open, onToggle, displayName, fallbackAvatarUrl }: ProfilePictureRowProps) {
  const app = useApp()
  const [service, setService] = useState<FriendsService | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(fallbackAvatarUrl)
  const [hasCustomAvatar, setHasCustomAvatar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [imgFailed, setImgFailed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    const direct = app.services.friends as DirectFriendsProfileMethods
    const load = serviceOf(app.services.friends)
    const hydrate = async () => {
      if (typeof direct.getBoard === 'function') {
        const board = await direct.getBoard().catch(() => null)
        if (!live || !board?.me) return
        const nextUrl = board.me.avatar ?? board.me.avatarUrl ?? null
        if (nextUrl) {
          setAvatarUrl(nextUrl)
          setImgFailed(false)
        }
        if (typeof board.me.hasCustomAvatar === 'boolean') {
          setHasCustomAvatar(board.me.hasCustomAvatar)
        }
        return
      }
      if (load === null) return
      const s = await load().catch(() => null)
      if (!live || !s) return
      setService(s)
      const board = await s.board().catch(() => null)
      if (!live || !board || board.kind !== 'ok') return
      if (board.me.avatar) {
        setAvatarUrl(board.me.avatar)
        setImgFailed(false)
      }
      setHasCustomAvatar(board.me.hasCustomAvatar === true)
    }
    void hydrate()
    return () => {
      live = false
    }
  }, [app.services.friends])

  const shownAvatar = imgFailed ? null : avatarUrl || fallbackAvatarUrl || null
  const initial = initialOf(displayName || 'You')

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setStatus(null)
    try {
      const encoded = await encodeAvatarImage(file)
      const direct = app.services.friends as DirectFriendsProfileMethods
      const uploader =
        typeof direct.uploadAvatar === 'function'
          ? direct.uploadAvatar.bind(direct)
          : service?.uploadAvatar
          ? service.uploadAvatar.bind(service)
          : null
      if (!uploader) {
        setStatus('Profile picture upload is not available right now.')
        return
      }
      const res = await uploader({
        contentType: encoded.contentType,
        dataBase64: encoded.dataBase64,
      })
      if (!res.ok) {
        setStatus('Could not save profile picture. Try again.')
        return
      }
      setAvatarUrl(res.avatarUrl)
      setImgFailed(false)
      setHasCustomAvatar(true)
      setStatus('Saved')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not process that image.')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleReset = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const direct = app.services.friends as DirectFriendsProfileMethods
      const deleter =
        typeof direct.deleteAvatar === 'function'
          ? direct.deleteAvatar.bind(direct)
          : service?.deleteAvatar
          ? service.deleteAvatar.bind(service)
          : null
      if (!deleter) {
        setStatus('Reset is not available right now.')
        return
      }
      const res = await deleter()
      if (!res.ok) {
        setStatus('Could not reset profile picture. Try again.')
        return
      }
      setAvatarUrl(res.avatarUrl ?? fallbackAvatarUrl)
      setImgFailed(false)
      setHasCustomAvatar(false)
      setStatus('Reset to GitHub photo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li>
      <div className="row">
        <button
          type="button"
          className="row__button"
          aria-expanded={open}
          onClick={onToggle}
        >
          Profile picture
        </button>
        <span className="row__side fr-avatar-row__side">
          <span className="fr-avatar-row__thumb" aria-hidden="true">
            {shownAvatar !== null ? (
              <img src={shownAvatar} alt="" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
            ) : (
              initial
            )}
          </span>
          <span>{hasCustomAvatar ? 'Custom' : 'From GitHub'}</span>
        </span>
      </div>
      {open && (
        <div className="sheet stack" role="region" aria-label="Profile picture">
          <div className="fr-avatar-row__preview-wrap">
            <span className="fr-avatar-row__preview" aria-hidden="true">
              {shownAvatar !== null ? (
                <img src={shownAvatar} alt="" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
              ) : (
                initial
              )}
            </span>
            <p className="muted" style={{ margin: 0 }}>
              Shown to your friends on the leaderboard and VS screen.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label="Choose profile picture file"
            style={{ display: 'none' }}
            onChange={(e) => void handleFileChange(e.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn--wide"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? 'Saving…' : 'Choose photo'}
          </button>
          {hasCustomAvatar && (
            <button
              type="button"
              className="btn btn--wide"
              disabled={busy}
              onClick={() => void handleReset()}
            >
              Reset to GitHub photo
            </button>
          )}
          {status !== null && (
            <p className="muted" role="status" style={{ margin: 0 }}>
              {status}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
