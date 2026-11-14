/**
 * THE PAPERS AND THE QUOTE OF CHAPTERS 6 TO 8 (YAZ-5121), in the shape of `papers.ts` (the kit's `PaperCite`), kept in
 * their own file so three builders do not edit one list. The same copyright rule holds (`chapters6to8.test.tsx`):
 * `line` is a paraphrase, or a quote of fewer than 15 words; only a quote is drawn in quotation marks. Each fact comes
 * from the "SOURCE:" comment in `script.ts`.
 */
import type { PaperCite } from './papers'

export const PAPERS_6_TO_8 = {
  craikLockhart: {
    id: 'craikLockhart',
    journal: 'Journal of Verbal Learning and Verbal Behavior',
    title: 'Levels of Processing: A Framework for Memory Research',
    authors: ['Craik', 'Lockhart'],
    year: 1972,
    line: 'The deeper you process something, for its meaning, the longer the memory of it lasts.',
    quote: false,
    source: 'script.ts c6-08: Craik & Lockhart 1972, Journal of Verbal Learning and Verbal Behavior 11(6).',
  },
  dunlosky: {
    id: 'dunlosky',
    journal: 'Psychological Science in the Public Interest',
    title: 'Improving Students’ Learning With Effective Learning Techniques',
    authors: ['Dunlosky', 'Rawson', 'Marsh', 'Nathan', 'Willingham'],
    year: 2013,
    line: 'Ten techniques rated: only practice testing and distributed practice earned high utility.',
    quote: false,
    source: 'script.ts c7-11, c7-29: Dunlosky et al. 2013, PSPI 14(1): ten techniques; rereading and highlighting low utility; practice testing and distributed practice high utility.',
  },
} as const satisfies Record<string, PaperCite>

/** A spoken quote (not a paper): who said it, the words, where. The same rule: under 15 words. */
export interface SpokenQuote {
  id: string
  by: string
  where: string
  line: string
  quote: true
  source: string
}

export const QUOTES_6_TO_8 = {
  holiday: {
    id: 'holiday',
    by: 'Ryan Holiday',
    where: 'on writing by hand',
    line: 'The inefficiency is the efficiency.',
    quote: true,
    source: 'script.ts c8-09: Ryan Holiday, YouTube video UBdlprawTkA.',
  },
} as const satisfies Record<string, SpokenQuote>

/**
 * The ten ways to learn that the 2013 review graded, in its own order, in plain words, with its grade (its words: high,
 * moderate, low utility). `key` marks the rows the voice names.
 */
export const TEN_WAYS: readonly { label: string; grade: 'High' | 'Moderate' | 'Low'; key?: 'reread' | 'highlight' | 'test' | 'space' }[] = [
  { label: 'Asking yourself why', grade: 'Moderate' },
  { label: 'Explaining it to yourself', grade: 'Moderate' },
  { label: 'Summarising', grade: 'Low' },
  { label: 'Highlighting', grade: 'Low', key: 'highlight' },
  { label: 'Memory keywords', grade: 'Low' },
  { label: 'Picturing the text', grade: 'Low' },
  { label: 'Re-reading', grade: 'Low', key: 'reread' },
  { label: 'Testing yourself', grade: 'High', key: 'test' },
  { label: 'Spacing it out', grade: 'High', key: 'space' },
  { label: 'Mixing topics', grade: 'Moderate' },
]
