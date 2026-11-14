/**
 * A JOURNAL'S ISSUE (YAZ-5121, chapter 3 on): the cover of the issue a paper came out in, as TEXT and a plain drawing:
 * the journal's name in a plain serif (never its logo or its real cover art) and the year. The
 * paper (`Paper`) then slides out of it. Use it when the voice names the journal ("a study in the journal Science").
 *
 * `p`: the cover comes in; `out`: it steps back and dims as the paper comes out of it.
 */
import { clamp, ease, lerp, type Beat } from './beat'
import './screens.css'

interface JournalIssue {
  journal: string
  year: number
}

export function JournalCover({ beat, issue, p, out = 0 }: { beat: Beat; issue: JournalIssue; p: number; out?: number }) {
  const q = clamp(p)
  const o = clamp(out)
  const m = beat.reduced ? (q > 0 ? 1 : 0) : ease.out(q)
  const back = beat.reduced ? (o > 0 ? 1 : 0) : ease.inOut(o)
  return (
    <figure
      className="kit-journal"
      aria-label={`${issue.journal}, ${issue.year}`}
      style={{
        opacity: clamp(q * 2) * lerp(1, 0.35, back),
        transform: beat.reduced ? undefined : `translate(${lerp(-10, -14 * back, m).toFixed(2)}%, ${lerp(8, 0, m).toFixed(2)}%) rotate(${lerp(-6, -3, m).toFixed(2)}deg) scale(${lerp(1, 0.9, back).toFixed(3)})`,
      }}
    >
      <p className="kit-journal__name">{issue.journal}</p>
      <p className="kit-journal__meta">{issue.year}</p>
      <span className="kit-journal__art" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </figure>
  )
}
