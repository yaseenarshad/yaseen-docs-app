/**
 * THE CARD (YAZ-5121): a card in the app's real look, so the course can never drift from the app.
 *
 * - The text goes through the app's own `renderCard` (`editor/card/cardRender.ts`, the function the page, the card
 *   window and the Inbox call): the sides, the "Side 2" line, the hidden words as blanks of the word's width, the
 *   sections (`***`, a rule), the link pills. Its classes are styled by the app's own `card.css` and `cardScreens.css`.
 * - The frame is the Inbox's (`chrome="inbox"`: the row above with the state chip, "Title · ID" and "Side 1 of 2"; the
 *   panel; the card with no frame of its own) or the page's card block (`chrome="block"`: the head with the ID,
 *   Edit card or Done, and ⋯). The frame is a copy built from the same class names (`CardInbox.tsx`, `cardBlockView.ts`).
 * - What moves: `shown` (hidden words shown), `sides`, `flip` (the card turns: the content swaps at the half, from
 *   `flipFrom`), `lit` (a spotlight on parts: each top-level block of the sides, in order, from 0), `dim` (how much
 *   the parts that are not lit step back), `grow` (a part opens), `enter`.
 */
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { renderCard, type CardLook } from '../../../editor/card/cardRender'
import { clamp, ease, lerp, type Beat } from './beat'
import '../../../editor/card/card.css'
import '../../../review/cardScreens.css'

export interface CardViewProps {
  beat: Beat
  /** The card's Markdown: sides split by a line `---`, sections in a side by `***`, hidden words in `{{ }}`. */
  text: string
  title?: string
  /** The card ID in the head (made up). */
  id?: string
  /** How many hidden words show (default 0: all blanks). */
  shown?: number
  /** How many sides show (default all). */
  sides?: number
  /** 0..1: the card turns over; past the half it shows the current `shown`/`sides`, before it `flipFrom`'s. */
  flip?: number
  flipFrom?: { shown?: number; sides?: number }
  /** A spotlight per part, 0..1 (missing: 0). */
  lit?: readonly number[]
  /** 0..1: how far the parts that are not lit step back. */
  dim?: number
  /** Per part, 0..1: the part opens (missing: open). */
  grow?: readonly (number | undefined)[]
  chrome?: 'inbox' | 'block' | 'plain'
  /** The state chip of the Inbox frame ("New card", "Due today"). */
  state?: string
  /** The block frame's edit button: "Edit card", or "Done" while editing. */
  editing?: boolean
  /** 0..1: the blanks pulse (the part to recall). */
  blanks?: number
  /** `[[inner]]` → its pill's label; each is drawn as a link to a card (the card pill). */
  links?: Readonly<Record<string, string>>
  /** Under the card (the answers, a line). */
  footer?: ReactNode
  className?: string
  /** `aria-label` of the card. */
  label?: string
}

function lookOf(links: Readonly<Record<string, string>> | undefined): CardLook | undefined {
  if (links === undefined) return undefined
  return { link: (inner) => ({ label: links[inner] ?? inner, resolved: true, card: 'K7Q2' }) }
}

/** The rendered sides (the app's own render), as a node to mount. */
function useRendered(text: string, shown: number, sides: number | undefined, links: Readonly<Record<string, string>> | undefined): HTMLElement {
  return useMemo(() => {
    const out = renderCard(text, { shown, sides }, lookOf(links))
    let n = 0
    for (const side of out.querySelectorAll('.card__side')) {
      for (const child of side.children) {
        // A section's rule goes with the section after it (it opens with it).
        if (child.tagName === 'HR') {
          ;(child as HTMLElement).dataset.rule = String(n)
          continue
        }
        ;(child as HTMLElement).dataset.part = String(n)
        n += 1
      }
    }
    return out
  }, [text, shown, sides, links])
}

export function CardView(props: CardViewProps) {
  const { beat, text, title, id = 'K7Q2', shown = 0, sides, flip = 0, flipFrom, lit = [], dim = 0, grow = [], chrome = 'inbox', state = 'New card', editing = false, blanks = 0, links, footer, className, label } = props
  const turned = flip >= 0.5 || flipFrom === undefined
  const nowShown = turned ? shown : (flipFrom?.shown ?? shown)
  const nowSides = turned ? sides : (flipFrom?.sides ?? sides)
  const rendered = useRendered(text, nowShown, nowSides, links)
  const body = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    body.current?.replaceChildren(rendered)
  }, [rendered])

  // Each frame: the parts' light, dim and growth, straight on the rendered nodes (no React state per frame).
  useLayoutEffect(() => {
    const root = body.current
    if (root === null) return
    const d = clamp(dim)
    for (const rule of root.querySelectorAll<HTMLElement>('[data-rule]')) {
      const g = grow[Number(rule.dataset.rule)]
      rule.style.opacity = g === undefined ? '' : String(clamp(g * 1.4))
      rule.style.display = g !== undefined && g <= 0 ? 'none' : ''
    }
    for (const part of root.querySelectorAll<HTMLElement>('[data-part]')) {
      const i = Number(part.dataset.part)
      const l = clamp(lit[i] ?? 0)
      const g = grow[i]
      const open = g === undefined ? 1 : clamp(g)
      part.style.opacity = String(lerp(1 - 0.72 * d, 1, l) * (g === undefined ? 1 : clamp(open * 1.4)))
      part.style.backgroundColor = l > 0 ? `color-mix(in srgb, var(--accent-soft) ${(l * 100).toFixed(1)}%, transparent)` : ''
      part.style.boxShadow = l > 0 ? `0 0 0 ${(6 * l).toFixed(2)}px color-mix(in srgb, var(--accent-soft) ${(l * 100).toFixed(1)}%, transparent)` : ''
      part.style.borderRadius = l > 0 ? '6px' : ''
      part.style.display = g !== undefined && open <= 0 ? 'none' : ''
      if (g === undefined) {
        part.style.maxHeight = ''
        part.style.overflow = ''
        part.style.transform = ''
      } else {
        const e = beat.reduced ? (open > 0 ? 1 : 0) : ease.out(open)
        part.style.maxHeight = `${(e * 12).toFixed(3)}em`
        part.style.overflow = 'hidden'
        part.style.transform = beat.reduced ? '' : `translateY(${((1 - e) * -6).toFixed(2)}px)`
      }
    }
    const b = clamp(blanks)
    for (const blank of root.querySelectorAll<HTMLElement>('.card__blank')) {
      blank.style.backgroundColor = b > 0 ? `color-mix(in srgb, var(--accent) ${(b * 22).toFixed(1)}%, transparent)` : ''
      blank.style.borderBottomColor = b > 0 ? 'var(--accent)' : ''
    }
  })

  // The turn: a quarter turn out, the content swaps, a quarter turn back. Reduced motion: a cross-fade.
  const f = clamp(flip)
  const angle = flipFrom === undefined || f <= 0 || f >= 1 ? 0 : f < 0.5 ? ease.inOut(f * 2) * 90 : (1 - ease.inOut((f - 0.5) * 2)) * -90
  const turnStyle = beat.reduced ? { opacity: flipFrom === undefined ? 1 : Math.abs(1 - f * 2) * 0.85 + 0.15 } : angle === 0 ? undefined : { transform: `perspective(1800px) rotateY(${angle.toFixed(2)}deg)` }
  const sideCount = text.split(/\n---\n/).length
  const showingSides = Math.min(nowSides ?? sideCount, sideCount)

  const inner = <div ref={body} className="card__body" />
  return (
    <div className={`kit-cardview kit-cardview--${chrome}${className === undefined ? '' : ` ${className}`}`} aria-label={label}>
      {chrome === 'inbox' && (
        <>
          <div className="card-inbox__above">
            <span className="card-inbox__state">{state}</span>
            <span className="card-inbox__head">
              {title !== undefined && (
                <>
                  <span className="card-inbox__name">{title}</span>
                  <span className="card-inbox__dot" aria-hidden="true">
                    ·
                  </span>
                </>
              )}
              <span className="card__id">{id}</span>
            </span>
            {sideCount > 1 && <span className="card-inbox__sides">{`Side ${showingSides} of ${sideCount}`}</span>}
          </div>
          <div className="card-inbox__panel" style={turnStyle}>
            <div className="card-inbox__body">
              <div className="card card-screen card-inbox__card">{inner}</div>
            </div>
          </div>
        </>
      )}
      {chrome === 'block' && (
        <div className={`card${editing ? ' card--editing' : ''}`} style={turnStyle}>
          <div className="card__head">
            <span className="card__id">{id}</span>
            {title !== undefined && <span className="kit-cardview__title">{title}</span>}
            <span className="card__edit">{editing ? 'Done' : 'Edit card'}</span>
            <span className="card__more">⋯</span>
          </div>
          {inner}
        </div>
      )}
      {chrome === 'plain' && (
        <div className="card" style={turnStyle}>
          {inner}
        </div>
      )}
      {footer}
    </div>
  )
}
