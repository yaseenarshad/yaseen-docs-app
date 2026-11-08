import { useState } from 'react'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import type { EditorKind } from '../editorType'
import { FillMenu, type FillTarget } from './FillMenu'
import { FlyoutItem, FlyoutParent, useFlyout } from './HeaderFlyout'
import { valueFromText } from './tableSelection'

interface SelectionMenuProps {
  x: number
  y: number
  /** A selection of whole rows: the note actions show. */
  rows: boolean
  /** The one column's editor when every selected cell is in one writable column: "Set value ›" shows. */
  setValue: { kind: EditorKind; options?: readonly string[] } | null
  onCopy: () => void
  onPaste: () => void
  onClear: () => void
  onFill: (target: FillTarget, fill: string | null) => void
  onSetValue: (value: unknown) => void
  /** Absent: the item shows, off (the host has no such action). */
  onDuplicate?: () => void
  onDelete?: () => void
  onClose: () => void
}

/**
 * The right-click on a selection in the folder table (YAZ-4593, S27 / S28): Copy, Paste, Clear cells, Fill ›, Set
 * value › (one column only), then Duplicate notes and Delete notes… for whole rows. Each action closes the menu.
 */
export function SelectionMenu({ x, y, rows, setValue, onCopy, onPaste, onClear, onFill, onSetValue, onDuplicate, onDelete, onClose }: SelectionMenuProps) {
  const flyout = useFlyout<'value'>()
  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  const plain = (label: string, action: (() => void) | undefined) => (
    <button type="button" className="ctx-menu__item" role="menuitem" disabled={action === undefined} onMouseEnter={() => flyout.hover(null)} onClick={action && run(action)}>
      {label}
    </button>
  )
  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      <div className="ctx-menu__group" role="group">
        {plain('Copy', onCopy)}
        {plain('Paste', onPaste)}
        {plain('Clear cells', onClear)}
      </div>
      <div className="ctx-menu__group" role="group" onMouseEnter={() => flyout.hover(null)}>
        <FillMenu onFill={onFill} onClose={onClose} />
      </div>
      {setValue !== null && (
        <div className="ctx-menu__group" role="group">
          <FlyoutParent label="Set value" open={flyout.open === 'value'} onHover={() => flyout.hover('value')} onOpen={() => flyout.openNow('value')} onCloseFlyout={() => flyout.openNow(null)}>
            <SetValueItems kind={setValue.kind} options={setValue.options} onSet={(value) => run(() => onSetValue(value))()} />
          </FlyoutParent>
        </div>
      )}
      {rows && (
        <div className="ctx-menu__group" role="group">
          {plain('Duplicate notes', onDuplicate)}
          {plain('Delete notes…', onDelete)}
        </div>
      )}
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
