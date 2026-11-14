/**
 * THE THREE HABITS (YAZ-5121, chapters 9 to 12): a pen (Make), the Inbox's tray (Review) and shears (Tend), each in a
 * round badge with its name and, optionally, a short line under it ("every day"). Chapter 9 brings them in; chapters
 * 10, 11 and 12 open on them again, so the person knows the system at a glance. A pure drawing of its beat.
 *
 * - `show[i]`: the badge comes in (0..1); `lit[i]`: it lights (the accent fill); `pages[i]`: the line under it, with
 *   `pageP[i]` its fade.
 * - `HabitGlyph`: one icon alone (a corner of a scene: the shears inside the Inbox in chapter 9).
 */
import { clamp, pop, rise, type Beat } from './beat'
import './kit.css'

export type Habit = 'make' | 'review' | 'tend'

const HABITS: readonly { id: Habit; label: string }[] = [
  { id: 'make', label: 'Make' },
  { id: 'review', label: 'Review' },
  { id: 'tend', label: 'Tend' },
]

/** The glyph of a habit, 48 × 48, drawn with strokes in `currentColor`. */
export function HabitGlyph({ habit, size = 48 }: { habit: Habit; size?: number }) {
  return (
    <svg className="kit-habit__glyph" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {habit === 'make' && (
        <>
          <path d="M33 7 41 15 19 37 9 39 11 29Z" />
          <path d="M29 11 37 19M11 29 19 37" />
          <path d="M8 43H28" className="kit-habit__soft" />
        </>
      )}
      {habit === 'review' && (
        <>
          <path d="M6 27 12 10H36L42 27V39H6Z" />
          <path d="M6 27H16L19 32H29L32 27H42" />
          <path d="M17 17H31M19 22H29" className="kit-habit__soft" />
        </>
      )}
      {habit === 'tend' && (
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
    <div className={`kit-habits kit-habits--${size}`} role="img" aria-label="Three habits: make, review, tend">
      {HABITS.map((h, i) => {
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
