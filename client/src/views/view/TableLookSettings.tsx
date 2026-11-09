import { FOLDER_PAGE_CHOICES, type FolderPagesSettings } from '@shared/types'
import type { Mutate, ViewDef } from '../viewSchema'
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
