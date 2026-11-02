/**
 * Settings › Editor › Calendar tables › Calendar day (YAZ-4163 demo): "from" and "to", each a dropdown of the half
 * hours in the time format setting. "to" lists only the times after "from", and "from" only those before "to", so the
 * day is never empty. "/Calendar table", "Time slots" and "Fill the calendar day" read it (`timeFormatSetting.ts`).
 */
import { formatTime } from '@shared/timeFormat'
import type { SettingsState } from '@shared/types'
import { Select } from './controls'

interface CalendarDayControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
}

/** Every half hour of the day, 12:00 am to 11:30 pm. */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30)

export function CalendarDayControl({ settings, onChange }: CalendarDayControlProps) {
  const { tableDayStart: start, tableDayEnd: end, tableTimeFormat: format } = settings
  const option = (t: number) => ({ label: formatTime(format, t), value: t })
  return (
    <span className="settings__style-pick">
      <Select options={HALF_HOURS.filter((t) => t < end).map(option)} value={start} onChange={(tableDayStart) => onChange({ ...settings, tableDayStart })} ariaLabel="Calendar day from" />
      <span>to</span>
      <Select options={HALF_HOURS.filter((t) => t > start).map(option)} value={end} onChange={(tableDayEnd) => onChange({ ...settings, tableDayEnd })} ariaLabel="Calendar day to" />
    </span>
  )
}
