/**
 * THE ZOOM STEPPER, a quiet "− 100% +": the two rows of the footer's zoom menu (`ZoomMenu`, YAZ-3432) are one each.
 *  - `sidebar` (YAZ-3389): the sidebar's lists only (`settings.sidebarZoom`, one value for every full window; a Files
 *    window's own `WindowEntry.zoom`, D13) — never the frame, never a note, which has its own zoom
 *    (`editor/DocumentZoom.tsx`). ⌘+ / ⌘− / ⌘0 step it too when no note claims them.
 *  - `app` (YAZ-3432): the App size of every window (`settings.appZoom`). Mouse only.
 * − and + walk the kind's steps (`stepZoom`) and stop at the walls; a click on the percent goes back to 100%. A step
 * that reaches a wall turns its own button off, so the focus moves to the percent first: it stays in the row instead
 * of falling to the page (YAZ-3434).
 */
import { memo, useRef, type MouseEvent } from 'react'
import { APP_ZOOM_STEPS, SIDEBAR_ZOOM_STEPS, stepZoom } from '@shared/types'

/** Each kind's steps and words: the group's name, the accessible names and the titles of −, + and the percent. */
const KINDS = {
  sidebar: {
    steps: SIDEBAR_ZOOM_STEPS,
    label: 'Sidebar zoom',
    out: 'Zoom the sidebar out',
    into: 'Zoom the sidebar in',
    outTitle: 'Zoom the sidebar out (⌘−)',
    intoTitle: 'Zoom the sidebar in (⌘+)',
    valueTitle: 'Sidebar zoom. Click for 100%',
  },
  app: {
    steps: APP_ZOOM_STEPS,
    label: 'App size',
    out: 'Make the app smaller',
    into: 'Make the app larger',
    outTitle: 'Make every window smaller',
    intoTitle: 'Make every window larger',
    valueTitle: 'App size. Click for 100%',
  },
} as const

interface ZoomStepperProps {
  kind: keyof typeof KINDS
  value: number
  onChange: (percent: number) => void
}

export const ZoomStepper = memo(function ZoomStepper({ kind, value, onChange }: ZoomStepperProps) {
  const k = KINDS[kind]
  const [min, max] = [k.steps[0], k.steps[k.steps.length - 1]]
  const percentRef = useRef<HTMLButtonElement>(null)
  const step = (e: MouseEvent<HTMLButtonElement>, direction: 1 | -1) => {
    const next = stepZoom(k.steps, value, direction)
    if ((next <= min || next >= max) && document.activeElement === e.currentTarget) percentRef.current?.focus()
    onChange(next)
  }
  return (
    <div className="zoom-stepper" role="group" aria-label={k.label}>
      <button type="button" className="zoom-stepper__step" aria-label={k.out} title={k.outTitle} disabled={value <= min} onClick={(e) => step(e, -1)}>
        −
      </button>
      <button ref={percentRef} type="button" className="zoom-stepper__value" title={k.valueTitle} onClick={() => onChange(100)}>
        {Math.round(value)}%
      </button>
      <button type="button" className="zoom-stepper__step" aria-label={k.into} title={k.intoTitle} disabled={value >= max} onClick={(e) => step(e, 1)}>
        +
      </button>
    </div>
  )
})
