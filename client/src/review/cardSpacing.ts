/**
 * Settings › Review › Card spacing (YAZ-5050, Yaseen: "the user might want to have spacing for reviewing notecards
 * slightly different than what they want globally"): Same as pages (the default) sets nothing, so a card reads the
 * pages' Line spacing, Space between blocks, Bullet indent and Bullet gap (`noteCard.css` falls back to them); Custom
 * sets the card's own values on `.app`, for the Inbox, the card window and a card in a page. Custom starts at Mochi's
 * clean values (round 3, `CARD_SPACING_CUSTOM_START`), not at the pages'.
 *
 * YAZ-5133: a main process older than a card field (the app not restarted after an update) sends settings without it.
 * Each missing or wrong value is Custom's start, never "undefinedpx": one invalid variable empties every padding that
 * reads it, and a list's markers then sit on its text.
 */
import { CARD_SPACING_CUSTOM_START, type SettingsState } from '@shared/types'

type CardField = keyof typeof CARD_SPACING_CUSTOM_START

const num = (s: SettingsState, k: CardField): number => {
  const v = (s as Partial<SettingsState>)[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : CARD_SPACING_CUSTOM_START[k]
}

/** The CSS variables App puts on `.app`: none for Same as pages. */
export function cardSpacingVars(s: SettingsState): Record<string, string | number> {
  if (s.cardSpacing !== 'custom') return {}
  return {
    '--card-line-height': num(s, 'cardLineSpacing'),
    '--card-block-gap': `${num(s, 'cardBlockGap')}px`,
    '--card-bullet-indent': `${num(s, 'cardBulletIndent')}px`,
    '--card-bullet-gap': `${num(s, 'cardBulletGap')}px`,
    '--card-bullet-space': `${num(s, 'cardBulletSpace')}px`,
  }
}
