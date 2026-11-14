/**
 * Settings › Review › Card spacing (YAZ-5050, Yaseen: "the user might want to have spacing for reviewing notecards
 * slightly different than what they want globally"): Same as pages (the default) sets nothing, so a card reads the
 * pages' Line spacing, Space between blocks, Bullet indent and Bullet gap (`noteCard.css` falls back to them); Custom
 * sets the card's own values on `.app`, for the Inbox, the card window and a card in a page. Custom starts at Mochi's
 * clean values (round 3, `CARD_SPACING_CUSTOM_START`), not at the pages'.
 */
import type { SettingsState } from '@shared/types'

/** The CSS variables App puts on `.app`: none for Same as pages. */
export function cardSpacingVars(s: SettingsState): Record<string, string | number> {
  if (s.cardSpacing !== 'custom') return {}
  return {
    '--card-line-height': s.cardLineSpacing,
    '--card-block-gap': `${s.cardBlockGap}px`,
    '--card-bullet-indent': `${s.cardBulletIndent}px`,
    '--card-bullet-gap': `${s.cardBulletGap}px`,
    '--card-bullet-space': `${s.cardBulletSpace}px`,
  }
}
