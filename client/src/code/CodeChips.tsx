/**
 * The code tab's own chips (YAZ-3449), drawn first in the document host's row (`DocumentChips`' `lead`),
 * in a note's order: the fold-all button (YAZ-3938 D4), the page cog, the text size pill (YAZ-3451), then
 * the Read only chip while the tab is locked. The sync and save chips follow from the host.
 *
 * The cog's first three rows are APP SETTINGS (YAZ-3438 D5, D6, D8), under the heading "All code files", each row
 * on one line: each one changes every code tab at once, the same field as its row in Settings › Code. The fourth,
 * "Table of contents" (YAZ-3506), after a line, is THIS file's, as a note's cog row is: saved for the file in the
 * app state (`tocSwitches`), because a code file has no frontmatter (a note's is in the note, YAZ-4094 G4). The chip is this tab's: a time choice in its box
 * unlocks this tab for 1 minute, 10 minutes or until it closes (YAZ-4939), and the setting stays on; so does the vault's Read only.
 */
import { DocumentZoom } from '../editor/DocumentZoom'
import { FoldAllButton, type FoldNext } from '../editor/FoldAllButton'
import { PageSettings, type PageSwitch } from '../editor/PageSettings'
import { ReadOnlyChip } from '../editor/ReadOnlyChip'
import type { AllowFor } from '../editor/useTimedUnlock'
import type { CodeSettings } from './codeSettings'

export interface CodeChipsProps {
  settings: CodeSettings
  onChangeSettings?: (patch: Partial<CodeSettings>) => void
  /** This file's "Table of contents" switch (YAZ-3506). The tab always passes it (YAZ-3558 D1); absent → no row. */
  tableOfContents?: { on: boolean; onToggle: () => void }
  /** This tab's text size, percent (YAZ-3451): the note's pill, never stored. */
  zoom: number
  onZoom: (zoom: number) => void
  /** This tab is under Read only: the setting, or the vault's (YAZ-4939). The chip shows while it is, locked or editing for a time. */
  locked: boolean
  /** The chip's "Allow edits?" box is open. */
  asking: boolean
  onAsk: () => void
  onAllow: (choice: AllowFor) => void
  onCancel: () => void
  /** A timed unlock runs (YAZ-4939): when it ends, or Infinity until the tab closes; null = locked. */
  editingUntil: number | null
  onLock: () => void
  /** The fold-all button (YAZ-3938 D4, D9): what a click does now, the fold itself, and the fold changes to read again after. */
  fold: { read: () => Promise<FoldNext>; run: (collapse: boolean) => void; subscribe: (changed: () => void) => () => void }
}

export function CodeChips({ settings, onChangeSettings, tableOfContents, zoom, onZoom, locked, asking, onAsk, onAllow, onCancel, editingUntil, onLock, fold }: CodeChipsProps) {
  const row = (label: string, key: keyof CodeSettings): PageSwitch => ({ label, on: settings[key], onToggle: () => onChangeSettings?.({ [key]: !settings[key] }) })
  // No door to the settings (a test, a host that has none): no cog, since its rows could change nothing.
  const switches = onChangeSettings === undefined ? null : [row('Read only', 'codeReadOnly'), row('Wrap long lines', 'codeWrap'), row('Minimap', 'codeMinimap')]
  return (
    <>
      <FoldAllButton read={fold.read} run={fold.run} subscribe={fold.subscribe} keys={{ collapse: 'code.foldEveryBlock', expand: 'code.unfoldEveryBlock' }} />
      {switches !== null && <PageSettings switches={switches} switchesHeading="All code files" tableOfContents={tableOfContents?.on} onToggleTableOfContents={tableOfContents?.onToggle} />}
      <DocumentZoom value={zoom} onChange={onZoom} />
      {locked && <ReadOnlyChip asking={asking} onAsk={onAsk} onAllow={onAllow} onCancel={onCancel} editingUntil={editingUntil} onLock={onLock} />}
    </>
  )
}
