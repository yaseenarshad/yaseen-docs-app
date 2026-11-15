import { Fragment, type ReactNode } from 'react'
import { CARD_STYLE_KEYS, readCardText, readCardWeight, readColorStrength } from '@shared/types'
import { type Row, propertyLabel } from '../engine'
import type { Resolver } from '../expr'
import type { ViewDef, ViewSet } from '../viewSchema'
import { rowCell } from './GroupHeader'
import { canonicalKey } from './keys'

/**
 * A card's lines (YAZ-1206, YAZ-1217), one code for the Board and the Calendar (YAZ-4857): each shown key starts a
 * line, and `cardStyle[key].join` puts it on the line being built instead, so the order IS the layout. A note
 * key's line can be bold or underlined and hide its label.
 */
export type CardStyle = NonNullable<ViewDef['cardStyle']>[string]

export const cardStyleOf = (view: ViewDef, key: string): CardStyle => view.cardStyle?.[canonicalKey(key)] ?? {}

/** The text flags a note row carries (YAZ-1206); the title takes part in the layout only (YAZ-1217). */
const styleClasses = (style: CardStyle) => `${style.bold === true ? ' view-board__prop--bold' : ''}${style.underline === true ? ' view-board__prop--underline' : ''}`

/** The card's ROWS (YAZ-1217): each ordered key starts a line, `join` appends it to the one being built — so a join with no line yet is a harmless no-op. */
export function cardLines(keys: readonly string[], view: ViewDef): string[][] {
  return keys.reduce<string[][]>((acc, key) => {
    if (cardStyleOf(view, key).join === true && acc.length > 0) acc[acc.length - 1].push(key)
    else acc.push([key])
    return acc
  }, [])
}

/** One label/value item of a line, as the column's `cardStyle` says. */
export function CardProp({ def, view, row, field, resolve }: { def: ViewSet; view: ViewDef; row: Row; field: string; resolve?: Resolver }) {
  const style = cardStyleOf(view, field)
  return (
    <div className={`view-board__prop${styleClasses(style)}`}>
      {style.hideLabel !== true && <span className="view-board__prop-name">{propertyLabel(def, field)}</span>}
      <span className="view-board__prop-value">{rowCell(row, field, resolve)}</span>
    </div>
  )
}

/**
 * One line: its items with the dash between joined ones. The dash is its OWN element — a pseudo on a flex row would
 * become that row's first flex child and drag the row's internal 8px gap in after itself (the lopsided "App– Sam" bug).
 * `lead` goes first with no dash: the calendar's time and weekend mark.
 */
export function CardLine({ line, item, lead, className = '' }: { line: readonly string[]; item: (key: string) => ReactNode; lead?: ReactNode; className?: string }) {
  return (
    <div className={`view-board__line${className}`}>
      {lead}
      {line.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && (
            <span className="view-board__dash" aria-hidden>
              &ndash;
            </span>
          )}
          {item(key)}
        </Fragment>
      ))}
    </div>
  )
}

/**
 * A card's own style (YAZ-4906): the note's `color` (`readColorStrength`: `blue`, `blue light`), `text_color` and
 * `weight` as the attributes views.css draws the card by, on a calendar card and a board card alike; a value the app
 * cannot read gives none.
 */
export function cardStyleAttrs(properties: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  const fill = readColorStrength(properties[CARD_STYLE_KEYS.fill])
  if (fill !== null) Object.assign(out, { 'data-color': fill.color, 'data-color-strength': fill.strength })
  const text = readCardText(properties[CARD_STYLE_KEYS.text])
  if (text !== null && text !== 'full') out['data-text'] = text
  if (readCardWeight(properties[CARD_STYLE_KEYS.weight]) === 'bold') out['data-weight'] = 'bold'
  return out
}
