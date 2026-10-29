/**
 * Settings › Files & Links › Daily notes (YAZ-3607 D8): the two rows that need more than a switch.
 *
 * - The folder: its path and "Change…", which opens the place picker (YAZ-3556 D6) on the window's folders. The pick is
 *   stored by its path in the vault ('' = the vault folder), the `newNoteFolder` rule (D2). A window with no vault has
 *   no picker. "Open template" opens the folder's hidden `.template.md` in a tab (D6): a template is hidden in the
 *   sidebar, so this is how a person finds it.
 * - The name style (D4): the four ready styles, each shown as today's name, and "Custom…". A custom style is draft +
 *   commit (Enter or blur), as the new-note folder input is: one the app cannot use keeps the STORED style, marks the
 *   input and says why under it.
 */
import { useEffect, useState } from 'react'
import { DAILY_NOTE_STYLES, DAILY_NOTE_TOKENS, dailyNoteFormatProblem, dailyNoteName } from '@shared/dailyNote'
import type { SettingsState } from '@shared/types'
import { placePath, placeRel } from '../sidebar/goToPlace'
import { PlacePicker, type PlaceVault } from '../sidebar/PlacePicker'
import { Select } from './controls'

interface DailyNoteControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  /** The window's vaults, the active tab's first (`SettingsCtx.places`); absent in a window with no vault. */
  vaults?: readonly PlaceVault[]
  /** "Open template" (D6): App's `openDailyTemplate`; absent in a window with no vault. */
  onOpenTemplate?: () => void
}

export function DailyNoteFolderControl({ settings, onChange, vaults, onOpenTemplate }: DailyNoteControlProps) {
  const [picking, setPicking] = useState(false)
  const folder = settings.dailyNoteFolder
  return (
    <>
      <span className="settings__place">
        <span className="settings__place-path" title={folder}>
          {folder === '' ? 'The vault folder' : folder}
        </span>
        <button type="button" className="settings__option" disabled={vaults === undefined || vaults.length === 0} onClick={() => setPicking(true)}>
          Change…
        </button>
        <button type="button" className="settings__option" disabled={onOpenTemplate === undefined} onClick={onOpenTemplate}>
          Open template
        </button>
      </span>
      {picking && vaults !== undefined && (
        <PlacePicker
          vaults={vaults}
          start={placePath(vaults[0].root, folder)}
          label="Choose the daily notes folder"
          onPick={(path, vault) => {
            setPicking(false)
            onChange({ ...settings, dailyNoteFolder: placeRel(vault, path) })
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

const CUSTOM = 'custom'
const isReady = (format: string): boolean => (DAILY_NOTE_STYLES as readonly string[]).includes(format)

export function DailyNoteFormatControl({ settings, onChange }: DailyNoteControlProps) {
  const format = settings.dailyNoteFormat
  // "Custom…" stays chosen while its draft is a ready style: the person is typing, not picking.
  const [custom, setCustom] = useState(!isReady(format))
  const [draft, setDraft] = useState(format)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    setDraft(format)
    setProblem(null)
  }, [format])

  const today = new Date()
  const options = [
    ...DAILY_NOTE_STYLES.map((style) => ({
      label: dailyNoteName(style, today),
      value: style as string,
    })),
    { label: 'Custom…', value: CUSTOM },
  ]
  const commit = (raw: string) => {
    const why = dailyNoteFormatProblem(raw)
    setProblem(why)
    if (why === null && raw !== format) onChange({ ...settings, dailyNoteFormat: raw })
  }

  return (
    <>
      <span className="settings__style-pick">
        <Select
          options={options}
          value={custom ? CUSTOM : format}
          onChange={(value) => {
            if (value === CUSTOM) return setCustom(true)
            setCustom(false)
            onChange({ ...settings, dailyNoteFormat: value })
          }}
          ariaLabel="Name style"
        />
        {custom && (
          <input
            type="text"
            className={`settings__input settings__input--fill${problem !== null ? ' settings__input--error' : ''}`}
            aria-label="Custom name style"
            aria-invalid={problem !== null}
            placeholder="Example: MM_DD- ddd"
            spellCheck={false}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setProblem(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value)
            }}
            onBlur={(e) => commit(e.target.value)}
          />
        )}
      </span>
      {custom && (
        <>
          {problem !== null ? (
            <span className="settings__error">{problem}</span>
          ) : (
            <span className="settings__tokens">{DAILY_NOTE_TOKENS.map((t) => `${t.token} ${t.example}`).join(' · ')}. Put other words in [ ], like [Daily].</span>
          )}
        </>
      )}
    </>
  )
}
