/**
 * THE PAPERS OF CHAPTERS 9 AND 10 (YAZ-5121), in the shape of `papers.ts` and under its copyright rule: `line` is a
 * paraphrase (`quote: false`, one short line) or a quote of fewer than 15 words. A test holds it (`later.test.tsx`).
 * They live in their own file so the builders of chapters 3 to 8 can add theirs to `papers.ts` with no clash. The
 * facts come from the "SOURCE:" comments in `script.ts`.
 */
import type { PaperCite } from './papers'

export const LATER_PAPERS = {
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
  karpicke: {
    id: 'karpicke',
    journal: 'Science',
    title: 'The Critical Importance of Retrieval for Learning',
    authors: ['Karpicke', 'Roediger'],
    year: 2008,
    line: 'In all four groups, people predicted they would recall about half of the pairs.',
    quote: false,
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
