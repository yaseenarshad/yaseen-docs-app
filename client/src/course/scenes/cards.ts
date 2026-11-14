/**
 * THE COURSE'S SAMPLE CARDS (YAZ-5121): the one made-up world of every chapter, in the shape of Yaseen's real cards (a
 * front of a sentence or two with the key part hidden; a back in sections, `***` between two; links with a few words
 * on why). The texts of the two chapter 2 cards are the storyboard's, in `script.ts` (c2-04, c2-05, c2-22, c2-30,
 * c2-31). Each card has one title and one ID in every chapter; a card that the story changes (the umbrella card) keeps
 * its title, ID and front, and names each stage.
 *
 * The parts (`CardView`'s `lit`, `grow`) are the top-level blocks of the sides, in order, from 0; the comment on each
 * card lists them.
 */

/** The made-up IDs, in the app's shape (`shared/pageId.ts`: letters, a hyphen, a number). A link pill shows its target's. */
export const SAMPLE_IDS: Readonly<Record<string, string>> = {
  Australia: 'DEMO-2',
  'Protein, carbs and fat': 'DEMO-3',
  candid: 'DEMO-4',
  'Sleep debt adds up': 'DEMO-5',
  'The Moon’s orbit': 'DEMO-6',
  Protein: 'DEMO-7',
  Sleep: 'DEMO-8',
  Calories: 'DEMO-9',
  'How muscle grows': 'DEMO-12',
  'Sleep debt': 'DEMO-14',
  'Sleep trivia': 'DEMO-15',
  'White light': 'DEMO-16',
  'Muscle cramps': 'DEMO-19',
}

/** The ID of a sample card, by its title. */
export function sampleId(title: string): string {
  const id = SAMPLE_IDS[title]
  if (id === undefined) throw new Error(`No sample ID for "${title}"`)
  return id
}

/** Chapter 1: one idea, with part of it hidden. Parts: 0 the front. */
export const CANBERRA = {
  title: 'Australia',
  id: 'DEMO-2',
  text: 'The capital of Australia is {{Canberra}}.\n---\nNot Sydney: Canberra was built as a new capital, between Sydney and Melbourne.',
}

/**
 * Chapter 2's first real card. Parts: 0 and 1 the front's two lines; 2 how it works; 3 EXAMPLE; 4 MEMORY HOOK;
 * 5 CONNECTIONS. Hidden words: 3.
 */
const UMBRELLA_FRONT = 'The three things food is mostly made of are {{protein, carbs and fat}}.'

export const PROTEIN = {
  title: 'Protein, carbs and fat',
  id: 'DEMO-3',
  text: [
    UMBRELLA_FRONT,
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
  id: 'DEMO-4',
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

/**
 * The umbrella card ("Protein, carbs and fat") at each stage of the story; the same title, ID and front as `PROTEIN`.
 * - `light` (chapter 7): one front, three short lines on its back. Parts: 0 front; 1, 2, 3 the back's lines.
 * - `linked` (chapter 7): protein keeps one line, with a link to its branch. Parts: 0 front; 1 protein (the link); 2, 3.
 * - `grown` (chapter 11): its PROTEIN part keeps growing. Parts: 0 the front; 1 the overview; 2 PROTEIN; 3 CARBS.
 * - `short` (chapter 4): the front and the first line of `PROTEIN`'s back.
 */
export const UMBRELLA = {
  title: PROTEIN.title,
  id: PROTEIN.id,
  light: `${UMBRELLA_FRONT}\n---\nProtein builds and repairs.\n\nCarbs are quick energy.\n\nFat is slow energy, stored.`,
  linked: `${UMBRELLA_FRONT}\n---\nProtein builds and repairs: [[Protein]]\n\nCarbs are quick energy.\n\nFat is slow energy, stored.`,
  grown: [
    UMBRELLA_FRONT,
    '---',
    'Each gives energy, and each does a job of its own.',
    '',
    '***',
    '',
    '**PROTEIN**',
    'Builds and repairs. Eggs, beans, fish.',
    'The body stores little of it.',
    'Muscle is built from it.',
    'About a palm of it a meal.',
    '',
    '***',
    '',
    '**CARBS**',
    'Quick energy. Bread, rice, fruit.',
  ].join('\n'),
  short: `${UMBRELLA_FRONT}\n---\nProtein builds and repairs. Carbs are quick energy. Fat is slow energy, stored.`,
}

/** What chapter 7 learns about protein later: it piles up on the umbrella card's back, then becomes the branch. */
export const PROTEIN_LINES = ['Protein is made of amino acids.', 'The body cannot make 9 of the 20; food must give them.', 'Eggs, fish, beans and milk are rich in it.', 'A gram of it holds about 4 calories.']

const PROTEIN_UNTIL_LINKED = [
  'Your body builds and repairs itself with {{protein}}, made of {{amino acids}}.',
  '---',
  'The body cannot make 9 of the 20 amino acids, and it stores little protein, so food must give some each day.',
  '',
  '***',
  '',
  '**EXAMPLE**',
  'Eggs, fish, beans and milk are rich in protein.',
  '',
  '***',
  '',
  '**CONNECTIONS**',
  '[[Protein, carbs and fat]] *its umbrella*',
].join('\n')

/**
 * The branch card "Protein" (chapter 7 on). Parts: 0 the front; 1 the back's first line; 2 EXAMPLE; 3 CONNECTIONS.
 * `early`: before chapter 10 links it to "How muscle grows".
 */
export const PROTEIN_BRANCH = {
  title: 'Protein',
  id: 'DEMO-7',
  early: PROTEIN_UNTIL_LINKED,
  text: `${PROTEIN_UNTIL_LINKED}\n[[How muscle grows]] *muscle is built from protein*`,
  links: { 'Protein, carbs and fat': 'Protein, carbs and fat', 'How muscle grows': 'How muscle grows', Protein: 'Protein' } as Readonly<Record<string, string>>,
}

/** The card "How muscle grows" (another tree: Exercise). */
export const MUSCLE = {
  title: 'How muscle grows',
  id: 'DEMO-12',
  text: ['Muscle grows when hard work {{strains its fibres}}, and the body repairs them thicker.', '---', 'The repair happens during rest, not during the workout. It uses protein as its building blocks.'].join('\n'),
}

/** The card that chapter 2's walk-through makes in the app, in its parts (the walk types them one by one). */
export const WALK = {
  title: 'Sleep debt',
  renamed: 'Sleep debt adds up',
  front: 'Each hour of sleep you miss adds to your',
  word: 'sleep debt',
  back: 'It builds up: one short hour a night for a week is seven hours.',
  section: 'Five short nights, then a lazy Saturday: still behind.',
}

/** The walk-through's card, as it is reviewed in chapters 9 and 11. Parts: 0 the front; 1 the back; 2 EXAMPLE. */
export const SLEEP_DEBT = {
  title: WALK.renamed,
  id: 'DEMO-5',
  text: `${WALK.front} {{${WALK.word}}}.\n---\n${WALK.back}\n\n***\n\n**EXAMPLE**\n${WALK.section}`,
}

/** A card that asks too much at once (chapter 11): four hidden words in one line, and a vague title. */
export const TOO_MUCH = {
  title: 'Sleep',
  id: 'DEMO-8',
  text: '{{Sleep debt}} builds when {{nights are short}}, and {{one long lie-in}} does not {{pay it back}}.\n---\nShort nights add up. A lazy Saturday helps a little, but you are still behind.',
}

/** Chapter 3: the Inbox's card for the walk-through: two hidden words, then a back. Made up, and true. */
export const MOON = {
  title: 'The Moon’s orbit',
  id: 'DEMO-6',
  text: [
    'The Moon goes once around the Earth in about {{27 days}}.',
    '',
    'From one full moon to the next takes about {{29.5 days}}.',
    '---',
    'The two differ because the Earth moves around the Sun too: the Moon needs about two more days to line up with the Sun again.',
  ].join('\n'),
}
