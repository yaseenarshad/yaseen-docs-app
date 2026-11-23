import { CARD_STYLE_KEYS, type ColorName, type ColorStrength, readCardText, readCardWeight, readColorStrength, writeColorStrength } from '@shared/types'
import { StyleFlyout } from './StylePanel'

/** One property write of a card's style: `value` undefined removes the key. */
export interface CardStyleWrite {
  key: string
  value: string | undefined
}

/**
 * "Card style ›" in a card's right-click menu (YAZ-4906 round 2; Yaseen: "model how we have it for headers in tables"):
 * the style panel (`StylePanel.tsx`, the table's "Header row ›" panel) on a page's three properties, `color`,
 * `text_color` and `weight` (`CARD_STYLE_KEYS`). A card has no Align. Off removes the fill; a colour at Off is Medium.
 * "Plain, like any card" removes the three in one write. `onPick` writes them, one step of ⌘Z each.
 */
export function CardStyleFlyout({ properties, onPick }: { properties: Readonly<Record<string, unknown>>; onPick: (writes: CardStyleWrite[]) => void }) {
  const fill = readColorStrength(properties[CARD_STYLE_KEYS.fill])
  const text = readCardText(properties[CARD_STYLE_KEYS.text]) ?? 'full'
  const weight = readCardWeight(properties[CARD_STYLE_KEYS.weight]) ?? 'regular'
  const write = (key: string, value: string | undefined) => onPick([{ key, value }])
  return (
    <StyleFlyout
      label="Card style"
      shown={{ strength: fill?.strength ?? 'off', color: fill?.color ?? null, text, weight }}
      plainLabel="Plain, like any card"
      plainOn={fill === null && text === 'full' && weight === 'regular'}
      onPlain={() => onPick(Object.values(CARD_STYLE_KEYS).filter((key) => properties[key] !== undefined).map((key) => ({ key, value: undefined })))}
      onPick={(part, value) => {
        if (part === 'strength') write(CARD_STYLE_KEYS.fill, value === 'off' ? undefined : writeColorStrength({ color: fill?.color ?? 'gray', strength: value as ColorStrength }))
        else if (part === 'color') write(CARD_STYLE_KEYS.fill, writeColorStrength({ color: value as ColorName, strength: fill?.strength ?? 'medium' }))
        else if (part === 'text') write(CARD_STYLE_KEYS.text, value === 'full' ? undefined : value)
        else if (part === 'weight') write(CARD_STYLE_KEYS.weight, value === 'regular' ? undefined : value)
      }}
    />
  )
}
