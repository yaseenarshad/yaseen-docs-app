/**
 * A SPOKEN QUOTE (YAZ-5121, chapter 8): a person's short line, in quotation marks, with their name under it. A
 * highlighter sweeps it as the voice says it (`sweep`), as `Paper` does a paper's line. Only short quotes (the data's
 * test holds each under 15 words, `papers.ts`).
 */
import { clamp, ease, type Beat } from './beat'
import './kit68.css'

export function QuoteCard({ beat, text, by, where, p, sweep = 0 }: { beat: Beat; text: string; by: string; where?: string; p: number; sweep?: number }) {
  const q = clamp(p)
  const wash = beat.reduced ? (sweep > 0 ? 1 : 0) : ease.inOut(clamp(sweep))
  return (
    <figure className="kit-quote" style={{ opacity: clamp(q * 1.6), transform: beat.reduced ? undefined : `translateY(${((1 - ease.out(q)) * 16).toFixed(2)}px)` }}>
      <span className="kit-quote__mark" aria-hidden="true">
        “
      </span>
      <blockquote className="kit-quote__text">
        <mark style={{ backgroundSize: `${(wash * 100).toFixed(1)}% 100%` }}>{text}</mark>
      </blockquote>
      <figcaption className="kit-quote__by">
        <b>{by}</b>
        {where !== undefined && <span> · {where}</span>}
      </figcaption>
    </figure>
  )
}
