import { FOLDER_PAGE_CHOICES, HEADER_ROW_PARTS, type FolderPagesSettings, type HeaderRowOwn } from '@shared/types'
import { HeaderStyleControl } from './StylePanel'
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

/** "Plain, like any row" (YAZ-4794, as a page table's YAZ-4793): one pick sets the three parts; on a plain row it hands them back to Settings. */
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
 * A folder table's or a calendar's header row (YAZ-4774, YAZ-4864 round 3): ONE row, "<label> [Aa ▾]" — a chip in the
 * current fill, text colour and weight, and under it the table's "Header row ›" panel (`StylePanel.tsx`): Plain, like
 * any row · Fill / Text / Style · Off / Light / Medium / Strong · the colours; Style holds Weight and Align. Each part
 * is the view's own (`headerRow`) or Settings › Tables › Header row's; a pick that equals Settings removes the part, as
 * `chooseOwn` does; the row's ↺ removes them all. The first build's `shadedHeader` reads as Strength and goes at the
 * next pick (`headerRowOfView`). Yaseen: "is ther a better way we can represent the header row formatting options in
 * a way that isnt as verbose?"
 */
export function HeaderRowStyleRow({ label, own, viewIndex, onUpdate }: { label: string; own: ViewDef; viewIndex: number; onUpdate: Mutate }) {
  const shown = shownHeaderRow(own)
  return (
    <div className="view-settings-row">
      <RowLabel icon="headerRow">{label}</RowLabel>
      <HeaderStyleControl
        label="Header row style"
        shown={shown}
        plainLabel="Plain, like any row"
        plainOn={plainHeaderRow(shown)}
        onPlain={() => onUpdate((d) => toggleHeaderRowPlain(d.views[viewIndex]))}
        onPick={(part, value) => onUpdate((d) => setHeaderRowPart(d.views[viewIndex], part, value))}
      />
      <FromSettings own={own} viewKey="headerRow" viewIndex={viewIndex} onUpdate={onUpdate} />
    </div>
  )
}
