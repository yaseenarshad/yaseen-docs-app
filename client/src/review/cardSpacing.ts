/**
 * Settings › Review › Card spacing (YAZ-5050, Yaseen: "the user might want to have spacing for reviewing notecards
 * slightly different than what they want globally"): Same as pages (the default) sets nothing, so a card reads the
 * pages' Line spacing, Space between blocks, Bullet indent and Bullet gap (`noteCard.css` falls back to them); Custom
 * sets the card's own four on `.app`, for the Inbox, the card window and a card in a page.
 */
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'

type CardSpacingValues = Pick<SettingsState, 'cardLineSpacing' | 'cardBlockGap' | 'cardBulletIndent' | 'cardBulletGap'>

/** The CSS variables App puts on `.app`: none for Same as pages. */
export function cardSpacingVars(s: SettingsState): Record<string, string | number> {
  if (s.cardSpacing !== 'custom') return {}
  return {
    '--card-line-height': s.cardLineSpacing,
    '--card-block-gap': `${s.cardBlockGap}px`,
    '--card-bullet-indent': `${s.cardBulletIndent}px`,
    '--card-bullet-gap': `${s.cardBulletGap}px`,
  }
}

/** Custom's start: the pages' own values, so a switch to Custom moves nothing until a value is changed. */
export const cardSpacingFromPages = (s: SettingsState): CardSpacingValues => ({
  cardLineSpacing: s.lineSpacing,
  cardBlockGap: s.blockGap,
  cardBulletIndent: s.noteBulletIndent ?? DEFAULT_SETTINGS.noteBulletIndent,
  cardBulletGap: s.noteBulletGap ?? DEFAULT_SETTINGS.noteBulletGap,
})
