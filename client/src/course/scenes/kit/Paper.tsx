/**
 * THE PAPER (YAZ-5121): "pull up the paper", as people do on YouTube. A page-like card slides in with the journal's
 * name, the title, the authors' last names and the year, all set as TEXT; grey bars stand for the rest of the page
 * (a drawing, never its words). A highlighter sweeps over the ONE line (`PaperCite.line`, from `papers.ts`, where the
 * copyright rule lives). Then the page steps back and the number lifts out and grows (`BigNumber`).
 *
 * Cues are fractions of the clip (`at`): `in` (the page slides in), `highlight` (the sweep starts), `lift` (the page
 * steps back for the number; absent: it stays), `out` (it leaves). Each motion takes fixed seconds, so it reads the
 * same in a long clip and a short one.
 */
import type { CSSProperties } from 'react'
import { byline, type PaperCite } from '../papers'
import { clamp, ease, lerp, moved, since, type Beat } from './beat'

export interface PaperCues {
  in?: number
  highlight?: number
  lift?: number
  out?: number
}

/** The grey bars of the page: the rest of the text, as a drawing. Widths in percent. */
const BEFORE = [96, 88, 92, 54]
const AFTER = [90, 94, 71]

export function Paper({ beat, paper, at = {}, compact = false }: { beat: Beat; paper: PaperCite; at?: PaperCues; compact?: boolean }) {
  const inP = since(beat, at.in ?? 0, 0.9)
  const sweep = at.highlight === undefined ? 0 : since(beat, at.highlight, 1.1)
  const lift = at.lift === undefined ? 0 : since(beat, at.lift, 0.5)
  const out = at.out === undefined ? 0 : since(beat, at.out, 0.6)
  const m = moved(beat, inP, ease.out)
  const l = moved(beat, lift)
  const style: CSSProperties = {
    opacity: clamp(inP * 1.6) * lerp(1, 0.14, clamp(lift)) * (1 - out),
    transform: beat.reduced
      ? undefined
      : `translate(${lerp(18, 0, m).toFixed(2)}%, ${lerp(14, 0, m) + lerp(0, -6, l)}%) rotate(${lerp(4, -1.2, m).toFixed(2)}deg) scale(${lerp(1, 0.86, l).toFixed(3)})`,
  }
  // The highlighter: a wash that grows left to right over the line, then stays.
  const wash = beat.reduced ? (sweep > 0 ? 1 : 0) : ease.inOut(sweep)
  return (
    <figure className={`kit-paper${compact ? ' kit-paper--compact' : ''}`} style={style} aria-label={`${paper.journal}, ${paper.year}: ${paper.title}`}>
      <p className="kit-paper__journal">
        <span>{paper.journal}</span>
        <span className="kit-paper__year">{paper.year}</span>
      </p>
      <p className="kit-paper__title">{paper.title}</p>
      <p className="kit-paper__authors">{byline(paper.authors)}</p>
      <div className="kit-paper__text" aria-hidden="true">
        {BEFORE.map((w, i) => (
          <i key={`b${i}`} style={{ width: `${w}%` }} />
        ))}
      </div>
      <p className="kit-paper__line">
        <mark style={{ backgroundSize: `${(wash * 100).toFixed(1)}% 100%`, opacity: beat.reduced ? clamp(sweep * 2) * 0.6 + 0.4 : 1 }}>{paper.quote ? `“${paper.line}”` : paper.line}</mark>
      </p>
      <div className="kit-paper__text" aria-hidden="true">
        {AFTER.map((w, i) => (
          <i key={`a${i}`} style={{ width: `${w}%` }} />
        ))}
      </div>
    </figure>
  )
}

/** A short citation under a drawing: "Neural Plasticity · Naqib, Sossin & Farah · 2012". */
export function Cite({ beat, paper, p }: { beat: Beat; paper: PaperCite; p: number }) {
  return (
    <p className="kit-cite" style={{ opacity: clamp(p), transform: beat.reduced ? undefined : `translateY(${((1 - ease.out(clamp(p))) * 6).toFixed(2)}px)` }}>
      <span className="kit-cite__journal">{paper.journal}</span> · {byline(paper.authors)} · {paper.year}
    </p>
  )
}

/**
 * THE BIG NUMBER: a number that lifts out of the page and grows, counting up while it grows. `value` is the number;
 * `text` (optional) is how it is written when it lands ("1,350+"); `label` the words under it.
 */
export function BigNumber({ beat, p, value, text, label, prefix = '', suffix = '', tone = 'accent' }: { beat: Beat; p: number; value: number; text?: string; label?: string; prefix?: string; suffix?: string; tone?: 'accent' | 'ok' | 'fg' }) {
  const q = clamp(p)
  const grow = moved(beat, q, ease.back)
  const count = beat.reduced ? value : Math.round(value * ease.out(clamp(q * 1.25)))
  const shown = q >= 0.8 || beat.reduced ? (text ?? `${prefix}${value.toLocaleString('en-US')}${suffix}`) : `${prefix}${count.toLocaleString('en-US')}${suffix}`
  return (
    <div
      className={`kit-big kit-big--${tone}`}
      style={{
        opacity: clamp(q * 3),
        transform: beat.reduced ? undefined : `translateY(${lerp(28, 0, ease.out(q)).toFixed(2)}%) scale(${lerp(0.35, 1, grow).toFixed(4)})`,
      }}
    >
      <span className="kit-big__value">{shown}</span>
      {label !== undefined && <span className="kit-big__label">{label}</span>}
    </div>
  )
}
