import { useState, type ReactNode } from 'react'
import { useUnit } from '../../vault/unitWord'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import type { EditorKind } from '../editorType'
import { FillMenu, type FillTarget } from './FillMenu'
import { FlyoutItem, FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'
import { valueFromText } from './tableSelection'

interface SelectionMenuProps {
  x: number
  y: number
  /** A selection of whole rows: the page actions show. */
  rows: boolean
  /** The one column's editor when every selected cell is in one writable column: "Set value ›" shows. */
  setValue: { kind: EditorKind; options?: readonly string[] } | null
  onCopy: () => void
  onPaste: () => void
  onClear: () => void
  onFill: (target: FillTarget, fill: string | null) => void
  onSetValue: (value: unknown) => void
  /** ⌘\ "Clear formatting" (YAZ-4603 D54). */
  onClearFormatting: () => void
  /** "New row below" the last selected row (YAZ-4611 D63); absent: no such item. */
  onNewRowBelow?: () => void
  /** Absent: the item shows, off (the host has no such action). */
  onDuplicate?: () => void
  onDelete?: () => void
  /** More items, their own group before the page actions (YAZ-3746 13AI: the row freeze, as in the row menu). */
  extra?: ReactNode
  /** The Fill flyouts (YAZ-3746 13AQ): whole columns get Fill column. Default: Fill cell, Fill row. */
  fillTargets?: readonly FillTarget[]
  onClose: () => void
}

/** "Clear formatting ⌘\" (YAZ-4603 D54): the selection menu's and the cell menu's item; the key is drawn from `data-hint`. */
export function ClearFormattingItem({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" className="ctx-menu__item" role="menuitem" data-hint={'⌘\\'} onClick={onClear}>
      Clear formatting
    </button>
  )
}

/**
 * The right-click on a selection in the folder table (YAZ-4593, S27 / S28): Copy, Paste, Clear cells, Fill › and Clear
 * formatting (YAZ-4603 D54), Set value › (one column only), then Duplicate pages and Delete pages… for whole rows.
 * Each action closes the menu.
 */
export function SelectionMenu({ x, y, rows, setValue, onCopy, onPaste, onClear, onFill, onSetValue, onClearFormatting, onNewRowBelow, onDuplicate, onDelete, extra, fillTargets, onClose }: SelectionMenuProps) {
  const unit = useUnit()
  /** ONE open flyout: Fill's and Set value's (YAZ-3746 13AU). */
  const flyout = useFlyout<string>()
  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  const plain = (label: string, action: (() => void) | undefined, hint?: string, danger = false) => (
    <button type="button" className={danger ? 'ctx-menu__item ctx-menu__item--danger' : 'ctx-menu__item'} role="menuitem" data-hint={hint} disabled={action === undefined} onMouseEnter={() => flyout.hover(null)} onClick={action && run(action)}>
      {label}
    </button>
  )
  /** The single Fill ›'s first target (YAZ-3746 13AW): the rows from whole rows, the columns from whole columns, else the cells. */
  const fillFirst: FillTarget = rows ? 'row' : fillTargets?.includes('column') === true && fillTargets.includes('row') !== true ? 'column' : 'cell'
  // The row menu's order (YAZ-3746 13AW): clipboard with its keys · Fill › Set value › Clear formatting · the row edits ·
  // the view (freeze) · Delete pages…, red and last.
  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      <MenuFlyout.Provider value={flyout}>
        <div className="ctx-menu__group" role="group">
          {plain('Copy', onCopy, '⌘C')}
          {plain('Paste', onPaste, '⌘V')}
          {plain('Clear cells', onClear, '⌫')}
        </div>
        <div className="ctx-menu__group" role="group">
          <FillMenu onFill={onFill} onClose={onClose} targets={fillTargets} flyout={flyout} combined={{ initial: fillFirst }} />
          {setValue !== null && (
            <FlyoutParent label="Set value" open={flyout.open === 'value'} onHover={() => flyout.hover('value')} onOpen={() => flyout.openNow('value')} onCloseFlyout={() => flyout.openNow(null)}>
              <SetValueItems kind={setValue.kind} options={setValue.options} onSet={(value) => run(() => onSetValue(value))()} />
            </FlyoutParent>
          )}
          <ClearFormattingItem onClear={run(onClearFormatting)} />
        </div>
        {(onNewRowBelow !== undefined || rows) && (
          <div className="ctx-menu__group" role="group">
            {onNewRowBelow !== undefined && plain('New row below', onNewRowBelow)}
            {rows && plain(unit('Duplicate pages'), onDuplicate)}
          </div>
        )}
        {extra !== undefined && (
          <div className="ctx-menu__group" role="group">
            {extra}
          </div>
        )}
        {rows && (
          <div className="ctx-menu__group" role="group">
            {plain(unit('Delete pages…'), onDelete, undefined, true)}
          </div>
        )}
      </MenuFlyout.Provider>
    </ContextMenuSurface>
  )
}

/** The values "Set value ›" offers: Checked and Unchecked, a choice column's options, else a field that Enter applies. */
function SetValueItems({ kind, options, onSet }: { kind: EditorKind; options?: readonly string[]; onSet: (value: unknown) => void }) {
  const [text, setText] = useState('')
  if (kind === 'checkbox')
    return (
      <>
        <FlyoutItem label="Checked" onSelect={() => onSet(true)} />
        <FlyoutItem label="Unchecked" onSelect={() => onSet(false)} />
      </>
    )
  if ((kind === 'select' || kind === 'multi-select') && options !== undefined && options.length > 0)
    return (
      <>
        {options.map((option) => (
          <FlyoutItem key={option} label={option} onSelect={() => onSet(kind === 'select' ? option : [option])} />
        ))}
        <FlyoutItem label="Empty" onSelect={() => onSet(null)} />
      </>
    )
  return (
    <input
      className="view-input view-selection-menu__input"
      autoFocus
      aria-label="Value"
      placeholder="Value, then Enter"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const value = valueFromText(text, kind)
        if (value !== undefined) onSet(value)
      }}
    />
  )
}
