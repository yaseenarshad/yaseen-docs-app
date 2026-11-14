/**
 * THE PAPERS THE COURSE PULLS UP (YAZ-5121), all twelve chapters: each research moment's page, as text. The kit's `Paper` sets it as a
 * page-like card: the journal's name, the title, the authors' last names and the year, and ONE short line that the
 * highlighter sweeps over. Nothing else of a paper is shown: no image of a page, no figure, no logo, no layout.
 *
 * THE COPYRIGHT RULE (a test holds it, `scenes.test.tsx`): `line` is either a paraphrase (`quote: false`) or a quote of
 * fewer than 15 words (`quote: true`), and only a quote is drawn in quotation marks. Each paper's facts come from the
 * "SOURCE:" comment in `script.ts` (the coordinator checked each number in the paper before it was spoken).
 */

export interface PaperCite {
  id: string
  /** The journal, or for a book its publisher. */
  journal: string
  title: string
  /** Last names only. */
  authors: readonly string[]
  year: number
  /** The one highlighted line. */
  line: string
  /** `line` is the paper's own words (under 15 words), not a paraphrase. */
  quote: boolean
  /** Where the facts are from (not shown). */
  source: string
}

const KARPICKE_2008 = {
  id: 'karpicke2008',
  journal: 'Science',
  title: 'The Critical Importance of Retrieval for Learning',
  authors: ['Karpicke', 'Roediger'],
  year: 2008,
  line: 'Once a word was learned, more testing helped a week later. More studying did not.',
  quote: false,
  source: 'script.ts c3-06, c3-07, c3-23: Karpicke & Roediger 2008, Science 319(5865):966-968, 15 February 2008; Fig. 2 (80% against 36%) and Table 1 (236.8 against 243.0 trials).',
} as const satisfies PaperCite

export const PAPERS = {
  ebbinghaus: {
    id: 'ebbinghaus',
    journal: 'Duncker & Humblot, Leipzig',
    title: 'Über das Gedächtnis',
    authors: ['Ebbinghaus'],
    year: 1885,
    line: 'A day after learning a list, relearning it took about two thirds of the first effort.',
    quote: false,
    source: 'script.ts c1-02: Ebbinghaus 1885; savings as given in Murre & Dros 2015, PLOS ONE, Table 3.',
  },
  murreDros: {
    id: 'murreDros',
    journal: 'PLOS ONE',
    title: "Replication and Analysis of Ebbinghaus' Forgetting Curve",
    authors: ['Murre', 'Dros'],
    year: 2015,
    line: 'We conclude that the Ebbinghaus forgetting curve has indeed been replicated.',
    quote: true,
    source: 'script.ts c1-22: Murre & Dros 2015, PLOS ONE 10(7).',
  },
  naqib: {
    id: 'naqib',
    journal: 'Neural Plasticity',
    title: 'Molecular Determinants of the Spacing Effect',
    authors: ['Naqib', 'Sossin', 'Farah'],
    year: 2012,
    line: 'Spaced training turns on the genes that long-term memory needs, in snails, flies and rodents.',
    quote: false,
    source: 'script.ts c1-18: CREB-dependent gene expression after spaced training, in Aplysia, Drosophila and rodents.',
  },
  cepeda2006: {
    id: 'cepeda2006',
    journal: 'Psychological Bulletin',
    title: 'Distributed Practice in Verbal Recall Tasks',
    authors: ['Cepeda', 'Pashler', 'Vul', 'Wixted', 'Rohrer'],
    year: 2006,
    line: '317 experiments in 184 articles: spaced practice beat practice done all at once.',
    quote: false,
    source: 'script.ts c1-06: Cepeda et al. 2006, Psychological Bulletin: 317 experiments in 184 articles.',
  },
  cepeda2008: {
    id: 'cepeda2008',
    journal: 'Psychological Science',
    title: 'Spacing Effects in Learning: A Temporal Ridgeline of Optimal Retention',
    authors: ['Cepeda', 'Vul', 'Rohrer', 'Wixted', 'Pashler'],
    year: 2008,
    line: 'More than 1,350 people: the best gap depends on how long the memory must last.',
    quote: false,
    source: 'script.ts c1-20: Cepeda et al. 2008, Psychological Science 19(11).',
  },
  wozniak: {
    id: 'wozniak',
    journal: 'SuperMemo',
    title: 'Effective Learning: Twenty Rules of Formulating Knowledge',
    authors: ['Wozniak'],
    year: 1999,
    line: 'Rule 4, the minimum information principle: keep what you learn as simple as you can.',
    quote: false,
    source: 'script.ts c2-24: Wozniak 1999, rule 4, supermemo.com.',
  },
  karpicke2008: KARPICKE_2008,
  // Chapters 6 to 8
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
  // Chapters 9 and 10
  kornell: {
    id: 'kornell',
    journal: 'Applied Cognitive Psychology',
    // The main title only: the course does not use the subtitle's word for last-minute study (Yaseen, YAZ-5060).
    title: 'Optimising Learning Using Flashcards',
    authors: ['Kornell'],
    year: 2009,
    line: 'Spacing worked better for 90% of the people, yet 72% believed the opposite.',
    quote: false,
    source: 'script.ts c9-05: Kornell 2009, Applied Cognitive Psychology 23.',
  },
  // The same paper as chapter 3's, with another line: the guesses (chapter 9).
  karpickeGuesses: {
    ...KARPICKE_2008,
    id: 'karpickeGuesses',
    line: 'In all four groups, people predicted they would recall about half of the pairs.',
    source: 'script.ts c9-11: Karpicke & Roediger 2008, Science 319: predicted about 50%; actual about 80% or about a third.',
  },
  collinsLoftus: {
    id: 'collinsLoftus',
    journal: 'Psychological Review',
    title: 'A Spreading-Activation Theory of Semantic Processing',
    authors: ['Collins', 'Loftus'],
    year: 1975,
    line: 'Memory is a network of linked ideas: activation spreads from one to the ones linked to it.',
    quote: false,
    source: 'script.ts c10-07: Collins & Loftus 1975, Psychological Review 82(6).',
  },
  vanKesteren: {
    id: 'vanKesteren',
    journal: 'Trends in Neurosciences',
    title: 'How Schema and Novelty Augment Memory Formation',
    authors: ['van Kesteren', 'Ruiter', 'Fernández', 'Henson'],
    year: 2012,
    line: 'New facts that fit what you already know are often remembered better.',
    quote: false,
    source: 'script.ts c10-08: van Kesteren et al. 2012, Trends in Neurosciences 35(4); Brod et al. 2013.',
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

export const QUOTES = {
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

/** The authors as a byline: "Murre & Dros", "Cepeda, Pashler, Vul et al." */
export function byline(authors: readonly string[]): string {
  if (authors.length <= 2) return authors.join(' & ')
  if (authors.length === 3) return `${authors[0]}, ${authors[1]} & ${authors[2]}`
  return `${authors.slice(0, 3).join(', ')} et al.`
}

/** The words of a line, as the copyright test counts them. */
export const lineWords = (line: string): number => line.split(/\s+/).filter((w) => w !== '').length
