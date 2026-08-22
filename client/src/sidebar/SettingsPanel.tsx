import { useEffect, useRef, useState } from 'react'
import { THREAD_WIDTHS, type SettingsState, type Theme } from '@shared/types'

/** Obsidian's Appearance control and order (Desktop K, GRO-2218); App resolves and applies it. */
const THEME_OPTIONS: Array<{ label: string; value: Theme }> = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
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

interface SettingsCogProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
}

/** Cog pinned to the sidebar footer; opens the settings popover above it (GRO-2024). */
export function SettingsCog({ settings, onChange }: SettingsCogProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

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
