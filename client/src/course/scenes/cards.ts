/**
 * THE COURSE'S SAMPLE CARDS (YAZ-5121): made up, in the shape of Yaseen's real cards (a front of a sentence or two with
 * the key part hidden; a back in sections, `***` between two; links with a few words on why). The texts of the two
 * chapter 2 cards are the storyboard's, in `script.ts` (c2-04, c2-05, c2-22, c2-30, c2-31).
 *
 * The parts (`CardView`'s `lit`, `grow`) are the top-level blocks of the sides, in order, from 0; the comment on each
 * card lists them.
 */

/** Chapter 1: one idea, with part of it hidden. Parts: 0 the front. */
export const CANBERRA = {
  title: 'Australia',
  text: 'The capital of Australia is {{Canberra}}.\n---\nNot Sydney: Canberra was built as a new capital, between Sydney and Melbourne.',
}

/**
 * Chapter 2's first real card. Parts: 0 and 1 the front's two lines; 2 how it works; 3 EXAMPLE; 4 MEMORY HOOK;
 * 5 CONNECTIONS. Hidden words: 3.
 */
export const PROTEIN = {
  title: 'Protein, carbs and fat',
  text: [
    'The three things food is mostly made of are {{protein, carbs and fat}}.',
    '',
    'Your body builds and repairs with {{protein}}, and gets its quick energy from {{carbs}}.',
    '---',
    'Protein builds and repairs. Carbs are quick energy. Fat is slow energy, stored.',
    '',
    '***',
    '',
    '**EXAMPLE**',
    'An egg is mostly protein and fat. Bread is mostly carbs.',
    '',
    '***',
    '',
    '**MEMORY HOOK**',
    'Protein is the bricks. Carbs are the kindling. Fat is the logs.',
    '',
    '***',
    '',
    '**CONNECTIONS**',
    '[[Calories]] *each one holds a different amount of energy*',
  ].join('\n'),
  links: { Calories: 'Calories' } as Readonly<Record<string, string>>,
  hidden: 3,
}

/**
 * Chapter 2's word card. Parts: 0 and 1 the front's two lines; 2 the meaning; 3 PRONUNCIATION; 4 ORIGIN; 5 MEMORY HOOK;
 * 6 EXAMPLES. Hidden words: 2. (The voice says "where it comes from", so the back has an ORIGIN section.)
 */
export const CANDID = {
  title: 'candid',
  text: [
    'I asked for {{candid}} feedback, and she told me plainly what did not work.',
    '',
    'Honest and direct, even when it is hard to hear, is {{candid}}.',
    '---',
    'Candid means open and honest, with nothing held back.',
    '',
    '***',
    '',
    '**PRONUNCIATION**',
    'KAN-did',
    '',
    '***',
    '',
    '**ORIGIN**',
    'From Latin *candidus*, white: clean, with nothing to hide.',
    '',
    '***',
    '',
    '**MEMORY HOOK**',
    'A candid photo is one nobody posed for.',
    '',
    '***',
    '',
    '**EXAMPLES**',
    'To be candid, I am not sure it will work.',
    'He gave a candid answer about his mistake.',
  ].join('\n'),
  hidden: 2,
}

/** Many cards at once (chapter 1's "many cards", chapter 2's card base): one short title each. */
export const MANY_TITLES = ['Canberra', 'Ohm’s law', 'candid', 'Photosynthesis', 'Compound interest', 'Le passé composé', 'Mitochondria', 'The Krebs cycle', 'Opportunity cost', 'Big O', 'Sleep debt', 'Protein, carbs and fat']
