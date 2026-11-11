import { type ReactNode, useContext, useState } from 'react'
import { CARD_STYLE_KEYS, COLOR_STRENGTHS, HEADER_ROW_CHOICES, type ColorName, type ColorStrength, headerRowLabel, readCardText, readCardWeight, readColorStrength, writeColorStrength } from '@shared/types'
import { capital, headerSwatch } from '../../editor/table/colours'
import { FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'

/** One property write of a card's style: `value` undefined removes the key. */
export interface CardStyleWrite {
  key: string
  value: string | undefined
}

type Tab = 'fill' | 'text' | 'style'
const TABS: readonly (readonly [Tab, string])[] = [['fill', 'Fill'], ['text', 'Text'], ['style', 'Style']]

/**
 * "Card style ›" in a card's right-click menu (YAZ-4906 round 2; Yaseen: "model how we have it for headers in tables").
 * The table's "Header row ›" panel again (`tableRows.ts` `headerRowParent`, drawn by `blockHandleMenu.ts`
 * `fillFlyout`), with its classes: "Plain, like any card" on top, the Fill · Text · Style tabs (`fill-target`), the
 * Off · Light · Medium · Strong switch (`fill-target--sub`), the rows with swatches and a ✓ at what the card shows.
 * A pick keeps the flyout open, so the fill, the text and the weight go in one visit. The three properties are
 * `color`, `text_color` and `weight` (`CARD_STYLE_KEYS`); `onPick` writes them, one step of ⌘Z each.
 */
export function CardStyleFlyout({ properties, onPick }: { properties: Readonly<Record<string, unknown>>; onPick: (writes: CardStyleWrite[]) => void }) {
  const own = useFlyout<string>()
  const flyout = useContext(MenuFlyout) ?? own
  const [tab, setTab] = useState<Tab>('fill')
  const fill = readColorStrength(properties[CARD_STYLE_KEYS.fill])
  const text = readCardText(properties[CARD_STYLE_KEYS.text]) ?? 'full'
  const weight = readCardWeight(properties[CARD_STYLE_KEYS.weight]) ?? 'regular'
  const plain = fill === null && text === 'full' && weight === 'regular'
  const write = (key: string, value: string | undefined) => onPick([{ key, value }])
  const item = (label: string, on: boolean, run: () => void, swatch?: string) => (
    <button key={label} type="button" role="menuitem" className="ctx-menu__item" data-hint={on ? '✓' : undefined} onClick={() => !on && run()}>
      {swatch === undefined ? (
        label
      ) : (
        <span className="ctx-menu__label">
          <span className="table-menu-swatch" style={{ background: swatch }} />
          {label}
        </span>
      )}
    </button>
  )
  const seg = (label: string, options: readonly (readonly [string, string])[], value: string, pick: (next: string) => void) => (
    <div className="fill-target fill-target--sub" role="group" aria-label={label}>
      {options.map(([v, name]) => (
        <button key={v} type="button" className="fill-target__opt" aria-pressed={v === value} onClick={() => v !== value && pick(v)}>
          {name}
        </button>
      ))}
    </div>
  )
  let body: ReactNode
  if (tab === 'fill')
    body = (
      <>
        {seg('Fill strength', [['off', 'Off'], ...COLOR_STRENGTHS.map((s) => [s, capital(s)] as const)], fill?.strength ?? 'off', (next) =>
          write(CARD_STYLE_KEYS.fill, next === 'off' ? undefined : writeColorStrength({ color: fill?.color ?? 'gray', strength: next as ColorStrength })),
        )}
        {HEADER_ROW_CHOICES.color.map((c) => item(capital(c), fill?.color === c, () => write(CARD_STYLE_KEYS.fill, writeColorStrength({ color: c as ColorName, strength: fill?.strength ?? 'medium' })), headerSwatch(c)))}
      </>
    )
  else if (tab === 'text')
    body = HEADER_ROW_CHOICES.text.map((c) => item(capital(c), text === c, () => write(CARD_STYLE_KEYS.text, c === 'full' ? undefined : c), c === 'muted' || c === 'full' ? undefined : headerSwatch(c)))
  else
    body = (
      <>
        <div className="ctx-menu__heading" role="presentation">
          Weight
        </div>
        {HEADER_ROW_CHOICES.weight.map((w) => item(headerRowLabel(w), weight === w, () => write(CARD_STYLE_KEYS.weight, w === 'regular' ? undefined : w)))}
      </>
    )
  return (
    <FlyoutParent label="Card style" open={flyout.open === 'card-style'} menuClassName="ctx-menu--glyphs" measureKey={tab} onHover={() => flyout.hover('card-style')} onOpen={() => flyout.openNow('card-style')} onCloseFlyout={() => flyout.openNow(null)}>
      <div className="ctx-menu__group" role="group">
        {item('Plain, like any card', plain, () => onPick(Object.values(CARD_STYLE_KEYS).filter((key) => properties[key] !== undefined).map((key) => ({ key, value: undefined }))))}
      </div>
      <div className="ctx-menu__group" role="group">
        <div className="fill-target" role="group" aria-label="Card style">
          {TABS.map(([t, name]) => (
            <button key={t} type="button" className="fill-target__opt" aria-pressed={t === tab} onClick={() => setTab(t)}>
              {name}
            </button>
          ))}
        </div>
        {body}
      </div>
    </FlyoutParent>
  )
}
