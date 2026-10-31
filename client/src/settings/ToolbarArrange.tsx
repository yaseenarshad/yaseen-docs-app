/**
 * Settings › Editor › Selection toolbar (YAZ-3806 T7, redrawn in the demo as 4B, YAZ-3856): a live PREVIEW of the
 * strip, drawn as a note draws it, and under it a row of SQUARES for each group. A click on a square hides or shows
 * its button (a hidden square is dimmed and struck through); a drag moves it inside its group; a group's handle drags
 * the whole group. "Reset to default" brings back the default strip. Each change is one write of
 * `settings.selectionToolbar`, and every open note's toolbar follows it at once (`editor/toolbarPrefs.ts`).
 *
 * The drag is the tab strip's (`tabs/tabs.css`, YAZ-3637, Yaseen's ask): pointer events, nothing moves while the
 * drag goes on, the grabbed square or group dims, and a 3px accent line marks the slot it lands in — between squares
 * a line on the left of the square it lands before (on the right of the last one for the end), between groups a line
 * above (below the last). After 3 px a press is a drag; the release writes the new order once; Esc puts it back and
 * writes nothing. Which group a button is in is fixed. The last button that shows cannot be hidden: a strip with no
 * button would open as an empty box.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_TOOLBAR, TOOLBAR_LAYOUT, type ToolbarButtonId, type ToolbarGroupId, type ToolbarPrefs } from '@shared/types'
import { TOOLBAR_GROUP_LABELS, TOOLBAR_ICONS, TOOLBAR_LABELS } from '../editor/toolbarButtons'
import { groupButtons } from '../editor/toolbarPrefs'
import { DragHandleIcon } from '../views/view/icons'

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

/** A move of less than this many px is a press, not a drag. */
const LIFT_PX = 3

/** A button's icon; Crepe's own buttons have theirs once a note's toolbar has built, their name's first letters before. */
function ButtonIcon({ button }: { button: ToolbarButtonId }) {
  const icon = TOOLBAR_ICONS[button]
  return icon === undefined ? <span className="toolbar-arrange__glyph">{TOOLBAR_LABELS[button].slice(0, 2)}</span> : <span className="toolbar-arrange__svg" dangerouslySetInnerHTML={{ __html: icon }} />
}

/**
 * One drag among `items` (the elements of one list, in order) along `axis`, started by `e` on `items[from]`. The slot
 * under the pointer is the number of items whose middle it has passed; a slot that moves nothing shows no line. On a
 * release after a lift, `onDrop(from, to)` runs once. Returns the drag's cancel, for Esc.
 */
function startDrag(e: ReactPointerEvent<HTMLElement>, items: HTMLElement[], from: number, axis: 'x' | 'y', onDrop: (from: number, to: number) => void, onEnd: (lifted: boolean) => void): () => void {
  const source = items[from]
  const start = axis === 'x' ? e.clientX : e.clientY
  const pointer = e.pointerId
  const target = e.currentTarget
  let slot = from
  let lifted = false
  target.setPointerCapture?.(pointer)
  const mids = items.map((el) => {
    const r = el.getBoundingClientRect()
    return axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2
  })
  const before = axis === 'x' ? 'toolbar-arrange--gap-left' : 'toolbar-arrange--gap-above'
  const after = axis === 'x' ? 'toolbar-arrange--gap-right' : 'toolbar-arrange--gap-below'
  const clearLine = () => items.forEach((el) => el.classList.remove(before, after))
  const moves = () => slot !== from && slot !== from + 1
  const onMove = (ev: PointerEvent) => {
    const at = axis === 'x' ? ev.clientX : ev.clientY
    if (!lifted) {
      if (Math.abs(at - start) < LIFT_PX) return
      lifted = true
      source.classList.add('toolbar-arrange--dragging')
    }
    slot = mids.filter((mid) => at > mid).length
    clearLine()
    if (!moves()) return
    if (slot < items.length) items[slot].classList.add(before)
    else items[items.length - 1].classList.add(after)
  }
  const end = () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', cancel)
    if (target.hasPointerCapture?.(pointer) === true) target.releasePointerCapture(pointer)
    clearLine()
    source.classList.remove('toolbar-arrange--dragging')
    onEnd(lifted)
  }
  function onUp() {
    end()
    if (lifted && moves()) onDrop(from, slot > from ? slot - 1 : slot)
  }
  function cancel() {
    end()
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', cancel)
  return cancel
}

/** The groups with a button that shows, each with those buttons, in the user's order: what the strip draws. */
const shownGroups = (prefs: ToolbarPrefs): { group: ToolbarGroupId; buttons: ToolbarButtonId[] }[] =>
  prefs.groups
    .map((group) => ({ group, buttons: groupButtons(prefs, group).filter((button) => !prefs.hidden.includes(button)) }))
    .filter(({ buttons }) => buttons.length > 0)

export function ToolbarArrange({ value, onChange }: { value: ToolbarPrefs; onChange: (next: ToolbarPrefs) => void }) {
  const groupsRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<(() => void) | null>(null)
  // A drag ends with the click of its release: that click must not also hide the square.
  const dragged = useRef(false)
  const latest = useRef(value)
  latest.current = value

  // Esc during a drag puts it back, ahead of the dialog's own Esc.
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

  const begin = (e: ReactPointerEvent<HTMLElement>, items: HTMLElement[], from: number, axis: 'x' | 'y', onDrop: (from: number, to: number) => void) => {
    if (e.button !== 0 || dragging.current !== null) return
    dragged.current = false
    dragging.current = startDrag(e, items, from, axis, onDrop, (lifted) => {
      dragging.current = null
      dragged.current = lifted
    })
  }

  const shown = shownGroups(value)
  const lastShown = value.hidden.length === value.buttons.length - 1
  return (
    <div className="toolbar-arrange">
      <div className="toolbar-arrange__preview" aria-label="The toolbar as it will look" role="img">
        {shown.map(({ group, buttons }, i) => (
          <span key={group} className="toolbar-arrange__preview-group">
            {i > 0 && <span className="toolbar-arrange__divider" />}
            {buttons.map((button) => (
              <span key={button} className="toolbar-arrange__preview-button" title={TOOLBAR_LABELS[button]}>
                <ButtonIcon button={button} />
              </span>
            ))}
          </span>
        ))}
      </div>
      <div ref={groupsRef} className="toolbar-arrange__groups">
        {value.groups.map((group, gi) => (
          <div key={group} className="toolbar-arrange__group" data-group={group}>
            <span
              className="toolbar-arrange__handle"
              title={`Drag to move ${TOOLBAR_GROUP_LABELS[group]}`}
              onPointerDown={(e) => {
                e.preventDefault()
                const rows = [...groupsRef.current!.querySelectorAll<HTMLElement>('.toolbar-arrange__group')]
                begin(e, rows, gi, 'y', (from, to) => onChange(moveGroup(latest.current, from, to)))
              }}
            >
              <DragHandleIcon />
              <span className="toolbar-arrange__group-name">{TOOLBAR_GROUP_LABELS[group]}</span>
            </span>
            <div className="toolbar-arrange__squares">
              {groupButtons(value, group).map((button, bi) => {
                const on = !value.hidden.includes(button)
                const locked = on && lastShown
                return (
                  <button
                    key={button}
                    type="button"
                    role="checkbox"
                    className={`toolbar-arrange__square${on ? '' : ' toolbar-arrange__square--off'}`}
                    data-button={button}
                    aria-checked={on}
                    aria-label={`Show ${TOOLBAR_LABELS[button]}`}
                    aria-disabled={locked || undefined}
                    title={locked ? 'One button stays on the toolbar' : `${TOOLBAR_LABELS[button]} — click to ${on ? 'hide' : 'show'}, drag to move`}
                    onPointerDown={(e) => {
                      const squares = [...e.currentTarget.parentElement!.querySelectorAll<HTMLElement>('.toolbar-arrange__square')]
                      begin(e, squares, bi, 'x', (from, to) => onChange(moveButton(latest.current, group, from, to)))
                    }}
                    onClick={() => {
                      if (dragged.current) return void (dragged.current = false)
                      if (!locked) onChange(toggleButton(latest.current, button))
                    }}
                  >
                    <ButtonIcon button={button} />
                  </button>
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

