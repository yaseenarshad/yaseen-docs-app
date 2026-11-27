/**
 * One settings row (YAZ-1679 D7): label and hint on the left, the control on the right, a hairline
 * between rows in a card (settings.css `.setting + .setting`). `data-setting` is the row's stable
 * address — tests and the e2e specs find a row by it rather than by position or label text.
 * `wide` stacks the control full-width under the text for the two controls a right-hand cell
 * cannot hold: the new-page folder input and the hotkey tables. `bare` drops the text too, for a
 * control that carries its own words (Storage, Sharing; YAZ-3039) or a group whose title already
 * names the row (Text formatting, YAZ-3068 D16).
 */
import type { ReactNode } from 'react'
import type { SettingRowScopeMeta } from './settingsScope'

interface SettingRowProps extends SettingRowScopeMeta {
  id: string
  label: string
  hint?: string
  wide?: boolean
  /**
   * The control alone, full width, with no label on screen. Two uses: a control that carries its own
   * words (YAZ-1801, YAZ-3039 — Settings › Storage's and Sharing's lists), and the Text formatting
   * lines, whose group title already names them (YAZ-3068 D16). The label and hint still feed
   * search, and the label names the row for a screen reader.
   */
  bare?: boolean
  children: ReactNode
}

export function SettingRow({
  id,
  label,
  hint,
  wide = false,
  bare = false,
  overridden = false,
  onReset,
  overriddenIn,
  scopeBadge,
  workspaceWinsName,
  onJumpToWorkspace,
  children,
}: SettingRowProps) {
  const scopeWarn = workspaceWinsName !== undefined && (
    <p className="setting__scope-warn">
      Used when opened alone · This window uses {workspaceWinsName}.
      {onJumpToWorkspace !== undefined && (
        <button type="button" className="setting__scope-jump" onClick={onJumpToWorkspace}>
          Edit workspace
        </button>
      )}
    </p>
  )
  if (bare) {
    return (
      <div className={`setting setting--bare${overridden ? ' setting--overridden' : ''}`} data-setting={id} role="group" aria-label={label}>
        {scopeWarn}
        {children}
      </div>
    )
  }
  return (
    <div className={`setting${wide ? ' setting--wide' : ''}${overridden ? ' setting--overridden' : ''}`} data-setting={id}>
      <div className="setting__text">
        <div className="setting__label-row">
          {overridden && <span className="setting__override-dot" title="Overridden from global default" aria-label="Overridden" />}
          <p className="setting__label">{label}</p>
          {scopeBadge !== undefined && <span className="setting__scope-badge">{scopeBadge}</span>}
          {overridden && onReset !== undefined && (
            <button type="button" className="setting__reset" onClick={onReset} aria-label={`Reset ${label} to global default`}>
              Reset
            </button>
          )}
        </div>
        {overriddenIn !== undefined && <p className="setting__scope-note">Overridden in {overriddenIn}</p>}
        {scopeWarn}
        {hint !== undefined && <p className="setting__hint">{hint}</p>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}
