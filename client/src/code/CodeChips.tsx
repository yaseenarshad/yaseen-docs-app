/**
 * The code tab's own chips (YAZ-3449), drawn first in the document host's row (`DocumentChips`' `lead`),
 * in a note's order: the page cog, the text size pill (YAZ-3451), then the Read only chip while the tab
 * is locked. The sync and save chips follow from the host.
 *
 * The cog's three rows are APP SETTINGS (YAZ-3438 D5, D6, D8): each one changes every code tab at once,
 * the same field as its row in Settings › Code. The chip is this tab's: "Allow edits" unlocks this tab
 * until it closes, and the setting stays on.
 */
import { DocumentZoom } from '../editor/DocumentZoom'
import { PageSettings, type PageSwitch } from '../editor/PageSettings'
import { ReadOnlyChip } from '../editor/ReadOnlyChip'
import type { CodeSettings } from './codeSettings'

export interface CodeChipsProps {
  settings: CodeSettings
  onChangeSettings?: (patch: Partial<CodeSettings>) => void
  /** This tab's text size, percent (YAZ-3451): the note's pill, never stored. */
  zoom: number
  onZoom: (zoom: number) => void
  /** This tab is read only now: the setting is on and the tab is not unlocked. */
  locked: boolean
  /** The chip's "Allow edits?" box is open. */
  asking: boolean
  onAsk: () => void
  onAllow: () => void
  onCancel: () => void
}

export function CodeChips({ settings, onChangeSettings, zoom, onZoom, locked, asking, onAsk, onAllow, onCancel }: CodeChipsProps) {
  const row = (label: string, key: keyof CodeSettings): PageSwitch => ({ label, on: settings[key], onToggle: () => onChangeSettings?.({ [key]: !settings[key] }) })
  // No door to the settings (a test, a host that has none): no cog, since its rows could change nothing.
  const switches = onChangeSettings === undefined ? null : [row('Read only (all code files)', 'codeReadOnly'), row('Wrap long lines', 'codeWrap'), row('Minimap', 'codeMinimap')]
  return (
    <>
      {switches !== null && <PageSettings switches={switches} />}
      <DocumentZoom value={zoom} onChange={onZoom} />
      {locked && <ReadOnlyChip asking={asking} onAsk={onAsk} onAllow={onAllow} onCancel={onCancel} />}
    </>
  )
}
