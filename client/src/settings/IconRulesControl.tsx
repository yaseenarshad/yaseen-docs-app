import { useRef, useState } from 'react'
import type { IconRule, IconRuleKind } from '@shared/vaultIcons'
import { IconPicker } from '../sidebar/IconPicker'
import { suggestIcons } from '../sidebar/iconSuggestions'
import { iconUrl, isMaterialIcon, useMaterialIcons } from '../sidebar/materialIcons'
import { Segmented } from './controls'
import type { Option } from './options'

const KIND_OPTIONS: readonly Option<IconRuleKind>[] = [
  { label: 'File', value: 'file' },
  { label: 'Folder', value: 'folder' },
]

/** A new rule's icon, and the one a rule switches to with its kind while it still has the other kind's. */
const DEFAULT_ICON: Record<IconRuleKind, string> = { file: 'file', folder: 'folder' }

/** A row of the list: a saved rule, or one being written (an empty pattern is not saved: it would be dropped on read). */
interface Row extends IconRule {
  key: number
}

/**
 * Settings › Sidebar › Icon rules (YAZ-3440 E; a setting since demo round 2): `settings.sidebarIconRules`, one list
 * for every vault. Each rule: a pattern on the NAME (`*` any run, `?` one character, `{a,b}` either; any case), File
 * or Folder, an icon (the sidebar's picker) and a remove button; then "Add rule". The first rule that matches a row
 * wins, and a row's own pick ("Change icon for this file…") wins over every rule. A rule being written (an empty
 * pattern) stays here until it has a pattern: an empty one would be dropped when read.
 */
export function IconRulesControl({ rules, onChange }: { rules: readonly IconRule[]; onChange: (rules: IconRule[]) => void }) {
  useMaterialIcons() // the rule icons show once Material's tables are in (YAZ-3470)
  const nextKey = useRef(0)
  const [drafts, setDrafts] = useState<Row[]>([])
  const [picking, setPicking] = useState<{ key: number; anchor: { left: number; top: number; bottom: number } } | null>(null)
  // Each saved rule keeps its key while the list keeps its length, so an input being typed in is not remounted.
  const keys = useRef<number[]>([])
  while (keys.current.length < rules.length) keys.current.push(nextKey.current++)
  keys.current.length = rules.length
  const rows: Row[] = [...rules.map((rule, i) => ({ ...rule, key: keys.current[i] })), ...drafts]

  const save = (next: Row[]) => {
    const saved = next.filter((row) => row.match.trim() !== '')
    keys.current = saved.map((row) => row.key)
    setDrafts(next.filter((row) => row.match.trim() === ''))
    onChange(saved.map(({ match, kind, icon }) => ({ match: match.trim(), kind, icon })))
  }
  const change = (key: number, patch: Partial<IconRule>) => save(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  const current = picking === null ? undefined : rows.find((row) => row.key === picking.key)

  return (
    <div className="icon-rules">
      {rows.length > 0 && (
        <ul className="icon-rules__list">
          {rows.map((row) => (
            <li key={row.key} className="icon-rules__rule">
              <input
                className="settings__input icon-rules__match"
                aria-label="Name pattern"
                placeholder="*.test.ts"
                spellCheck={false}
                defaultValue={row.match}
                onBlur={(e) => {
                  if (e.target.value !== row.match) change(row.key, { match: e.target.value })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
              <Segmented options={KIND_OPTIONS} value={row.kind} onChange={(kind) => change(row.key, { kind, icon: row.icon === DEFAULT_ICON[row.kind] ? DEFAULT_ICON[kind] : row.icon })} ariaLabel="The rule is for" />
              <button
                type="button"
                className="settings__option icon-rules__icon"
                aria-label={`Icon: ${row.icon}`}
                title={row.icon}
                onClick={(e) => {
                  // Anchored to this button, below it or above it, so the rule's row stays in view (demo round 3).
                  const box = e.currentTarget.getBoundingClientRect()
                  setPicking({ key: row.key, anchor: { left: box.left, top: box.top, bottom: box.bottom } })
                }}
              >
                {isMaterialIcon(row.icon) ? <img src={iconUrl(row.icon)} alt="" width={16} height={16} /> : '?'}
              </button>
              <button type="button" className="settings__option icon-rules__remove" aria-label="Remove rule" title="Remove rule" onClick={() => save(rows.filter((r) => r.key !== row.key))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="settings__option" onClick={() => setDrafts([...drafts, { key: nextKey.current++, match: '', kind: 'file', icon: 'file' }])}>
        Add rule
      </button>
      {picking !== null && current !== undefined && (
        <IconPicker
          x={picking.anchor.left}
          y={picking.anchor.bottom + 4}
          anchor={picking.anchor}
          title={current.match.trim() === '' ? 'Icon for the new rule' : `Icon for rule ${current.match}`}
          current={current.icon}
          canReset={false}
          suggested={suggestIcons(current.match.replace(/^\*/, 'x'), current.kind, current.icon)}
          onPick={(id) => {
            if (id !== null) change(current.key, { icon: id })
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
