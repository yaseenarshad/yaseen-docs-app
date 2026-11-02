/**
 * Settings › Editor › Tables › Time format (YAZ-4163, YAZ-4159 D15), as the editor reads it: App writes it on each
 * change, and "/Calendar table", "Time slots" and "Current time" read it at the click. A tiny module, as
 * `code/languageHelpers.ts` is, so no editor rebuilds for a change.
 */
import { DEFAULT_TIME_FORMAT, isValidTimeFormat } from '@shared/timeFormat'

let current = DEFAULT_TIME_FORMAT

/** App's door: a style the reader cannot read back is the default. */
export function setTimeFormatSetting(format: string): void {
  current = isValidTimeFormat(format) ? format : DEFAULT_TIME_FORMAT
}

export const timeFormatSetting = (): string => current
