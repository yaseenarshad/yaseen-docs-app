/**
 * Settings › General › You (YAZ-4615 D1, D7): who you are on a comment — a picture, your name, and
 * the handle your comments carry in `by`. Null until a name is set: then the app signs nothing.
 *
 * The handle follows the name only until a profile is saved, or until you type one yourself: your
 * comments carry it, so a rename must never change it. Names and handles are saved when you leave
 * the field or press Enter, not on each key (each save rewrites your card in every open vault); a
 * picture is saved when it is chosen. The picture is cropped to a square and scaled to 96 px WebP
 * here, so the profile (and the vault's people file) stays a few KB.
 */
import { useEffect, useRef, useState } from 'react'
import { handleFromName, HANDLE_RE, isCommentProfile, PROFILE_PICTURE_MAX, type CommentProfile, type SettingsState } from '@shared/types'
import { Avatar } from '../comments/Avatar'

const SIDE = 96

/** The image cropped to its centre square and scaled to 96 px WebP, as a data URL small enough to keep. */
export async function pictureFrom(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIDE
  canvas.height = SIDE
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('no canvas')
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE)
  bitmap.close()
  for (const quality of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/webp', quality)
    if (url.length <= PROFILE_PICTURE_MAX) return url
  }
  throw new Error('the picture is too large')
}

interface Draft {
  name: string
  handle: string
  /** True once the handle was typed by hand: it then stops following the name. */
  ownHandle: boolean
  picture: string | null
}

const draftOf = (p: CommentProfile | null): Draft =>
  p === null ? { name: '', handle: '', ownHandle: false, picture: null } : { name: p.name, handle: p.handle, ownHandle: true, picture: p.picture }

/** The profile a draft stands for: null when there is no name, unchanged (undefined) while it is not valid yet. */
function profileOf(d: Draft): CommentProfile | null | undefined {
  if (d.name.trim() === '') return null
  const next = { handle: d.handle, name: d.name.trim(), picture: d.picture }
  return isCommentProfile(next) ? next : undefined
}

export function ProfileControl({ settings, onChange }: { settings: SettingsState; onChange: (next: SettingsState) => void }) {
  const [draft, setDraftState] = useState<Draft>(() => draftOf(settings.profile))
  // The latest draft, for a save that lands after more typing (a picture still encoding).
  const latest = useRef(draft)
  const setDraft = (d: Draft): void => {
    latest.current = d
    setDraftState(d)
  }
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Another window (or Mac, through the settings folder) changed it: follow.
  const stored = JSON.stringify(settings.profile)
  const seen = useRef(stored)
  useEffect(() => {
    if (seen.current === stored) return
    seen.current = stored
    setDraft(draftOf(settings.profile))
  }, [stored, settings.profile])

  const save = (d: Draft = latest.current): void => {
    setDraft(d)
    const next = profileOf(d)
    if (next === undefined) return
    const text = JSON.stringify(next)
    if (text === seen.current) return
    seen.current = text
    onChange({ ...settings, profile: next })
  }

  const badHandle = draft.name.trim() !== '' && !HANDLE_RE.test(draft.handle)
  const preview: CommentProfile = { handle: draft.handle, name: draft.name.trim() || 'You', picture: draft.picture }

  return (
    <div className="profile-control">
      <div className="profile-control__picture">
        <Avatar size={48} name={preview.name} picture={draft.picture} tone="me" empty={draft.name.trim() === '' && draft.picture === null} />
        <div className="profile-control__picture-actions">
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            {draft.picture === null ? 'Choose picture…' : 'Change picture…'}
          </button>
          {draft.picture !== null && (
            <button type="button" className="btn" onClick={() => save({ ...latest.current, picture: null })}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          aria-label="Choose picture"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file === undefined) return
            pictureFrom(file).then(
              (picture) => {
                setError(null)
                save({ ...latest.current, picture })
              },
              () => setError("Can't use that picture. Try a PNG or JPEG."),
            )
          }}
        />
      </div>
      <label className="profile-control__field">
        <span>Name</span>
        <input
          type="text"
          value={draft.name}
          placeholder="Your name"
          maxLength={80}
          onChange={(e) => {
            const name = e.currentTarget.value
            setDraft({ ...draft, name, handle: draft.ownHandle ? draft.handle : handleFromName(name) })
          }}
          onBlur={() => save()}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </label>
      <label className="profile-control__field">
        <span>Handle</span>
        <input
          type="text"
          value={draft.handle}
          placeholder="your-name"
          maxLength={32}
          aria-invalid={badHandle}
          onChange={(e) => setDraft({ ...draft, handle: e.currentTarget.value.toLowerCase(), ownHandle: true })}
          onBlur={() => save()}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </label>
      {badHandle && <p className="profile-control__error">Use lowercase letters, numbers and single hyphens.</p>}
      {error !== null && <p className="profile-control__error">{error}</p>}
    </div>
  )
}
