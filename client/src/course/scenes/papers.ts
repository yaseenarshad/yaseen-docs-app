/**
 * THE PAPERS THE COURSE PULLS UP (YAZ-5121): each research moment's page, as text. The kit's `Paper` sets it as a
 * page-like card: the journal's name, the title, the authors' last names and the year, and ONE short line that the
 * highlighter sweeps over. Nothing else of a paper is shown: no image of a page, no figure, no logo, no layout.
 *
 * THE COPYRIGHT RULE (a test holds it, `papers.test.ts`): `line` is either a paraphrase (`quote: false`) or a quote of
 * fewer than 15 words (`quote: true`), and only a quote is drawn in quotation marks. Each paper's facts come from the
 * "SOURCE:" comment in `script.ts` (the coordinator checked each number in the paper before it was spoken).
 */

export interface PaperCite {
  id: string
  /** The journal, or the place the work was published. */
  journal: string
  title: string
  /** Last names only. */
  authors: readonly string[]
  year: number
  /** The one highlighted line. */
  line: string
  /** `line` is the paper's own words (under 15 words), not a paraphrase. */
  quote: boolean
  /** Where the facts are from (for the next builder; not shown). */
  source: string
}

export const PAPERS = {
  ebbinghaus: {
    id: 'ebbinghaus',
    journal: 'Memory: A Contribution to Experimental Psychology',
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
  karpicke2008: {
    id: 'karpicke2008',
    journal: 'Science',
    title: 'The Critical Importance of Retrieval for Learning',
    authors: ['Karpicke', 'Roediger'],
    year: 2008,
    line: 'Once a word was learned, more testing helped a week later. More studying did not.',
    quote: false,
    source: 'script.ts c3-06, c3-07, c3-23: Karpicke & Roediger 2008, Science 319(5865):966-968, 15 February 2008; Fig. 2 (80% against 36%) and Table 1 (236.8 against 243.0 trials).',
  },
} as const satisfies Record<string, PaperCite>

export type PaperId = keyof typeof PAPERS

/** The authors as a byline: "Murre & Dros", "Cepeda, Pashler, Vul et al." */
export function byline(authors: readonly string[]): string {
  if (authors.length <= 2) return authors.join(' & ')
  if (authors.length === 3) return `${authors[0]}, ${authors[1]} & ${authors[2]}`
  return `${authors.slice(0, 3).join(', ')} et al.`
}

/** The words of a line, as the copyright test counts them. */
export const lineWords = (line: string): number => line.split(/\s+/).filter((w) => w !== '').length
