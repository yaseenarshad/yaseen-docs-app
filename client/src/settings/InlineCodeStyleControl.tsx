/**
 * Settings › Editor › Code blocks › Inline code (YAZ-6452): preset chips, Custom text colour &
 * pill background controls (with Light/Dark-adaptive Match text and Auto tint), Reset, and a live
 * sentence preview with its own Light / Dark toggle. Lazy-loaded from `registry.tsx`.
 */
import { useEffect, useState } from 'react'
import type { InlineCodeCustom, InlineCodePreset, InlineCodeStyle } from '@shared/types'
import { DEFAULT_CUSTOM_INLINE_CODE, inlineCodeAttr, inlineCodeVars, isCustomInlineCode } from './inlineCodeStyle'

type ModeChoice = InlineCodePreset | 'custom'
type PreviewTheme = 'light' | 'dark'

const PRESET_CHOICES: readonly { value: ModeChoice; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'classic', label: 'Classic' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'github', label: 'GitHub' },
  { value: 'accent', label: 'Accent' },
  { value: 'plum', label: 'Plum' },
  { value: 'plain', label: 'Plain' },
  { value: 'custom', label: 'Custom…' },
]

const DEFAULT_CUSTOM_FG_HEX = '#1d4ed8'
const DEFAULT_CUSTOM_BG_HEX = '#e8f0fe'

function initialPreviewTheme(): PreviewTheme {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') return 'dark'
  return 'light'
}

export interface InlineCodeStyleControlProps {
  value: InlineCodeStyle
  onChange: (next: InlineCodeStyle) => void
}

export function InlineCodeStyleControl({ value, onChange }: InlineCodeStyleControlProps) {
  const custom = isCustomInlineCode(value) ? value : null
  const activeMode: ModeChoice = isCustomInlineCode(value) ? 'custom' : value

  const [lastCustom, setLastCustom] = useState<InlineCodeCustom>(() => custom ?? DEFAULT_CUSTOM_INLINE_CODE)
  const [lastFgHex, setLastFgHex] = useState<string>(() => (custom && custom.fg !== 'text' ? custom.fg : DEFAULT_CUSTOM_FG_HEX))
  const [lastBgHex, setLastBgHex] = useState<string>(() => (custom && custom.bg !== 'auto' && custom.bg !== 'none' ? custom.bg : DEFAULT_CUSTOM_BG_HEX))
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>(initialPreviewTheme)

  useEffect(() => {
    if (!isCustomInlineCode(value)) return
    setLastCustom(value)
    if (value.fg !== 'text') setLastFgHex(value.fg)
    if (value.bg !== 'auto' && value.bg !== 'none') setLastBgHex(value.bg)
  }, [value])

  const selectMode = (mode: ModeChoice) => {
    if (mode === 'custom') {
      if (!custom) onChange(lastCustom)
      return
    }
    if (mode !== value) onChange(mode)
  }

  const updateCustom = (patch: Partial<InlineCodeCustom>) => {
    const base = custom ?? lastCustom
    const next: InlineCodeCustom = { ...base, ...patch }
    setLastCustom(next)
    if (next.fg !== 'text') setLastFgHex(next.fg)
    if (next.bg !== 'auto' && next.bg !== 'none') setLastBgHex(next.bg)
    onChange(next)
  }

  const fgMode: 'text' | 'hex' = custom && custom.fg !== 'text' ? 'hex' : 'text'
  const bgMode: 'auto' | 'none' | 'hex' = custom ? (custom.bg === 'auto' ? 'auto' : custom.bg === 'none' ? 'none' : 'hex') : 'auto'
  const attr = inlineCodeAttr(value)
  const vars = inlineCodeVars(value)

  return (
    <div className="inline-code-control">
      <div className="inline-code-control__presets-row">
        <div className="settings__options inline-code-control__presets" role="group" aria-label="Inline code style">
          {PRESET_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={`settings__option${activeMode === choice.value ? ' settings__option--active' : ''}`}
              aria-pressed={activeMode === choice.value}
              onClick={() => selectMode(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {value !== 'default' && (
          <button type="button" className="settings__option inline-code-control__reset" onClick={() => onChange('default')}>
            Reset
          </button>
        )}
      </div>

      {custom !== null && (
        <div className="inline-code-control__custom">
          <div className="inline-code-control__field">
            <span className="inline-code-control__label">Text colour</span>
            <div className="inline-code-control__choices">
              <div className="settings__options" role="group" aria-label="Inline code text colour mode">
                <button
                  type="button"
                  className={`settings__option${fgMode === 'text' ? ' settings__option--active' : ''}`}
                  aria-pressed={fgMode === 'text'}
                  onClick={() => updateCustom({ fg: 'text' })}
                >
                  Match text (Light/Dark)
                </button>
                <button
                  type="button"
                  className={`settings__option${fgMode === 'hex' ? ' settings__option--active' : ''}`}
                  aria-pressed={fgMode === 'hex'}
                  onClick={() => updateCustom({ fg: lastFgHex })}
                >
                  Custom colour
                </button>
              </div>
              {fgMode === 'hex' && (
                <span className="inline-code-control__picker">
                  <input
                    type="color"
                    className="settings__color"
                    aria-label="Inline code text colour"
                    value={custom.fg}
                    onChange={(e) => updateCustom({ fg: e.target.value })}
                  />
                  <span className="inline-code-control__hex">{custom.fg}</span>
                </span>
              )}
            </div>
          </div>

          <div className="inline-code-control__field">
            <span className="inline-code-control__label">Pill background</span>
            <div className="inline-code-control__choices">
              <div className="settings__options" role="group" aria-label="Inline code pill background mode">
                <button
                  type="button"
                  className={`settings__option${bgMode === 'auto' ? ' settings__option--active' : ''}`}
                  aria-pressed={bgMode === 'auto'}
                  onClick={() => updateCustom({ bg: 'auto' })}
                >
                  Auto tint (Light/Dark)
                </button>
                <button
                  type="button"
                  className={`settings__option${bgMode === 'none' ? ' settings__option--active' : ''}`}
                  aria-pressed={bgMode === 'none'}
                  onClick={() => updateCustom({ bg: 'none' })}
                >
                  None
                </button>
                <button
                  type="button"
                  className={`settings__option${bgMode === 'hex' ? ' settings__option--active' : ''}`}
                  aria-pressed={bgMode === 'hex'}
                  onClick={() => updateCustom({ bg: lastBgHex })}
                >
                  Custom colour
                </button>
              </div>
              {bgMode === 'hex' && (
                <span className="inline-code-control__picker">
                  <input
                    type="color"
                    className="settings__color"
                    aria-label="Inline code background colour"
                    value={custom.bg}
                    onChange={(e) => updateCustom({ bg: e.target.value })}
                  />
                  <span className="inline-code-control__hex">{custom.bg}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="inline-code-preview">
        <div className="inline-code-preview__header">
          <span className="inline-code-preview__label">Preview</span>
          <div className="settings__options inline-code-preview__themes" role="group" aria-label="Preview theme">
            <button
              type="button"
              className={`settings__option inline-code-preview__theme-btn${previewTheme === 'light' ? ' settings__option--active' : ''}`}
              aria-pressed={previewTheme === 'light'}
              onClick={() => setPreviewTheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={`settings__option inline-code-preview__theme-btn${previewTheme === 'dark' ? ' settings__option--active' : ''}`}
              aria-pressed={previewTheme === 'dark'}
              onClick={() => setPreviewTheme('dark')}
            >
              Dark
            </button>
          </div>
        </div>
        <div
          className="inline-code-preview__surface"
          data-preview="inline-code"
          data-theme={previewTheme}
          data-inline-code-style={attr}
          style={vars}
        >
          <div className="editor-instance inline-code-preview__page">
            <div className="milkdown">
              <div className="ProseMirror">
                <p>
                  When we updated <code>App.tsx</code> and <code>/api/launchers</code>, inline code stayed easy to scan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
