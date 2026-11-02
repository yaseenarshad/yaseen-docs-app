/**
 * Settings › Editor › Tables › Time format (YAZ-4163, YAZ-4159 D15), modelled on the daily note's name style
 * (`DailyNoteFormatControl.tsx`): the three ready styles, each shown as the time now, and "Custom…". A custom style is
 * draft + commit (Enter or blur): one the app cannot read back keeps the STORED style, marks the input and says why.
 */
import { useEffect, useState } from 'react'
import { TIME_FORMAT_STYLES, TIME_TOKENS, formatTime, timeFormatProblem } from '@shared/timeFormat'
import type { SettingsState } from '@shared/types'
import { Select } from './controls'

interface TimeFormatControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
}

const CUSTOM = 'custom'
const isReady = (format: string): boolean => (TIME_FORMAT_STYLES as readonly string[]).includes(format)
/** The examples show 9:00 in the morning, as the setting's labels say. */
const EXAMPLE = 9 * 60

export function TimeFormatControl({ settings, onChange }: TimeFormatControlProps) {
  const format = settings.tableTimeFormat
  // "Custom…" stays chosen while its draft is a ready style: the person is typing, not picking.
  const [custom, setCustom] = useState(!isReady(format))
  const [draft, setDraft] = useState(format)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    setDraft(format)
    setProblem(null)
  }, [format])

  const options = [...TIME_FORMAT_STYLES.map((style) => ({ label: formatTime(style, EXAMPLE), value: style as string })), { label: 'Custom…', value: CUSTOM }]
  const commit = (raw: string) => {
    const why = timeFormatProblem(raw)
    setProblem(why)
    if (why === null && raw !== format) onChange({ ...settings, tableTimeFormat: raw })
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
            onChange({ ...settings, tableTimeFormat: value })
          }}
          ariaLabel="Time format"
        />
        {custom && (
          <input
            type="text"
            className={`settings__input settings__input--fill${problem !== null ? ' settings__input--error' : ''}`}
            aria-label="Custom time format"
            aria-invalid={problem !== null}
            placeholder="Example: hh:mm A"
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
      {custom &&
        (problem !== null ? (
          <span className="settings__error">{problem}</span>
        ) : (
          <span className="settings__tokens">{TIME_TOKENS.map((t) => `${t.token} ${t.example}`).join(' · ')} (at 9:05 pm). Put other words in [ ].</span>
        ))}
    </>
  )
}
