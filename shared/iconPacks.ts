/**
 * THE ADD PANEL'S ICON FILTERS AND ICON PACKS (YAZ-4357: 2B YAZ-4359, 2C YAZ-4360, 2D YAZ-4361). Shared by main and the
 * renderer, so both read the same rules.
 *
 * - Filters (2C, round 3 decisions 4 and 5): the Filter menu right of the search field. They ride on `media:search` as
 *   `MediaSearchRequest.filters`, and MAIN applies them: streaming sends Iconify the allowed packs as `prefixes`, the
 *   downloaded packs filter on their own data. They are remembered in `SettingsState.mediaFilters` and travel.
 * - Packs (2B, round 2 decisions 4, 5 and 8): "Download all icon packs" puts every Iconify pack on this Mac. Main owns
 *   the download (`media.packs`), its progress (`media:packs-progress`) and the local search.
 * - A pack (2D): "More from this pack" opens one pack in the Add panel. Pinned packs (`SettingsState.mediaPinnedPacks`)
 *   come first in Filter › Packs, and travel.
 *
 * Pure: no Node, no DOM.
 */

/** Colors: every icon, one-color icons only (`currentColor` packs), or many-color icons only. From the pack's `palette`. */
export type MediaColorFilter = 'any' | 'one' | 'many'
/** Style: from the icon name's ending (`-outline`, `-fill`, `-duotone` …); Emoji from the pack's category. */
export type MediaStyleFilter = 'any' | 'outline' | 'filled' | 'duotone' | 'emoji'
/** License: every pack, or Business-safe — no non-commercial pack (today `cbi` and `ps`, extra 16). */
export type MediaLicenseFilter = 'any' | 'business'

export const MEDIA_COLOR_FILTERS: readonly MediaColorFilter[] = ['any', 'one', 'many']
export const MEDIA_STYLE_FILTERS: readonly MediaStyleFilter[] = ['any', 'outline', 'filled', 'duotone', 'emoji']
export const MEDIA_LICENSE_FILTERS: readonly MediaLicenseFilter[] = ['any', 'business']

/** The filters of one search. `packs` empty = every pack. */
export interface MediaFilters {
  colors: MediaColorFilter
  style: MediaStyleFilter
  packs: string[]
  license: MediaLicenseFilter
}

export const DEFAULT_MEDIA_FILTERS: MediaFilters = { colors: 'any', style: 'any', packs: [], license: 'any' }

/** The most packs one filter (or the pin list) names. Iconify has about 280. */
export const MAX_FILTER_PACKS = 400

/** An Iconify pack prefix: lowercase words joined by `-` (`fluent-emoji-flat`). Also what makes a safe file name. */
export const isIconPrefix = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)

const isPackList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_FILTER_PACKS && v.every(isIconPrefix)

export function isMediaFilters(v: unknown): v is MediaFilters {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const f = v as Record<string, unknown>
  return (
    (MEDIA_COLOR_FILTERS as readonly unknown[]).includes(f.colors) &&
    (MEDIA_STYLE_FILTERS as readonly unknown[]).includes(f.style) &&
    (MEDIA_LICENSE_FILTERS as readonly unknown[]).includes(f.license) &&
    isPackList(f.packs)
  )
}

/** A stored or sent value, part by part: a part this build cannot read keeps its default. */
export function sanitizeMediaFilters(v: unknown): MediaFilters {
  const f = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    colors: (MEDIA_COLOR_FILTERS as readonly unknown[]).includes(f.colors) ? (f.colors as MediaColorFilter) : 'any',
    style: (MEDIA_STYLE_FILTERS as readonly unknown[]).includes(f.style) ? (f.style as MediaStyleFilter) : 'any',
    packs: Array.isArray(f.packs) ? [...new Set(f.packs.filter(isIconPrefix))].slice(0, MAX_FILTER_PACKS) : [],
    license: (MEDIA_LICENSE_FILTERS as readonly unknown[]).includes(f.license) ? (f.license as MediaLicenseFilter) : 'any',
  }
}

export const isPinnedPacks = isPackList

/** The badge on the Filter button: how many of the four filters are not "Any". */
export function activeFilterCount(f: MediaFilters): number {
  return (f.colors !== 'any' ? 1 : 0) + (f.style !== 'any' ? 1 : 0) + (f.packs.length > 0 ? 1 : 0) + (f.license !== 'any' ? 1 : 0)
}

/** One text for one set of filters, for a cache key: the default is `''`, so old keys and unfiltered keys agree. */
export function filtersKey(f: MediaFilters | undefined): string {
  if (f === undefined || activeFilterCount(f) === 0) return ''
  return `${f.colors}|${f.style}|${f.license}|${[...f.packs].sort().join(',')}`
}

// ---------- The packs ----------

/** What the app knows about one pack: from Iconify's `/collections`, or from the pack's own `info` when it is on the Mac. */
export interface IconPackInfo {
  prefix: string
  name: string
  /** How many icons the pack has. */
  total: number
  license: { title: string; spdx?: string; url?: string }
  /** Iconify's category (`UI 24px`, `Emoji`, `Logos` …), when it names one. */
  category?: string
  /** True: the icons have their own colors (many-color). False: one color (`currentColor`). */
  palette: boolean
}

/** A non-commercial license: Business-safe hides its pack (extra 16). */
export const isNonCommercial = (license: { spdx?: string; title?: string }): boolean => /(^|-)NC(-|$)/i.test(license.spdx ?? '') || /\bNC\b|non[- ]?commercial/i.test(license.title ?? '')

/** A license that asks for a credit when the work is published (CC-BY and CC-BY-SA, about 15% of icons): the reminder on an add. */
export const needsCredit = (licenseName: string | undefined): boolean => /\bCC[ -]?BY\b/i.test(licenseName ?? '')

/**
 * Where the packs are, and what the download is doing (`media.packs`, `media:packs-progress`).
 * - `none`: no pack on the Mac. `partial`: some packs (a stopped download). `complete`: every pack of `version`.
 * - `downloading` / `checking` / `removing` / `moving`: a run is going on; the counts move with it.
 */
export type IconPacksState = 'none' | 'partial' | 'complete' | 'downloading' | 'checking' | 'removing' | 'moving'

export interface IconPacksStatus {
  state: IconPacksState
  /** The folder the packs are in now (resolved: the default is `<userData>/icon-packs`). */
  folder: string
  /** The `@iconify/json` version tag of the packs (`2.2.553`); null before the first download. */
  version: string | null
  /** Packs on the Mac, and packs in the plan (an estimate before the first download). */
  packs: number
  total: number
  /** Bytes on the Mac (compressed), and the expected bytes when every pack is there (an estimate until then). */
  bytes: number
  totalBytes: number
  /** When "Check for new icons" last ran to its end; null = never. */
  checkedAt: number | null
  /** One sentence about the last run: done, stopped, GitHub's limit, a failure. Null = nothing to say. */
  message: string | null
  /** The message is a failure (shown as an error). */
  failed: boolean
}

/** `media.packs`: each verb answers the status after it; `download` and `check` resolve when their run ends. */
export type IconPacksRequest = { op: 'status' } | { op: 'download' } | { op: 'stop' } | { op: 'check' } | { op: 'remove' }

/** The confirm box's numbers before a plan exists (measured 2026-11-03: 281 packs, 135 MB with gzip (a real download of 2.2.553)). */
export const ESTIMATED_PACK_COUNT = 281
export const ESTIMATED_PACK_BYTES = 135 * 1024 * 1024

/** "17 MB": whole megabytes, one decimal under 10. */
export function formatPackBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? (Math.round(mb * 10) / 10).toString() : Math.round(mb).toString()} MB`
}

/** The progress line of a running download: "Downloading icon packs: 37 of 281 (17 MB of 130 MB)". */
export function packsProgressText(s: Pick<IconPacksStatus, 'state' | 'packs' | 'total' | 'bytes' | 'totalBytes'>): string {
  const counts = `${s.packs} of ${s.total} (${formatPackBytes(s.bytes)} of ${formatPackBytes(Math.max(s.bytes, s.totalBytes))})`
  if (s.state === 'checking') return `Checking for new icons: ${counts}`
  if (s.state === 'removing') return 'Removing icon packs…'
  if (s.state === 'moving') return 'Moving icon packs to the new folder…'
  return `Downloading icon packs: ${counts}`
}

/** A run is going on. */
export const packsBusy = (s: Pick<IconPacksStatus, 'state'>): boolean => s.state === 'downloading' || s.state === 'checking' || s.state === 'removing' || s.state === 'moving'
