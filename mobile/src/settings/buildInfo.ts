/**
 * Which build this phone runs. Vite sets the three values at build time (`buildDefine` in `vite.config.ts`):
 * the version of `mobile/package.json`, the build's time (ISO, UTC) and its short commit.
 */
declare const __NOTECARDS_VERSION__: string | undefined
declare const __NOTECARDS_BUILT__: string | undefined
declare const __NOTECARDS_COMMIT__: string | undefined

export interface BuildInfo {
  version: string
  /** ISO time of the build, or '' when not known. */
  built: string
  /** Short commit, or '' when not known. */
  commit: string
}

export const BUILD: BuildInfo = {
  version: typeof __NOTECARDS_VERSION__ === 'string' ? __NOTECARDS_VERSION__ : 'dev',
  built: typeof __NOTECARDS_BUILT__ === 'string' ? __NOTECARDS_BUILT__ : '',
  commit: typeof __NOTECARDS_COMMIT__ === 'string' && __NOTECARDS_COMMIT__ !== 'unknown' ? __NOTECARDS_COMMIT__ : '',
}

/** "14 Nov 2026, 10:42" in the phone's own time zone (or `timeZone`), 24-hour. '' for a time that does not read. */
export function buildTime(iso: string, timeZone?: string): string {
  const at = new Date(iso)
  if (iso === '' || Number.isNaN(at.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(at)
}

/**
 * YAZ-5593: the build's commit as `/version.txt` names it (the same short commit, e.g. "bb8a4aa30"), else the version.
 * The one text for the build everywhere: the line at the top, the Version row, "You have the newest build (…)".
 */
export function buildName(info: BuildInfo): string {
  return info.commit !== '' ? info.commit : info.version
}

/**
 * The Version row's words: "Version 0.7.0 · Build bb8a4aa30 · 15 Nov 2026, 14:02" (the parts that are known). YAZ-5593:
 * the version and the build named, so the commit reads as the same build as the line at the top.
 */
export function versionWords(info: BuildInfo, timeZone?: string): string {
  return [`Version ${info.version}`, info.commit !== '' ? `Build ${info.commit}` : '', buildTime(info.built, timeZone)].filter((part) => part !== '').join(' · ')
}

/** YAZ-5555: "15 Nov, 14:02": the build's day and time, short (no year), in the phone's own time. '' when not known. */
export function buildShortTime(iso: string, timeZone?: string): string {
  const at = new Date(iso)
  if (iso === '' || Number.isNaN(at.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`
}

/**
 * YAZ-5555: the one short line at the top of Settings, so the build shows without opening anything:
 * "Build bb8a4aa30 · 15 Nov, 14:02" (YAZ-5593: the whole short commit, as `/version.txt` and the Version row show it,
 * else the version; then the build's day and time when known). The Version row below keeps the whole words.
 */
export function buildLine(info: BuildInfo, timeZone?: string): string {
  return [`Build ${buildName(info)}`, buildShortTime(info.built, timeZone)].filter((part) => part !== '').join(' · ')
}
