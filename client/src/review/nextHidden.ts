/**
 * Settings › Review › Mark the next hidden word (YAZ-5053 round 3, Yaseen: "can it have a color to it so we know that
 * that is where the eye should go?"): App puts these on `.app`. The render marks the one blank the next Space shows
 * (`data-next`, `cardRender.ts`); `card.css` colours it in the look of Shown hidden words. The default colour is
 * the theme's `--next-hidden` (`app.css`, light and dark); a picked colour is the same in both.
 */
import type { SettingsState } from '@shared/types'

/** On unless it is Off: settings from a main process older than the field (the app not restarted) read the default, On (YAZ-5133's lesson). */
const on = (s: SettingsState): boolean => s.markNextHidden !== false

export const nextHiddenAttrs = (s: SettingsState): Record<string, string> => (on(s) ? { 'data-mark-next-hidden': '' } : {})

/** Only a picked hex colour; anything else (none, or missing) is the theme's default. */
export const nextHiddenVars = (s: SettingsState): Record<string, string> => (on(s) && typeof s.nextHiddenColour === 'string' && /^#[0-9a-f]{6}$/i.test(s.nextHiddenColour) ? { '--next-hidden': s.nextHiddenColour } : {})
