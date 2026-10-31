/**
 * Settings › Editor › Selection toolbar (YAZ-3806 T7): the toolbar's groups and buttons in their order. A group
 * has a header that drags; a button has a grip, a show box, its icon and its name. "Reset to default" brings back
 * the default strip. Each change is one write of `settings.selectionToolbar`, and every open note's toolbar follows
 * it at once (`editor/toolbarPrefs.ts`).
 *
 * The drag is the sidebar Tab row panel's (`sidebar/TabRowPanel.tsx`, YAZ-3273 D5): pointer events, not native
 * HTML drag. After 3 px the row lifts and follows the pointer, clamped to its list, and the others slide apart to
 * open its gap — CSS `transform` only, no React render on the way. The release writes the new order once. Esc
 * puts the row back and writes nothing. A button moves inside its group only: which group a button is in is fixed.
 * The last button that shows cannot be unticked: a strip with no button would open as an empty box. The grip and
 * the box are the Tab row panel's own classes (`app.css`, `.tab-row-panel__grip` / `__check`).
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_TOOLBAR, TOOLBAR_LAYOUT, type ToolbarButtonId, type ToolbarGroupId, type ToolbarPrefs } from '@shared/types'
import { TOOLBAR_GROUP_LABELS, TOOLBAR_ICONS, TOOLBAR_LABELS } from '../editor/toolbarButtons'
import { groupButtons } from '../editor/toolbarPrefs'
import { DragHandleIcon } from '../views/view/icons'

/** A move of less than this many px is a press, not a drag. */
const LIFT_PX = 3

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = list.filter((_, i) => i !== from)
  next.splice(to, 0, list[from])
  return next
}

/** Move a group from one place to another. */
export const moveGroup = (prefs: ToolbarPrefs, from: number, to: number): ToolbarPrefs => ({ ...prefs, groups: move(prefs.groups, from, to) })

/** Move a button inside its group: the group's buttons take the same places in `buttons`, in their new order. */
export function moveButton(prefs: ToolbarPrefs, group: ToolbarGroupId, from: number, to: number): ToolbarPrefs {
  const moved = move(groupButtons(prefs, group), from, to)
  let next = 0
  return { ...prefs, buttons: prefs.buttons.map((button) => ((TOOLBAR_LAYOUT[group] as readonly string[]).includes(button) ? moved[next++] : button)) }
}

/** Show or hide a button. A button that shows again keeps its place. */
export const toggleButton = (prefs: ToolbarPrefs, button: ToolbarButtonId): ToolbarPrefs => ({
  ...prefs,
  hidden: prefs.hidden.includes(button) ? prefs.hidden.filter((b) => b !== button) : [...prefs.hidden, button],
})

/**
 * One drag of a row of `list` (the rows match `rowSelector`), started by `e`. `onDrop(from, to)` runs once, on a
 * release after a lift. Returns the drag's cancel, for Esc.
 */
function dragRow(e: ReactPointerEvent<HTMLElement>, list: HTMLElement, rowSelector: string, onDrop: (from: number, to: number) => void, onEnd: () => void): () => void {
  const rows = [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches(rowSelector))
  const row = (e.target as Element).closest<HTMLElement>(rowSelector)!
  const from = rows.indexOf(row)
  const tops = rows.map((r) => r.offsetTop)
  const heights = rows.map((r) => r.offsetHeight)
  const h = heights[from]
  const y0 = e.clientY
  const pointer = e.pointerId
  let to = from
  let lifted = false
  row.setPointerCapture?.(pointer)
  const clear = () => {
    list.classList.remove('toolbar-arrange--sorting')
    row.classList.remove('toolbar-arrange--lifted')
    for (const r of rows) r.style.transform = ''
  }
  const end = () => {
    row.removeEventListener('pointermove', onMove)
    row.removeEventListener('pointerup', onUp)
    row.removeEventListener('pointercancel', cancel)
    if (row.hasPointerCapture?.(pointer) === true) row.releasePointerCapture(pointer)
    onEnd()
  }
  const onMove = (ev: PointerEvent) => {
    const dy = ev.clientY - y0
    if (!lifted) {
      if (Math.abs(dy) < LIFT_PX) return
      lifted = true
      row.classList.add('toolbar-arrange--lifted')
      list.classList.add('toolbar-arrange--sorting')
    }
    const last = rows.length - 1
    const d = Math.max(tops[0] - tops[from] - h / 3, Math.min(tops[last] + heights[last] - tops[from] - h + h / 3, dy))
    row.style.transform = `translateY(${d}px)`
    const mid = tops[from] + d + h / 2
    to = rows.reduce((n, _r, i) => (i !== from && mid > tops[i] + heights[i] / 2 ? n + 1 : n), 0)
    rows.forEach((r, i) => {
      if (i === from) return
      const shift = from < to && i > from && i <= to ? -h : from > to && i < from && i >= to ? h : 0
      r.style.transform = shift === 0 ? '' : `translateY(${shift}px)`
    })
  }
  const onUp = () => {
    end()
    clear()
    if (lifted && to !== from) onDrop(from, to)
  }
  const cancel = () => {
    end()
    clear()
  }
  row.addEventListener('pointermove', onMove)
  row.addEventListener('pointerup', onUp)
  row.addEventListener('pointercancel', cancel)
  return cancel
}

export function ToolbarArrange({ value, onChange }: { value: ToolbarPrefs; onChange: (next: ToolbarPrefs) => void }) {
  const dragging = useRef<(() => void) | null>(null)
  const latest = useRef(value)
  latest.current = value

  // Esc during a drag puts the row back, ahead of the dialog's own Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dragging.current === null) return
      dragging.current()
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      dragging.current?.()
    }
  }, [])

  const start = (rowSelector: string, onDrop: (from: number, to: number) => void) => (e: ReactPointerEvent<HTMLElement>) => {
    const target = e.target as Element
    const list = e.currentTarget
    // The row's own list only: a press in a group's buttons is not a drag of the group.
    if (e.button !== 0 || dragging.current !== null || target.closest('.tab-row-panel__check') !== null || target.closest(rowSelector)?.parentElement !== list) return
    if (rowSelector === '.toolbar-arrange__group' && target.closest('.toolbar-arrange__head') === null) return
    e.preventDefault()
    dragging.current = dragRow(e, list, rowSelector, onDrop, () => (dragging.current = null))
  }

  const lastShown = value.hidden.length === value.buttons.length - 1
  return (
    <div className="toolbar-arrange">
      <div className="toolbar-arrange__groups" onPointerDown={start('.toolbar-arrange__group', (from, to) => onChange(moveGroup(latest.current, from, to)))}>
        {value.groups.map((group) => (
          <div key={group} className="toolbar-arrange__group" data-group={group}>
            <div className="toolbar-arrange__head" title={`Drag to move ${TOOLBAR_GROUP_LABELS[group]}`}>
              <span className="tab-row-panel__grip" aria-hidden="true">
                <DragHandleIcon />
              </span>
              {TOOLBAR_GROUP_LABELS[group]}
            </div>
            <div className="toolbar-arrange__list" onPointerDown={start('.toolbar-arrange__row', (from, to) => onChange(moveButton(latest.current, group, from, to)))}>
              {groupButtons(value, group).map((button) => {
                const shown = !value.hidden.includes(button)
                const icon = TOOLBAR_ICONS[button]
                return (
                  <div key={button} className="toolbar-arrange__row" data-button={button} title={`Drag to move ${TOOLBAR_LABELS[button]}`}>
                    <span className="tab-row-panel__grip" aria-hidden="true">
                      <DragHandleIcon />
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      className="tab-row-panel__check"
                      aria-checked={shown}
                      aria-label={`Show ${TOOLBAR_LABELS[button]}`}
                      disabled={shown && lastShown}
                      title={shown && lastShown ? 'One button stays on the toolbar' : undefined}
                      onClick={() => onChange(toggleButton(value, button))}
                    >
                      {shown ? '✓' : ''}
                    </button>
                    <span className="toolbar-arrange__icon" aria-hidden="true" dangerouslySetInnerHTML={icon === undefined ? undefined : { __html: icon }} />
                    <span className="toolbar-arrange__name">{TOOLBAR_LABELS[button]}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="settings__option toolbar-arrange__reset" onClick={() => onChange(DEFAULT_TOOLBAR)}>
        Reset to default
      </button>
    </div>
  )
}
