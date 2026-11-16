import { useState } from 'react'
import type { MobileSettingKey } from '@shared/mobileSettings'
import { useApp } from '../app/AppState'
import { useCommentsPort } from '../page/comments/PageComments'
import { useMobileSettings } from '../page/mobileSettings'
import { useVaultData } from '../search/vaultData'

const ROWS: { key: MobileSettingKey; label: string }[] = [
  { key: 'folding', label: 'Folding' },
  { key: 'stickyHeadings', label: 'Sticky headings' },
]

/** YAZ-5658: Wide tables, a choice (`fitTables`): Scroll sideways (the default) or Fit the screen. */
export const WIDE_TABLE_CHOICES: { fit: boolean; label: string }[] = [
  { fit: false, label: 'Scroll sideways' },
  { fit: true, label: 'Fit the screen' },
]

/**
 * Settings › "This vault on mobile" (YAZ-5592), its own chunk: the vault's mobile settings (`.yaseendocs/mobile.json`,
 * `shared/mobileSettings.ts`), the same on every phone that opens the vault: Folding and Sticky headings, on by default;
 * YAZ-5658 Wide tables, Scroll sideways by default.
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
      <div className="sheet" role="group" aria-label="This vault on mobile">
        {ROWS.map((r) => (
          <label key={r.key} className="row">
            <input
              type="checkbox"
              className="check"
              checked={settings?.[r.key] ?? true}
              disabled={settings === undefined || set === null}
              onChange={(e) => change(r.key, e.target.checked)}
            />
            <span className="row__main">{r.label}</span>
          </label>
        ))}
      </div>
      <p className="muted">Wide tables: a table wider than the screen.</p>
      <div className="sheet" role="radiogroup" aria-label="Wide tables">
        {WIDE_TABLE_CHOICES.map((c) => (
          <label key={c.label} className="row">
            <input
              type="radio"
              className="check"
              name="wide-tables"
              checked={(settings?.fitTables ?? false) === c.fit}
              disabled={settings === undefined || set === null}
              onChange={() => change('fitTables', c.fit)}
            />
            <span className="row__main">{c.label}</span>
          </label>
        ))}
      </div>
      {problem !== null && (
        <p className="muted" role="status">
          {problem}
        </p>
      )}
    </div>
  )
}
