import { useState } from 'react'
import { DEFAULT_MOBILE_SETTINGS, type MobileSettingKey } from '@shared/mobileSettings'
import { useApp } from '../app/AppState'
import { useCommentsPort } from '../page/comments/PageComments'
import { useMobileSettings } from '../page/mobileSettings'
import { useVaultData } from '../search/vaultData'
import { ChoiceRows, type Choice } from './ChoiceRow'

/** On / Off, the words of Folding and Sticky headings. */
const ON_OFF: Choice[] = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
]

/** YAZ-5658: Wide tables, a choice (`fitTables`): Same as Desktop (the default) or Fit Screen. */
const WIDE_TABLES: Choice[] = [
  { value: false, label: 'Same as Desktop' },
  { value: true, label: 'Fit Screen' },
]

const ROWS: { key: MobileSettingKey; label: string; choices: Choice[] }[] = [
  { key: 'folding', label: 'Folding', choices: ON_OFF },
  { key: 'stickyHeadings', label: 'Sticky headings', choices: ON_OFF },
  { key: 'fitTables', label: 'Wide tables', choices: WIDE_TABLES },
]

/**
 * Settings › "This vault on mobile" (YAZ-5592), its own chunk: the vault's mobile settings (`.yaseendocs/mobile.json`,
 * `shared/mobileSettings.ts`), the same on every phone that opens the vault: Folding and Sticky headings, on by default;
 * YAZ-5658 Wide tables, Same as Desktop by default. YAZ-5666: each a choice row (two taps to change it, `ChoiceRow.tsx`).
 * A page's own setting (its ⋯) wins. A change shows at once and goes the comments' safe path (`mobileWrite.ts`); the
 * dot counts it until GitHub holds it. With no write path, the rows show the setting and are not changed here.
 */
export default function MobileVaultPart() {
  const app = useApp()
  const data = useVaultData()
  const port = useCommentsPort()
  const { settings, set } = useMobileSettings(data, port)
  const [problem, setProblem] = useState<string | null>(null)
  if (app.vaultKey === null) return null
  const change = (key: MobileSettingKey, on: boolean) => {
    setProblem(null)
    void set?.(key, on).catch(() => setProblem("The phone could not change this vault's setting. Nothing was changed."))
  }
  return (
    <div className="settings-mobile">
      <h2 className="section">This vault on mobile</h2>
      <p className="muted">For every phone that opens this vault. A page's own setting, in its ⋯, wins.</p>
      <ChoiceRows
        label="This vault on mobile"
        disabled={settings === undefined || set === null}
        rows={ROWS.map((r) => ({ id: r.key, label: r.label, value: (settings ?? DEFAULT_MOBILE_SETTINGS)[r.key], choices: r.choices, onChoose: (v) => change(r.key, v === true) }))}
      />
      {problem !== null && (
        <p className="muted" role="status">
          {problem}
        </p>
      )}
    </div>
  )
}
