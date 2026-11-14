/**
 * Settings › Review › Card spacing (YAZ-5050, Yaseen: "the user might want to have spacing for reviewing notecards
 * slightly different than what they want globally"): Same as pages (the default) sets nothing, so a card reads the
 * pages' Line spacing, Space between blocks, Bullet indent and Bullet gap (`noteCard.css` falls back to them); Custom
 * sets the card's own values on `.app`, for the Inbox, the card window and a card in a page. Clean (round 4) sets
 * Mochi's values (`CARD_SPACING_CLEAN`) and Mochi's look (`data-card-clean`: softer text, more room inside the Inbox
 * card, shorter lines there); Custom starts from Clean, keeps its look, and its spacing rows are yours.
 *
 * YAZ-5133: a main process older than a card field (the app not restarted after an update) sends settings without it.
 * Each missing or wrong value is Custom's start, never "undefinedpx": one invalid variable empties every padding that
 * reads it, and a list's markers then sit on its text.
 */
import { CARD_SPACING_CLEAN, type SettingsState } from '@shared/types'

type CardField = keyof typeof CARD_SPACING_CLEAN

const num = (s: SettingsState, k: CardField): number => {
  const v = (s as Partial<SettingsState>)[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : CARD_SPACING_CLEAN[k]
}

/** The CSS variables App puts on `.app`: none for Same as pages, Clean's for Clean, the card's own for Custom. */
export function cardSpacingVars(s: SettingsState): Record<string, string | number> {
  if (s.cardSpacing === 'clean') return cardSpacingVars({ ...s, ...CARD_SPACING_CLEAN, cardSpacing: 'custom' })
  if (s.cardSpacing !== 'custom') return {}
  return {
    '--card-line-height': num(s, 'cardLineSpacing'),
    '--card-block-gap': `${num(s, 'cardBlockGap')}px`,
    '--card-bullet-indent': `${num(s, 'cardBulletIndent')}px`,
    '--card-bullet-gap': `${num(s, 'cardBulletGap')}px`,
    '--card-bullet-space': `${num(s, 'cardBulletSpace')}px`,
  }
}

/** Clean's look (round 4) on `.app`: with Clean, and with Custom, which starts from it. */
export const cardLookAttrs = (s: SettingsState): Record<string, string> => (s.cardSpacing === 'clean' || s.cardSpacing === 'custom' ? { 'data-card-clean': '' } : {})
