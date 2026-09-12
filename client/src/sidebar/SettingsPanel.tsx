import { useEffect, useRef, useState } from 'react'
import { THREAD_WIDTHS, isValidNewNoteFolder, type CommentsOrder, type ContentWidth, type GithubSyncStatus, type NewNoteLocation, type SettingsState, type Theme } from '@shared/types'

/** Obsidian's Appearance control and order (Desktop K, GRO-2218); App resolves and applies it. */
const THEME_OPTIONS: Array<{ label: string; value: Theme }> = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

/** Global reading-surface width presets (YAZ-1176); App owns their exact CSS mapping. */
const CONTENT_WIDTH_OPTIONS: Array<{ label: string; value: ContentWidth }> = [
  { label: 'Narrow', value: 'narrow' },
  { label: 'Medium', value: 'medium' },
  { label: 'Full', value: 'full' },
]

/** Comment stream order (YAZ-1515): a reading preference, global — the block's own toggle drives the same field. */
const COMMENTS_ORDER_OPTIONS: Array<{ label: string; value: CommentsOrder }> = [
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Newest first', value: 'newest' },
]

/** Google-Docs-style presets (GRO-2024 D4). blockGap is per-side padding: visual gap = 2×. */
const LINE_SPACING_PRESETS: Array<{ label: string; value: number }> = [
  { label: '1.0', value: 1.0 },
  { label: '1.15', value: 1.15 },
  { label: '1.5', value: 1.5 },
  { label: '2.0', value: 2.0 },
]
const BLOCK_GAP_PRESETS: Array<{ label: string; value: number }> = [
  { label: 'Compact', value: 2 },
  { label: 'Default', value: 4 },
  { label: 'Relaxed', value: 8 },
  { label: 'Spacious', value: 12 },
]
/** Shown in the colour swatch while the thread uses the app accent (`--accent` in app.css). */
const DEFAULT_THREAD_SWATCH = '#5b6cff'
/** Bullet threading on/off (GRO-2094); the editor reads it as `data-threading` on `.app`. */
const THREADING_OPTIONS: Array<{ label: string; value: boolean }> = [
  { label: 'Off', value: false },
  { label: 'On', value: true },
]
/**
 * Obsidian's "Default location for new notes" options and order (Files & Links, Links C2- —
 * GRO-2240): drives where clicking a bare unresolved [[link]] creates its page. The labels
 * are long, so they stack (settings__stack) instead of sharing an option row.
 */
const NEW_NOTE_LOCATION_OPTIONS: Array<{ label: string; value: NewNoteLocation }> = [
  { label: 'Vault folder', value: 'root' },
  { label: 'Same folder as current file', value: 'current' },
  { label: 'In the folder specified below', value: 'folder' },
]

/**
 * What we DETECTED about this vault's repo (YAZ-1081 3B), stated as fact rather than advice.
 * The two not-ready cases name GitHub Desktop deliberately: setting a remote up is a job for
 * the tool the user already has, not a flow this app should grow.
 */
function repoHint(status: GithubSyncStatus | null): string {
  const repo = status?.repo
  if (repo === undefined) return "This folder isn't a git repo — set it up with GitHub Desktop, then turn sync on."
  if (repo.remoteUrl === null) return 'This folder is a git repo with no GitHub remote — add one with GitHub Desktop, then turn sync on.'
  return `repo ${repo.remoteUrl} · branch ${repo.branch ?? '—'}`
}

interface SettingsCogProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  /**
   * GitHub sync (YAZ-1081 3B), optional because it is the ONE setting that is not part of
   * `SettingsState`: the switch lives per-vault in `.yaseendocs/github.json`, so it is read and
   * written through the engine rather than the app-wide settings object. Absent → no section.
   */
  sync?: { status: GithubSyncStatus | null; setEnabled: (enabled: boolean) => void }
}

/**
 * Cog pinned to the sidebar footer; opens the settings popover above it (GRO-2024).
 * Sections: Appearance/spacing/threading rows, then Files & Links (C2-, GRO-2240) — the
 * rollup home for Obsidian-modeled file/link settings; today: default location for new notes —
 * then GitHub Sync (YAZ-1081 3B): the per-vault switch plus the repo facts we detected.
 */
export function SettingsCog({ settings, onChange, sync }: SettingsCogProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // The folder input is draft + commit (Enter/blur), CreateInline-style: an invalid path —
  // absolute, `..`/`.`/empty segments — keeps the STORED value and marks the input; the typed
  // text stays for fixing up. An external settings change (another window) resets the draft.
  const [folderDraft, setFolderDraft] = useState(settings.newNoteFolder)
  const [folderInvalid, setFolderInvalid] = useState(false)
  useEffect(() => {
    setFolderDraft(settings.newNoteFolder)
    setFolderInvalid(false)
  }, [settings.newNoteFolder])

  const commitFolder = (raw: string) => {
    const value = raw.trim()
    if (!isValidNewNoteFolder(value)) {
      setFolderInvalid(true)
      return
    }
    setFolderInvalid(false)
    setFolderDraft(value)
    if (value !== settings.newNoteFolder) onChange({ ...settings, newNoteFolder: value })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="settings" ref={rootRef}>
      {open && (
        <div className="settings__panel" role="dialog" aria-label="Settings">
          <p className="settings__label">Appearance</p>
          <div className="settings__row">
            {THEME_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                className={`settings__option${settings.theme === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings__label">Content width</p>
          <div className="settings__row">
            {CONTENT_WIDTH_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                className={`settings__option${settings.contentWidth === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, contentWidth: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings__label">Line spacing</p>
          <div className="settings__row">
            {LINE_SPACING_PRESETS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                className={`settings__option${settings.lineSpacing === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, lineSpacing: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings__label">Space between blocks</p>
          <div className="settings__row">
            {BLOCK_GAP_PRESETS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                className={`settings__option${settings.blockGap === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, blockGap: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings__label">Bullet threading</p>
          <div className="settings__row">
            {THREADING_OPTIONS.map(({ label, value }) => (
              <button
                key={label}
                type="button"
                className={`settings__option${settings.bulletThreading === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, bulletThreading: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings__label">Thread width</p>
          <div className="settings__row">
            {THREAD_WIDTHS.map((value) => (
              <button
                key={value}
                type="button"
                className={`settings__option${settings.threadWidth === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, threadWidth: value })}
              >
                {value}px
              </button>
            ))}
          </div>
          <p className="settings__label">Thread colour</p>
          <div className="settings__row">
            <input
              type="color"
              className="settings__color"
              aria-label="Thread colour"
              value={settings.threadColor ?? DEFAULT_THREAD_SWATCH}
              onChange={(e) => onChange({ ...settings, threadColor: e.target.value })}
            />
            <button
              type="button"
              className={`settings__option${settings.threadColor === null ? ' settings__option--active' : ''}`}
              disabled={settings.threadColor === null}
              onClick={() => onChange({ ...settings, threadColor: null })}
            >
              Default
            </button>
          </div>
          <p className="settings__label">Comments</p>
          <div className="settings__options">
            {COMMENTS_ORDER_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                className={`settings__option${settings.commentsOrder === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, commentsOrder: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings__section">Files &amp; Links</p>
          {/* GRO-2272: the confirm sheet is the ONLY guard on delete (the OS Trash has no
              programmatic undo), so this defaults ON and the label says what turning it off
              actually means rather than being a bare switch. */}
          <p className="settings__label">Confirm before deleting</p>
          <div className="settings__options">
            {[
              { label: 'On', value: true },
              { label: 'Off', value: false },
            ].map(({ label, value }) => (
              <button
                key={label}
                type="button"
                className={`settings__option${settings.confirmDelete === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, confirmDelete: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings__hint">Deleted notes and folders move to the Trash either way.</p>
          <p className="settings__label">Default location for new notes</p>
          <div className="settings__stack">
            {NEW_NOTE_LOCATION_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                className={`settings__option${settings.newNoteLocation === value ? ' settings__option--active' : ''}`}
                onClick={() => onChange({ ...settings, newNoteLocation: value })}
              >
                {label}
              </button>
            ))}
          </div>
          {settings.newNoteLocation === 'folder' && (
            <input
              type="text"
              className={`settings__input${folderInvalid ? ' settings__input--error' : ''}`}
              aria-label="Folder to create new notes in"
              aria-invalid={folderInvalid}
              placeholder="Example: folder 1/folder 2"
              spellCheck={false}
              value={folderDraft}
              onChange={(e) => {
                setFolderDraft(e.target.value)
                setFolderInvalid(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitFolder(e.currentTarget.value)
              }}
              onBlur={(e) => commitFolder(e.target.value)}
            />
          )}
          {sync !== undefined && (
            <>
              <p className="settings__section">GitHub Sync</p>
              <p className="settings__label">Sync this vault to GitHub</p>
              <div className="settings__options">
                {[
                  { label: 'On', value: true },
                  { label: 'Off', value: false },
                ].map(({ label, value }) => (
                  <button
                    key={label}
                    type="button"
                    // `status.enabled` is the switch's honest read-back, stamped by the engine —
                    // NOT `state`, which is `off` for a vault that is enabled but has no repo or
                    // remote yet (the hint below explains those). A null status — first fetch
                    // still in flight — reads as Off, the safe default.
                    className={`settings__option${(sync.status?.enabled === true) === value ? ' settings__option--active' : ''}`}
                    onClick={() => sync.setEnabled(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="settings__hint">{repoHint(sync.status)}</p>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        className="settings__cog"
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
        </svg>
      </button>
    </div>
  )
}
