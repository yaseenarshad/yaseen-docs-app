/**
 * THE FOUR STEPS (YAZ-5121, YAZ-5328; chapters 8 to 12): Capture (a notepad), Create (a pen on a card), Review (the
 * Inbox's tray) and Improve (a line that rises), each in a round badge with its name and, optionally, a short line
 * under it ("every day"). The icons say the step without the word, for a person who reads little English. Chapter 9
 * brings them in; chapters 8, 10, 11 and 12 show them again, so the person knows the system at a glance. A pure drawing
 * of its beat.
 *
 * - `show[i]`: the badge comes in (0..1); `lit[i]`: it lights (the accent fill); `pages[i]`: the line under it, with
 *   `pageP[i]` its fade. Index 0 is Capture, 1 Create, 2 Review, 3 Improve.
 * - `HabitGlyph`: one icon alone (a corner of a scene: the Improve line inside the Inbox in chapter 9). `prune` is the
 *   gardener's shears (chapter 11's pruning): a tool, not a step.
 */
import { clamp, pop, rise, type Beat } from './beat'
import './kit.css'

export type Habit = 'capture' | 'create' | 'review' | 'improve'
type Glyph = Habit | 'prune'

const STEPS: readonly { id: Habit; label: string }[] = [
  { id: 'capture', label: 'Capture' },
  { id: 'create', label: 'Create' },
  { id: 'review', label: 'Review' },
  { id: 'improve', label: 'Improve' },
]

/** The glyph of a step, 48 × 48, drawn with strokes in `currentColor`. */
export function HabitGlyph({ habit, size = 48 }: { habit: Glyph; size?: number }) {
  return (
    <svg className="kit-habit__glyph" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {habit === 'capture' && (
        <>
          <rect x={11} y={10} width={26} height={32} rx={3} />
          <path d="M17 6V13M24 6V13M31 6V13" />
          <path d="M17 21H31" />
          <path d="M17 28H31M17 35H25" className="kit-habit__soft" />
        </>
      )}
      {habit === 'create' && (
        <>
          <rect x={5} y={16} width={30} height={24} rx={3} />
          <path d="M11 25H22M11 32H19" className="kit-habit__soft" />
          <path d="M37 5 43 11 28 26 21 28 23 21Z" />
        </>
      )}
      {habit === 'review' && (
        <>
          <path d="M6 27 12 10H36L42 27V39H6Z" />
          <path d="M6 27H16L19 32H29L32 27H42" />
          <path d="M17 17H31M19 22H29" className="kit-habit__soft" />
        </>
      )}
      {habit === 'improve' && (
        <>
          <path d="M7 42H41" className="kit-habit__soft" />
          <path d="M8 34 18 24 25 30 39 14" />
          <path d="M30 14H39V23" />
        </>
      )}
      {habit === 'prune' && (
        <>
          <circle cx={14} cy={36} r={6} />
          <circle cx={34} cy={36} r={6} />
          <path d="M18 31 37 6M30 31 11 6" />
          <circle cx={24} cy={19.5} r={1.6} className="kit-habit__pin" />
        </>
      )}
    </svg>
  )
}

export function Habits({ beat, show, lit = [], pages, pageP = [], size = 'large' }: { beat: Beat; show: readonly number[]; lit?: readonly number[]; pages?: readonly (string | undefined)[]; pageP?: readonly number[]; size?: 'large' | 'small' }) {
  return (
    <div className={`kit-habits kit-habits--${size}`} role="img" aria-label="Four steps: capture, create, review, improve">
      {STEPS.map((h, i) => {
        const l = clamp(lit[i] ?? 0)
        return (
          <div key={h.id} className="kit-habit" data-lit={l > 0.5 ? 'true' : undefined} style={pop(beat, show[i] ?? 0, 0.7)}>
            <span className="kit-habit__badge" style={{ ['--kit-lit' as string]: l.toFixed(3) }}>
              <HabitGlyph habit={h.id} />
            </span>
            <span className="kit-habit__label">{h.label}</span>
            {pages?.[i] !== undefined && (
              <span className="kit-habit__note" style={rise(beat, pageP[i] ?? 0, 6)}>
                {pages[i]}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
