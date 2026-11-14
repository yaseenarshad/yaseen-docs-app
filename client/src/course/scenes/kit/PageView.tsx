/**
 * A PAGE, A CARD IN IT, AN EMBED (YAZ-5121, chapter 4 on): the three places a card lives, in the app's look.
 *
 * - `PageView`: a page in a tab (its big title, then its blocks). Its text is made up, set as text.
 * - `PageText`: one paragraph of the page; `p` brings it in.
 * - `EmbedView`: a card embedded in a page, as `editor/card/cardEmbed.ts` draws it: the head `↗ Embedded from
 *   "<title>" · ID`, Edit card, ⋯, then the card through the app's own `renderCard`. `head` lights the head (where it
 *   is from); `editing` shows the editor's key row (in words) and Done.
 * A card inside a page is `CardView` with `chrome="block"`.
 */
import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { renderCard, type CardLook } from '../../../editor/card/cardRender'
import { clamp, ease, lerp, type Beat } from './beat'
import { CardDoneKeys, CardEditKeyRow } from './EditKeys'
import { glowStyle } from './AppFrame'
import '../../../editor/card/card.css'
import '../../../editor/card/cardEmbed.css'
import './screens.css'

export function PageView({ title, children, style, label }: { title: string; children?: ReactNode; style?: CSSProperties; label?: string }) {
  return (
    <div className="kit-page" style={style} aria-label={label}>
      <p className="kit-app__bigtitle kit-page__title">{title}</p>
      {children}
    </div>
  )
}

export function PageText({ beat, children, p = 1 }: { beat: Beat; children: ReactNode; p?: number }) {
  const q = clamp(p)
  return (
    <p className="kit-page__p" style={{ opacity: q, transform: beat.reduced || q >= 1 ? undefined : `translateY(${((1 - ease.out(q)) * 6).toFixed(2)}px)` }}>
      {children}
    </p>
  )
}


interface EmbedViewProps {
  beat: Beat
  /** The card's title (a card file's), for the head. */
  title: string
  id: string
  text: string
  shown?: number
  sides?: number
  /** 0..1: the head lights ("Embedded from"). */
  head?: number
  /** 0..1: the title in the head lights. */
  name?: number
  /** 0..1: the whole box lights. */
  glow?: number
  editing?: boolean
  /** In place of the card's text while editing: the editor's lines. */
  editor?: ReactNode
  /** Under the card (the Reviews line). */
  footer?: ReactNode
  style?: CSSProperties
}

export function EmbedView({ beat, title, id, text, shown = 0, sides, head = 0, name = 0, glow = 0, editing = false, editor, footer, style }: EmbedViewProps) {
  const rendered = useMemo(() => renderCard(text, { shown, sides }, undefined as CardLook | undefined), [text, shown, sides])
  const body = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!editing) body.current?.replaceChildren(rendered)
  }, [rendered, editing])
  const h = clamp(head)
  const n = clamp(name)
  return (
    <div className={`card card-embed kit-embed${editing ? ' card--editing' : ''}`} style={{ ...style, ...glowStyle(glow) }}>
      <div className="card__head card-embed__head" style={h > 0 ? { background: `color-mix(in srgb, var(--accent-soft) ${(h * 100).toFixed(0)}%, var(--bg-side))` } : undefined}>
        <span className="card-embed__from" style={{ color: h > 0 ? 'var(--fg)' : undefined }}>
          <span className="card-embed__arrow" aria-hidden="true">
            ↗
          </span>
          <span>
            Embedded from “<span className="kit-embed__name" style={n > 0 ? { background: `color-mix(in srgb, var(--mark-bg, var(--accent-soft)) ${(n * 100).toFixed(0)}%, transparent)` } : undefined}>{title}</span>”
          </span>
        </span>
        <span className="card-embed__dot">·</span>
        <span className="card__id">{id}</span>
        <span className="card__edit">{editing ? <CardDoneKeys /> : 'Edit card'}</span>
        <span className="card__more">⋯</span>
      </div>
      {editing ? (
        <div className="kit-embed__editor">
          <div className="kit-editcard__text">{editor}</div>
          <CardEditKeyRow />
        </div>
      ) : (
        <div ref={body} className="card__body" />
      )}
      {footer}
    </div>
  )
}

