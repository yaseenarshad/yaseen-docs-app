import { useMemo, useState } from 'react'
import type { FolderPagesSettings, IndexRecord, PropertiesResponse } from '@shared/types'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { defaultLabel, propertyLabel } from '../engine'
import { undeletableReason } from '../deleteColumn'
import type { ColumnTyping } from '../editorType'
import type { ColumnDecl } from '../folderSettings'
import { type FilterNode, type Mutate, type ViewDef, type ViewSet, MAX_GROUP_LEVELS } from '../viewSchema'
import { chooseOwn, useViewDefaults } from '../viewDefaults'
import type { FolderHost } from '../ViewsPane'
import { AddColumn } from './AddColumn'
import { ColumnDetail, type ColumnDoors, columnKind, columnTypeLabel, deletableHere } from './ColumnDetail'
import { displayNameOf, setDisplayName } from './columnLabel'
import { setViewOrder, withOrder } from './columnOrder'
import { UNFROZE_COLUMNS, frozenColumnCount } from './frozenColumns'
import { groupAppend, groupLevels, groupMoveLevel, groupOnly, groupRemoveLevel } from './groupLevels'
import { FlyoutItem, FlyoutParent, useFlyout } from '../../components/Flyout'
import { canonicalKey } from './keys'
import { type ColumnAlign, columnAlignOf, setColumnAlign } from './columnAlign'
import { columnFillOf, setColumnFill } from './columnFill'
import { FillMenu, type FillTarget } from './FillMenu'
import { ColumnFilterMenu } from './ColumnFilterMenu'
import { withColumnRules } from './columnFilter'
import { type Rule, inferType, propertyValues } from './filterRows'
import { columnTyping } from '../editorType'
import { isMentionsColumn } from '../mentionsColumn'
import { TextField } from './TextField'
import { plainHeaderRow, setHeaderRowPart, shownHeaderRow, textInCellsOf, toggleHeaderRowPlain } from './TableLookSettings'
import { HEADER_ROW_CHOICES, headerRowLabel, type HeaderRowOwn } from '@shared/types'
import { headerSwatch } from '../../editor/table/colours'

/** The header's one Fill flyout (YAZ-3746 13AQ). */
const COLUMN_ONLY: readonly FillTarget[] = ['column']

export interface TableHeaderMenuProps {
  x: number
  y: number
  /** The right-clicked column, or null for the `#` gutter header. */
  columnKey: string | null
  /** Whether the `#` gutter shows its numbers: its menu then hides them, else shows them (the slim strip, YAZ-4610 D62). */
  rowNumbers?: boolean
  def: ViewSet
  viewIndex: number
  /** The view's shown keys, in order — what a hide or an insert edits. */
  keys: readonly string[]
  /** Every key the folder already offers, declared columns included — "Add column" refuses a repeat. Asked only once the form opens. */
  takenKeys: () => readonly string[]
  /** The app's own keys in this vault: "Add column" refuses them (YAZ-4544). */
  reserved: ReadonlySet<string>
  /** The folder's rows: the type line infers an undeclared column's kind from them (YAZ-4533). */
  records: readonly IndexRecord[]
  /** The rows that pass `filters` in this view's place (YAZ-4919 round 2): the Filter › Contains box's live count and value list. */
  matchRows?: (filters: FilterNode | undefined) => readonly IndexRecord[]
  /** The kind the table's cells wrap by (`wrapKind`), so the Text › ✓ and the cells read ONE source (YAZ-4544 4E). */
  wrapKind: string | null | undefined
  /** The vault's property declarations, the type line's and the editor's fallback. */
  properties: PropertiesResponse | null
  /** The host's AHEAD declarations — spread under a new one — and the doors "Edit column…" writes through (YAZ-4533; `ColumnDoors`). */
  folder: ColumnDoors
  onUpdate: Mutate
  /** `FolderHost.setColumns`: declare on the folder AND show, one write. */
  declareColumn: (columns: Record<string, ColumnDecl>, views?: ViewDef[]) => void
  /** "Delete column…" (YAZ-1513): hands the key to the table, which asks first (`ConfirmDeleteColumn`). Absent → no such item. */
  onDeleteColumn?: (key: string) => void
  /** Filter › "Open the filter panel…" (YAZ-4919): opens the toolbar's Filter popover. Absent → no such row. */
  onOpenFilter?: () => void
  onClose: () => void
}

/** `next` goes right after `after` in `keys` — or last, if `after` is not shown (it was just hidden, say). */
export function insertAfter(keys: readonly string[], after: string, next: string): string[] {
  const at = keys.findIndex((k) => canonicalKey(k) === canonicalKey(after))
  return at === -1 ? [...keys, next] : [...keys.slice(0, at + 1), next, ...keys.slice(at + 1)]
}

/** The kinds whose cells are chips (YAZ-4582 D29): what wrapped on `main`, so with no choice they wrap and the rest clip. */
const CHIP_KINDS: ReadonlySet<string> = new Set(['list', 'link', 'multi-link', 'select', 'multi-select'])

/** The kind a column wraps by (YAZ-4544 4E): its typing over the table's shown rows — the cells' and the menu's one source. */
export const wrapKind = (typing: ColumnTyping): string | null | undefined => typing?.assigned ?? typing?.dominant

/**
 * Does the column wrap (YAZ-4582 D29)? `columnWrap` under its key, in any spelling: `true` Wrap, `false` Clip.
 * With no entry, Settings › Folder pages › Text in cells (YAZ-4585): Wrap, Clip, or by its kind, the default: a chip
 * column wraps and a text, number or date column is one line, as on `main`.
 */
export function wrapsColumn(view: ViewDef, key: string, kind: string | null | undefined, textInCells: FolderPagesSettings['textInCells'] = 'kind'): boolean {
  const c = canonicalKey(key)
  const chosen = Object.entries(view.columnWrap ?? {}).find(([k, wrap]) => typeof wrap === 'boolean' && canonicalKey(k) === c)?.[1]
  return chosen ?? (textInCells === 'kind' ? kind != null && CHIP_KINDS.has(kind) : textInCells === 'wrap')
}

/**
 * The table header's context menu (YAZ-1513), on the row menu's own surface. Every write is the
 * Properties menu's: "Rename column…" is `setDisplayName` through `onUpdate` (an inline field
 * holding the stored display name, the default label as its placeholder — Enter commits, an emptied field goes back to the default,
 * Esc cancels); "Hide column" is `setViewOrder` without the key (a table may hide `file.name`,
 * YAZ-1007); "Add column to the right…" is the SAME "+ Add column" form, landing the new key
 * after this column instead of at the end; "Delete column…" (confirm-first, `views/deleteColumn.ts`)
 * is disabled with a tooltip for built-in keys. The `#` header offers only "Hide row numbers" ("Show row numbers" on the slim strip, YAZ-4610 D62).
 * A grey "<Type> · <key>" line tops the column menu, and "Edit column…" opens `ColumnDetail` — the
 * Properties menu's own column editor — inside it (YAZ-4533). Freeze / ✓ Frozen / Unfreeze write the same
 * `frozenColumns` the Properties menu writes (YAZ-4534). Sort, Group and Text are flyouts (YAZ-4588 D42), each
 * ✓ on this column's state: Sort › writes `sort` (one rule on this column, or this column's rule removed),
 * Group › writes `groupBy` (`groupLevels.ts`), and Text › "Wrap text" / "Clip text" (YAZ-4582 D29) write
 * `columnWrap[<canonical key>]` (`true` Wrap, `false` Clip); the choice its kind (or Settings › Folder pages, YAZ-4585) makes anyway deletes the
 * entry in any spelling, and an empty map. Text › also holds the column's alignment (YAZ-3746 13Y): "Auto alignment" /
 * "Align left" / "Align center" / "Align right", ✓ on the current one, each one write of `columnAlign[<canonical key>]`
 * through `view/columnAlign.ts` (Auto deletes the entry). "Filter ›" (YAZ-4919), right under Group ›, writes this column's
 * rules in the view's `filters` — the Filter panel's own grammar (`ColumnFilterMenu.tsx`, `columnFilter.ts`): one write
 * per pick, ✓ on the parent while the column has a rule. "Header row ›" (YAZ-4794), after Fill column ›, is the whole
 * header row's look, the View tab's Header row: Plain, Fill colour, Strength, Weight, Text colour and Align, each ✓ at
 * what the table shows; a pick writes the view's `headerRow` (`TableLookSettings.setHeaderRowPart`) and keeps the menu open.
 */
/** "Header row ›"'s tabs (YAZ-4794 demo): Fill (strength and colour), Text (its colour), Style (weight and align). */
type HeaderTab = 'fill' | 'text' | 'style'
const HEADER_TABS: readonly (readonly [HeaderTab, string])[] = [['fill', 'Fill'], ['text', 'Text'], ['style', 'Style']]

export function TableHeaderMenu({ x, y, columnKey, rowNumbers = true, def, viewIndex, keys, takenKeys, reserved, records, matchRows, wrapKind, properties, folder, onUpdate, declareColumn, onDeleteColumn, onOpenFilter, onClose }: TableHeaderMenuProps) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'add' | 'edit'>('menu')
  /** "Header row ›"'s tab (YAZ-4794 demo: "holy shite thats a long flyout"), as Fill's Cell · Row · Column. */
  const [headerTab, setHeaderTab] = useState<HeaderTab>('fill')
  /** The menu's ONE open flyout: Sort, Group, Text and Fill column's (YAZ-3746 13AU). */
  const flyout = useFlyout<string>()
  // The view's own Text in cells, else Settings' (YAZ-4544 10A).
  const defaults = useViewDefaults()
  const textInCells = textInCellsOf(def.views[viewIndex], defaults)
  /** Once per menu, not per keystroke in its fields: the kind may walk the rows. */
  const typeLabel = useMemo(() => (columnKey === null ? '' : columnTypeLabel(columnKey, records, properties, folder.settings)), [columnKey, records, properties, folder.settings])
  const kind = useMemo(() => (columnKey === null ? null : columnKind(columnKey, records, properties, folder.settings)), [columnKey, records, properties, folder.settings])
  /** The column's rung of the typing ladder, for Filter ›'s type and checklist: the Filter panel's own reading (YAZ-4919). */
  const typing = useMemo(() => (columnKey === null ? null : columnTyping(columnKey, records, properties, folder.settings)), [columnKey, records, properties, folder.settings])
  /** A Select or Multi-select column (YAZ-4544): its "Sort A to Z" sorts by value, not in option order (D1). */
  const hasOptions = kind === 'select' || kind === 'multi-select'
  const columns = folder.settings.columns

  if (columnKey === null) {
    return (
      <ContextMenuSurface x={x} y={y} onClose={onClose}>
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            // A choice equal to Settings removes the view's key (YAZ-4585 D34, YAZ-4637 M4).
            onUpdate((d) => chooseOwn(d.views[viewIndex], 'rowNumbers', !rowNumbers, defaults))
            onClose()
          }}
        >
          {rowNumbers ? 'Hide row numbers' : 'Show row numbers'}
        </button>
      </ContextMenuSurface>
    )
  }

  const key = columnKey
  const label = propertyLabel(def, key)
  const reason = undeletableReason(key)
  const c = canonicalKey(key)
  // A hide, an unfreeze and a level removed each offer Undo (YAZ-4594 S29).
  const hide = () => onUpdate((d) => setViewOrder(d, viewIndex, keys.filter((k) => canonicalKey(k) !== c)), `Hid ${label}`)
  const index = keys.findIndex((k) => canonicalKey(k) === c)
  const frozen = frozenColumnCount(def.views[viewIndex].frozenColumns, keys.length)
  /** One write, then the menu closes; `undo`, the toast of a gesture that takes something away (S29). */
  const write = (edit: (v: ViewDef) => void, undo?: string) => () => {
    onUpdate((d) => edit(d.views[viewIndex]), undo)
    onClose()
  }
  /**
   * One rule on this column replaces the sort (YAZ-4534). A to Z / Z to A on a Select column sort by value, as the
   * label says (YAZ-4544); its Option order / Reversed option order are the rule with no `by` (YAZ-4588 D42).
   */
  const sortBy = (direction: 'ASC' | 'DESC', byValue: boolean) => write((v) => {
      v.sort = [hasOptions && byValue ? { property: c, direction, by: 'value' } : { property: c, direction }]
    })
  const view = def.views[viewIndex]
  /** This column's sort rule, for the ✓: its order, as the Sort menu reads it (`DirectionPicker`). */
  const rule = view.sort?.find((s) => canonicalKey(s.property) === c)
  const ruleDirection = rule?.direction === 'DESC' ? 'DESC' : 'ASC'
  const ruleByValue = !hasOptions || rule?.by === 'value'
  const sortRow = (label: string, direction: 'ASC' | 'DESC', byValue: boolean) => (
    <FlyoutItem label={label} checked={rule !== undefined && ruleDirection === direction && ruleByValue === byValue} onSelect={sortBy(direction, byValue)} />
  )
  const levels = groupLevels(view)
  const levelKeys = levels.map((l) => canonicalKey(l.property))
  /** This column's level; Folder may be two, and "Remove" takes the deeper (YAZ-2541). */
  const ownLevel = levelKeys.lastIndexOf(c)
  const wrapped = wrapsColumn(def.views[viewIndex], key, wrapKind, textInCells)
  const setWrap = (wrap: boolean) =>
    write((v) => {
      const next = Object.fromEntries(Object.entries(v.columnWrap ?? {}).filter(([k]) => canonicalKey(k) !== c))
      if (wrap !== wrapsColumn({ ...v, columnWrap: undefined }, key, wrapKind, textInCells)) next[c] = wrap
      if (Object.keys(next).length) v.columnWrap = next
      else delete v.columnWrap
    })
  /** This column's alignment (YAZ-3746 13Y): null is Auto. A pick is one write through `setColumnAlign`, as Wrap / Clip. */
  const align = columnAlignOf(view, key)
  const alignRow = (label: string, next: ColumnAlign | null) => <FlyoutItem label={label} checked={align === next} onSelect={write((v) => setColumnAlign(v, key, next))} />
  /** The last frozen column, or not (the table block's ✓ rule, YAZ-3696): a click on ✓ unfreezes. */
  const frozenHere = index >= 0 && frozen === index + 1
  /**
   * Filter › (YAZ-4919): this column's rules replace its own in the view's `filters`, one write (one ⌘Z) per pick;
   * Clear is a gesture that takes something away, so its toast offers Undo (S29).
   */
  const filterType = isMentionsColumn(columns, key) ? 'mentions' : inferType(c, records, typing)
  const setColumnFilter = (rules: readonly Rule[], close: boolean, undo?: string) => {
    onUpdate((d) => {
      const v = d.views[viewIndex]
      const next = withColumnRules(v.filters, c, rules, filterType)
      if (next === undefined) delete v.filters
      else v.filters = next
    }, undo)
    if (close) onClose()
  }
  /** The Contains box's live count (YAZ-4919 round 2): the view's rows under its rules, this column's swapped for `rules`. */
  const matches = matchRows && ((rules: readonly Rule[]) => matchRows(withColumnRules(view.filters, c, rules, filterType)))
  /**
   * "Header row ›" (YAZ-4794): the View tab's Header row from the column header, ✓ at what the table shows. A pick is
   * one write of the view's own `headerRow` (`setHeaderRowPart`, the View tab's writer) and the menu stays open, so
   * fill, strength, weight, text colour and align go in one visit, as a note table's "Header row ›".
   */
  const header = shownHeaderRow(view)
  const headerItem = (part: keyof HeaderRowOwn, value: string, swatch?: string) => (
    <button
      key={value}
      type="button"
      role="menuitem"
      className="ctx-menu__item"
      data-hint={header[part] === value ? '✓' : undefined}
      onClick={() => onUpdate((d) => setHeaderRowPart(d.views[viewIndex], part, value))}
    >
      {swatch === undefined ? (
        headerRowLabel(value)
      ) : (
        <span className="ctx-menu__label">
          <span className="table-menu-swatch" style={{ background: swatch }} />
          {headerRowLabel(value)}
        </span>
      )}
    </button>
  )
  const headerGroup = (heading: string, items: ReturnType<typeof headerItem>[]) => (
    <div className="ctx-menu__group" role="group">
      <div className="ctx-menu__heading" role="presentation">
        {heading}
      </div>
      {items}
    </div>
  )

  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      <div className="view-header-menu">
        {mode === 'edit' ? (
          <ColumnDetail
            columnKey={key}
            def={def}
            view={def.views[viewIndex]}
            viewIndex={viewIndex}
            records={records}
            onUpdate={onUpdate}
            properties={properties}
            folder={folder}
            shown={keys.some((k) => canonicalKey(k) === canonicalKey(key))}
            canHide
            onHide={hide}
            onBack={() => setMode('menu')}
            onLeave={onClose}
          />
        ) : mode === 'rename' ? (
          <TextField
            className="view-input view-header-menu__rename"
            aria-label={`Rename ${label}`}
            autoFocus
            value={displayNameOf(def, key)}
            placeholder={defaultLabel(key)}
            // A rename offers Undo too (YAZ-4608 C6, the S29 toast).
            onCommit={(name) => onUpdate((d) => setDisplayName(d, key, name), `Renamed ${label} to ${name.trim() || defaultLabel(key)}`)}
            onDone={onClose}
          />
        ) : mode === 'add' ? (
          <AddColumn
            autoOpen
            taken={takenKeys()}
            shown={keys}
            reserved={reserved}
            onCancel={onClose}
            onShow={(existing) => {
              onUpdate((d) => setViewOrder(d, viewIndex, insertAfter(keys, key, existing)))
              onClose()
            }}
            onSave={(name, column) => {
              declareColumn(
                { ...columns, [name]: column },
                def.views.map((v, i) => (i === viewIndex ? withOrder(v, insertAfter(keys, key, `note.${name}`)) : v)),
              )
              onClose()
            }}
          />
        ) : (
          <>
            <div className="ctx-menu__heading" role="presentation">
              {typeLabel} · {canonicalKey(key)}
            </div>
            <div className="ctx-menu__group" onMouseEnter={() => flyout.hover(null)}>
              <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setMode('edit')}>
                Edit column…
              </button>
              <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setMode('rename')}>
                Rename column…
              </button>
              <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setMode('add')}>
                Add column to the right…
              </button>
            </div>
            <div className="ctx-menu__group">
              <FlyoutParent label="Sort" open={flyout.open === 'sort'} onHover={() => flyout.hover('sort')} onOpen={() => flyout.openNow('sort')} onCloseFlyout={() => flyout.openNow(null)}>
                <div className="ctx-menu__group" role="group">
                  {sortRow('A to Z', 'ASC', true)}
                  {sortRow('Z to A', 'DESC', true)}
                  {hasOptions && sortRow('Option order', 'ASC', false)}
                  {hasOptions && sortRow('Reversed option order', 'DESC', false)}
                </div>
                {rule !== undefined && (
                  <div className="ctx-menu__group" role="group">
                    <FlyoutItem
                      label="Remove sort"
                      onSelect={write((v) => {
                        const rest = (v.sort ?? []).filter((s) => canonicalKey(s.property) !== c)
                        if (rest.length) v.sort = rest
                        else delete v.sort
                      })}
                    />
                  </div>
                )}
              </FlyoutParent>
              <FlyoutParent label="Group" open={flyout.open === 'group'} onHover={() => flyout.hover('group')} onOpen={() => flyout.openNow('group')} onCloseFlyout={() => flyout.openNow(null)}>
                <div className="ctx-menu__group" role="group">
                  {/* An Image column has no groups (YAZ-4802): each picture is its own. */}
                  <FlyoutItem label="Group by this column" disabled={kind === 'image'} tip={kind === 'image' ? 'An Image column can not be grouped' : undefined} onSelect={write((v) => groupOnly(v, key))} />
                  {/* Hidden when this column is a level; Folder may group twice (YAZ-2541). Hidden with nothing grouped, where it is "Group by this column" (YAZ-4544 4F, D42). */}
                  {levels.length > 0 && (ownLevel === -1 || c === 'file.folder') && (
                    <FlyoutItem
                      label="Add as next group level"
                      disabled={levels.length >= MAX_GROUP_LEVELS || kind === 'image'}
                      tip={kind === 'image' ? 'An Image column can not be grouped' : levels.length >= MAX_GROUP_LEVELS ? 'Five levels at most' : undefined}
                      onSelect={write((v) => groupAppend(v, key))}
                    />
                  )}
                </div>
                {/* This column's level (YAZ-3746 13V): a heading that says which, then what can be done with it. The old
                    read-only "Levels" list looked clickable and did nothing. */}
                {ownLevel !== -1 && (
                  <div className="ctx-menu__group" role="group">
                    <div className="ctx-menu__heading" role="presentation">
                      Group level {ownLevel + 1} of {levels.length}
                    </div>
                    {levels.length > 1 && (
                      <>
                        <FlyoutItem label="Move up a level" disabled={ownLevel === 0} tip={ownLevel === 0 ? 'Already the outer level' : undefined} onSelect={write((v) => groupMoveLevel(v, ownLevel, -1))} />
                        <FlyoutItem label="Move down a level" disabled={ownLevel === levels.length - 1} tip={ownLevel === levels.length - 1 ? 'Already the inner level' : undefined} onSelect={write((v) => groupMoveLevel(v, ownLevel, 1))} />
                      </>
                    )}
                    <FlyoutItem label="Remove this group level" onSelect={write((v) => groupRemoveLevel(v, ownLevel), `Removed group level ${label}`)} />
                  </div>
                )}
              </FlyoutParent>
              {/* Quick rules on this column (YAZ-4919), in the Filter panel's grammar. */}
              <ColumnFilterMenu
                flyout={flyout}
                property={c}
                type={filterType}
                values={() => propertyValues(c, records, typing)}
                filters={view.filters}
                matches={matches}
                onRules={setColumnFilter}
                onClear={() => setColumnFilter([], true, `Cleared the filter on ${label}`)}
                onOpenPanel={
                  onOpenFilter &&
                  (() => {
                    onClose()
                    onOpenFilter()
                  })
                }
              />
              <FlyoutParent label="Text" open={flyout.open === 'text'} onHover={() => flyout.hover('text')} onOpen={() => flyout.openNow('text')} onCloseFlyout={() => flyout.openNow(null)}>
                <div className="ctx-menu__group" role="group">
                  <FlyoutItem label="Wrap text" checked={wrapped} onSelect={setWrap(true)} />
                  <FlyoutItem label="Clip text" checked={!wrapped} onSelect={setWrap(false)} />
                </div>
                {/* The column's alignment (YAZ-3746 13Y): Auto is today's look, numbers right and the rest left. */}
                <div className="ctx-menu__group" role="group">
                  {alignRow('Auto alignment', null)}
                  {alignRow('Align left', 'left')}
                  {alignRow('Align center', 'center')}
                  {alignRow('Align right', 'right')}
                </div>
              </FlyoutParent>
            </div>
            {/* The column's fill (YAZ-3746 13AQ): every cell of it, under a row's and a cell's own fill. */}
            <div className="ctx-menu__group">
              <FillMenu
                flyout={flyout}
                targets={COLUMN_ONLY}
                start={columnFillOf(def.views[viewIndex], key)}
                onFill={(_, fill) => {
                  onUpdate((d) => setColumnFill(d.views[viewIndex], key, fill), fill === null ? 'Cleared fill' : undefined, undefined, true)
                  onClose()
                }}
                onClose={onClose}
              />
            </div>
            {/* The table's header row (YAZ-4794): the whole row's look, as the View tab's Header row. */}
            <div className="ctx-menu__group">
              <FlyoutParent label="Header row" open={flyout.open === 'header'} onHover={() => flyout.hover('header')} onOpen={() => flyout.openNow('header')} onCloseFlyout={() => flyout.openNow(null)}>
                <div className="ctx-menu__group" role="group">
                  <FlyoutItem label="Plain, like any row" checked={plainHeaderRow(header)} onSelect={() => onUpdate((d) => toggleHeaderRowPlain(d.views[viewIndex]))} />
                </div>
                {/* Three tabs, as Fill's Cell · Row · Column (YAZ-4794 demo): one short list at a time, not thirty rows. */}
                <div className="fill-target" role="group" aria-label="Header row part">
                  {HEADER_TABS.map(([tab, word]) => (
                    <button key={tab} type="button" className="fill-target__opt" aria-pressed={tab === headerTab} onClick={() => setHeaderTab(tab)}>
                      {word}
                    </button>
                  ))}
                </div>
                {headerTab === 'fill' && (
                  <>
                    <div className="fill-target fill-target--sub" role="group" aria-label="Strength">
                      {HEADER_ROW_CHOICES.strength.map((v) => (
                        <button key={v} type="button" className="fill-target__opt" aria-pressed={header.strength === v} onClick={() => onUpdate((d) => setHeaderRowPart(d.views[viewIndex], 'strength', v))}>
                          {headerRowLabel(v)}
                        </button>
                      ))}
                    </div>
                    <div className="ctx-menu__group" role="group">
                      {HEADER_ROW_CHOICES.color.map((c) => headerItem('color', c, headerSwatch(c)))}
                    </div>
                  </>
                )}
                {headerTab === 'text' && (
                  <div className="ctx-menu__group" role="group">
                    {HEADER_ROW_CHOICES.text.map((v) => headerItem('text', v, v === 'muted' || v === 'full' ? undefined : headerSwatch(v)))}
                  </div>
                )}
                {headerTab === 'style' && (
                  <>
                    {headerGroup('Weight', HEADER_ROW_CHOICES.weight.map((v) => headerItem('weight', v)))}
                    {headerGroup('Align', HEADER_ROW_CHOICES.align.map((v) => headerItem('align', v)))}
                  </>
                )}
              </FlyoutParent>
            </div>
            {/* The view group (YAZ-4608 C8): what shows and what freezes, after the edits and before Delete. */}
            <div className="ctx-menu__group" onMouseEnter={() => flyout.hover(null)}>
              <button
                type="button"
                className="ctx-menu__item"
                role="menuitem"
                onClick={() => {
                  hide()
                  onClose()
                }}
              >
                Hide column
              </button>
              <button
                type="button"
                className="ctx-menu__item"
                role="menuitem"
                onClick={write((v) => {
                  if (frozenHere) delete v.frozenColumns
                  else v.frozenColumns = index + 1
                }, frozenHere ? UNFROZE_COLUMNS : undefined)}
              >
                {frozenHere ? '✓ Frozen up to this column' : 'Freeze up to this column'}
              </button>
              <button
                type="button"
                className="ctx-menu__item"
                role="menuitem"
                disabled={frozen === 0}
                onClick={write((v) => {
                  delete v.frozenColumns
                }, UNFROZE_COLUMNS)}
              >
                Unfreeze columns
              </button>
            </div>
            {/* Only this folder's own column (YAZ-4713 C7): a parent folder's is hidden here, never deleted. */}
            {onDeleteColumn && deletableHere(folder, key) && (
              <div className="ctx-menu__group" onMouseEnter={() => flyout.hover(null)}>
                <button
                  type="button"
                  className="ctx-menu__item ctx-menu__item--danger"
                  role="menuitem"
                  disabled={reason !== null}
                  title={reason ?? undefined}
                  onClick={() => {
                    onDeleteColumn(key)
                    onClose()
                  }}
                >
                  Delete column…
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ContextMenuSurface>
  )
}
