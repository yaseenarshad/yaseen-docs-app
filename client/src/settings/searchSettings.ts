/**
 * Settings search (YAZ-1679 D6): every available setting becomes ONE candidate whose searchable
 * text is its label, hint, keywords, group title, group hint and section title run together, and the match
 * is the `[[` picker's own (`matchLinkCandidates`: exact, then prefix, then substring,
 * case-folded) — one ranking rule in the app, not two. The candidates are built once per dialog
 * open; the query runs over them on every keystroke.
 *
 * WORD MATCH (YAZ-3397 D5), only when those three tiers find nothing: the rows where every WORD of the
 * query starts a word of the row ("file window" → New Files window, which no substring of it finds);
 * failing that, the same with one slip forgiven in a word of four letters or more ("file winodw").
 * A query that already finds rows keeps exactly those, so the tiers above never get noisier.
 */
import { matchLinkCandidates } from '../links/completion'
import { availableSections, resolveHint, type SettingDef, type SettingsCtx, type SettingsGroup, type SettingsSection } from './registry'

export interface SettingHit {
  section: SettingsSection
  group: SettingsGroup
  item: SettingDef
  /** The searchable text; `lower` is its case-folded twin, precomputed for the matcher. */
  name: string
  lower: string
}

export function settingCandidates(ctx: SettingsCtx): SettingHit[] {
  return availableSections(ctx).flatMap((section) =>
    section.groups.flatMap((group) =>
      group.items.map((item) => {
        const name = [item.label, resolveHint(item, ctx), ...(item.keywords ?? []), group.title, group.hint, section.title].filter((part) => part !== undefined).join(' ')
        return { section, group, item, name, lower: name.toLowerCase() }
      }),
    ),
  )
}

/** Every hit for `query`, best first; the cap is the whole list — a settings search never truncates. */
export function searchSettings(candidates: readonly SettingHit[], query: string): SettingHit[] {
  const direct = matchLinkCandidates(candidates, query, candidates.length)
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== '')
  if (direct.length > 0 || words.length === 0) return direct
  const byWords = (match: (q: string, w: string) => boolean) =>
    candidates.filter((c) => {
      const own = c.lower.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '')
      return words.every((q) => own.some((w) => match(q, w)))
    })
  const starts = byWords((q, w) => w.startsWith(q))
  return starts.length > 0 ? starts : byWords(wordMatches)
}

/** `q` starts `word`, or does with one slip (a wrong, missing, extra or swapped letter) once `q` has four letters. */
export function wordMatches(q: string, word: string): boolean {
  if (word.startsWith(q)) return true
  if (q.length < 4) return false
  // Against the word's start at q's length and one either side, so a missing or extra letter lines up too.
  for (let n = q.length - 1; n <= q.length + 1; n++) if (n <= word.length && slips(q, word.slice(0, n)) <= 1) return true
  return false
}

/** Optimal string alignment distance: edits, with a swap of two letters side by side as one. */
function slips(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}
