import type { ReactNode } from 'react'
import { FOLDER_PAGE_CHOICES, HEADER_ROW_CHOICES, HEADER_ROW_PARTS, headerRowLabel, type FolderPagesSettings, type HeaderRowOwn } from '@shared/types'
import { capital } from '../../editor/table/colours'
import { ColourSwatches } from './ColourPanel'
import { headerRowSetting } from '../../editor/table/timeFormatSetting'
import { groupLineStyleOf, groupLinesOf, headerRowOfView, type Mutate, type ViewDef } from '../viewSchema'
import { FromSettings, chooseOwn, useViewDefaults } from '../viewDefaults'
import { ChoiceSeg, RowLabel } from './settingRow'

/** A view's Text in cells (YAZ-4544 10A, D34): its own choice, else Settings › Folder pages. A column's own Wrap or Clip beats both (D29). */
export function textInCellsOf(view: ViewDef, defaults: FolderPagesSettings): FolderPagesSettings['textInCells'] {
  const own = view.textInCells
  return own !== undefined && (FOLDER_PAGE_CHOICES.textInCells as readonly string[]).includes(own) ? own : defaults.textInCells
}

const ROW_HEIGHT_LABELS: Record<FolderPagesSettings['rowHeight'], string> = { short: 'Short', medium: 'Medium', tall: 'Tall' }
const TEXT_IN_CELLS_LABELS: Record<FolderPagesSettings['textInCells'], string> = { kind: 'By kind', wrap: 'Wrap', clip: 'Clip' }

/**
 * How one table view looks (YAZ-4544 10A, D34): Row height and Text in cells, each a Settings › Folder pages default
 * with the view's own choice, the grey "from Settings" and Reset. One block, so it can move as a whole (D59's View tab).
 * `view` has Settings filled in (`withDefaults`); `own` is the view as written.
 */
export function TableLookSettings({ view, own, viewIndex, onUpdate }: { view: ViewDef; own: ViewDef; viewIndex: number; onUpdate: Mutate }) {
  const defaults = useViewDefaults()
  const rowHeight = (FOLDER_PAGE_CHOICES.rowHeight as readonly string[]).includes(view.rowHeight ?? '') ? (view.rowHeight as FolderPagesSettings['rowHeight']) : 'short'
  return (
    <>
      <div className="view-settings-row">
        <RowLabel icon="rowHeight">Row height</RowLabel>
        <ChoiceSeg label="Row height" value={rowHeight} options={FOLDER_PAGE_CHOICES.rowHeight.map((h) => [h, ROW_HEIGHT_LABELS[h]] as const)} onChange={(next) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'rowHeight', next, defaults))} />
        <FromSettings own={own} viewKey="rowHeight" viewIndex={viewIndex} onUpdate={onUpdate} />
      </div>
      <div className="view-settings-row" title="By kind: lists, links and selects wrap; text, numbers and dates are one line. A column's own Wrap or Clip wins.">
        <RowLabel icon="textInCells">Text in cells</RowLabel>
        <ChoiceSeg
          label="Text in cells"
          value={textInCellsOf(view, defaults)}
          options={FOLDER_PAGE_CHOICES.textInCells.map((t) => [t, TEXT_IN_CELLS_LABELS[t]] as const)}
          onChange={(next) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'textInCells', next, defaults))}
        />
        <FromSettings own={own} viewKey="textInCells" viewIndex={viewIndex} onUpdate={onUpdate} />
      </div>
    </>
  )
}

const GROUP_LINES_LABELS: Record<FolderPagesSettings['groupLines'], string> = { hover: 'On hover', always: 'On', off: 'Off' }
const GROUP_LINE_STYLE_LABELS: Record<FolderPagesSettings['groupLineStyle'], string> = { plain: 'Lines', thread: 'Thread' }

/**
 * Where you are in a grouped table (YAZ-4798): Sticky group headers, Group lines and Group line style, each a Settings ›
 * Folder pages default with the view's own choice and the ↺ back to Settings, as Row height. View › Groups shows them
 * only while the table groups; an ungrouped table draws neither. `view` has Settings filled in; `own` is as written.
 */
export function GroupGuideSettings({ view, own, viewIndex, onUpdate }: { view: ViewDef; own: ViewDef; viewIndex: number; onUpdate: Mutate }) {
  const defaults = useViewDefaults()
  return (
    <>
      <label className="view-settings-row" title="The headers of the groups you are in stay at the top while the rows scroll. A click on one goes back to its group's top.">
        <RowLabel icon="stickyGroups">Sticky group headers</RowLabel>
        <input type="checkbox" role="switch" aria-label="Sticky group headers" checked={view.stickyGroups === true} onChange={(e) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'stickyGroups', e.target.checked, defaults))} />
        <FromSettings own={own} viewKey="stickyGroups" viewIndex={viewIndex} onUpdate={onUpdate} />
      </label>
      <div className="view-settings-row" title="A thin line from each open group's header down to its last row. On hover: while the mouse is over the table.">
        <RowLabel icon="groupLines">Group lines</RowLabel>
        <ChoiceSeg label="Group lines" value={groupLinesOf(view)} options={FOLDER_PAGE_CHOICES.groupLines.map((v) => [v, GROUP_LINES_LABELS[v]] as const)} onChange={(next) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'groupLines', next, defaults))} />
        <FromSettings own={own} viewKey="groupLines" viewIndex={viewIndex} onUpdate={onUpdate} />
      </div>
      <div className="view-settings-row" title="Thread colours the lines and the headers of the groups that hold the row under the mouse.">
        <RowLabel icon="groupLineStyle">Line style</RowLabel>
        <ChoiceSeg label="Group line style" value={groupLineStyleOf(view)} options={FOLDER_PAGE_CHOICES.groupLineStyle.map((v) => [v, GROUP_LINE_STYLE_LABELS[v]] as const)} onChange={(next) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'groupLineStyle', next, defaults))} />
        <FromSettings own={own} viewKey="groupLineStyle" viewIndex={viewIndex} onUpdate={onUpdate} />
      </div>
    </>
  )
}

/** Settings › Tables › Header row as a folder table takes it: no Text colour there is Muted, its look before (YAZ-4774). */
export const folderHeaderRow = (): Required<HeaderRowOwn> => {
  const settings = headerRowSetting()
  return { ...settings, text: settings.text ?? 'muted' }
}

/** What a folder table's header row shows (YAZ-4794): the view's own parts over Settings'. */
export const shownHeaderRow = (view: ViewDef): Required<HeaderRowOwn> => ({ ...folderHeaderRow(), ...headerRowOfView(view) })

/** The view's own header row as `next`, less the parts equal to Settings (YAZ-4774); the first build's `shadedHeader` goes. */
function writeHeaderRow(view: ViewDef, next: HeaderRowOwn): void {
  const settings = folderHeaderRow()
  for (const p of HEADER_ROW_PARTS) if (next[p] === settings[p]) delete next[p]
  delete view.shadedHeader
  if (Object.keys(next).length > 0) view.headerRow = next
  else delete view.headerRow
}

/**
 * One header row pick on a view (YAZ-4794): the View tab's and the column header's "Header row ›" ONE writer. A pick
 * that equals Settings removes the part, as `chooseOwn` does.
 */
export function setHeaderRowPart(view: ViewDef, part: keyof HeaderRowOwn, value: string): void {
  writeHeaderRow(view, { ...headerRowOfView(view), [part]: value } as HeaderRowOwn)
}

/** Does the header row look like any row (YAZ-4793, YAZ-4794): no shade, regular, full text? */
export const plainHeaderRow = (shown: Required<HeaderRowOwn>): boolean => shown.strength === 'off' && shown.weight === 'regular' && shown.text === 'full'

/** "Plain, like any row" (YAZ-4794, as a note table's YAZ-4793): one pick sets the three parts; on a plain row it hands them back to Settings. */
export function toggleHeaderRowPlain(view: ViewDef): void {
  const next: HeaderRowOwn = { ...headerRowOfView(view) }
  if (plainHeaderRow(shownHeaderRow(view))) {
    delete next.strength
    delete next.weight
    delete next.text
  } else Object.assign(next, { strength: 'off', weight: 'regular', text: 'full' } satisfies HeaderRowOwn)
  writeHeaderRow(view, next)
}

/**
 * A folder table's header row (YAZ-4774): Color, Strength and Text, each the view's own part (`headerRow`) or
 * Settings › Tables › Header row's. A pick that equals Settings removes the part, as `chooseOwn` does; the ↺ removes
 * them all. The first build's `shadedHeader` reads as Strength and goes at the next pick (`headerRowOfView`).
 * YAZ-4794: Fill colour, Strength, Weight, Text colour (Muted, Full, the eight colours) and Align (Follow column, Left,
 * Center, Right). YAZ-4908: a "Header row" section of the View tab — its heading carries the ↺, `children` (Column
 * type icons) comes first, and each row ends in the rows' right-hand slot, so the controls stand in one column. The
 * text colour's swatches are a row of their own: on one line with Muted · Full they did not fit the tab's width.
 */
export function HeaderRowSettings({ own, viewIndex, onUpdate, children }: { own: ViewDef; viewIndex: number; onUpdate: Mutate; children?: ReactNode }) {
  const shown = shownHeaderRow(own)
  const pick = (part: keyof HeaderRowOwn, value: string) => onUpdate((d) => setHeaderRowPart(d.views[viewIndex], part, value))
  // The swatches are the colour panel's (`ColourPanel.tsx`, YAZ-4878), so a colour looks the same here, on a line and on a card.
  const swatches = (part: 'color' | 'text', colors: readonly string[], label: string) => <ColourSwatches label={label} colors={colors} value={shown[part]} onPick={(c) => pick(part, c)} />
  /** The empty right-hand slot every row with a Settings default has (`FromSettings`): the whole header row's ↺ is on the heading. */
  const slot = <span className="view-from-settings" aria-hidden="true" />
  return (
    <>
      <div className="view-menu__label view-menu__label--row">
        <span>Header row</span>
        <FromSettings own={own} viewKey="headerRow" viewIndex={viewIndex} onUpdate={onUpdate} />
      </div>
      {children}
      <div className="view-settings-row view-settings-row--sub">
        <span>Fill colour</span>
        {swatches('color', HEADER_ROW_CHOICES.color, 'Header row fill colour')}
        {slot}
      </div>
      <div className="view-settings-row view-settings-row--sub">
        <span>Strength</span>
        <ChoiceSeg<string> label="Header row strength" value={shown.strength} options={HEADER_ROW_CHOICES.strength.map((v) => [v, capital(v)] as const)} onChange={(next) => pick('strength', next)} />
        {slot}
      </div>
      <div className="view-settings-row view-settings-row--sub">
        <span>Weight</span>
        <ChoiceSeg<string> label="Header row text weight" value={shown.weight} options={HEADER_ROW_CHOICES.weight.map((v) => [v, capital(v)] as const)} onChange={(next) => pick('weight', next)} />
        {slot}
      </div>
      <div className="view-settings-row view-settings-row--sub">
        <span>Text colour</span>
        <ChoiceSeg<string> label="Header row text colour" value={shown.text} options={(['muted', 'full'] as const).map((v) => [v, capital(v)] as const)} onChange={(next) => pick('text', next)} />
        {slot}
      </div>
      <div className="view-settings-row view-settings-row--sub">
        <span aria-hidden="true" />
        {swatches('text', HEADER_ROW_CHOICES.text.filter((v) => v !== 'muted' && v !== 'full'), 'Header row text colour')}
        {slot}
      </div>
      <div className="view-settings-row view-settings-row--sub">
        <span>Align</span>
        <ChoiceSeg<string> label="Header row align" value={shown.align} options={HEADER_ROW_CHOICES.align.map((v) => [v, headerRowLabel(v)] as const)} onChange={(next) => pick('align', next)} />
        {slot}
      </div>
    </>
  )
}
