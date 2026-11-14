/**
 * THE SAMPLE CARDS OF CHAPTERS 9 TO 12 (YAZ-5121): made up, in the shape of Yaseen's cards (a front of a sentence with
 * the key part hidden; a back in sections; links with a few words on why). They carry on chapter 2's example
 * ("Protein, carbs and fat") and chapter 7's tree: the branch "Protein" and, in another tree, "How muscle grows".
 * The IDs are made up (`DEMO-…`).
 */

/** The branch card "Protein". Parts: 0 the front; 1 the back's first line; 2 EXAMPLE; 3 CONNECTIONS (two links). */
export const PROTEIN_BRANCH = {
  title: 'Protein',
  id: 'DEMO-7',
  text: [
    'Your body builds and repairs itself with {{protein}}.',
    '---',
    'Muscle, skin and the enzymes in each cell are made of protein. The body stores little, so it needs some each day.',
    '',
    '***',
    '',
    '**EXAMPLE**',
    'Eggs, beans, fish and yoghurt.',
    '',
    '***',
    '',
    '**CONNECTIONS**',
    '[[Protein, carbs and fat]] *its umbrella*',
    '[[How muscle grows]] *muscle is built from protein*',
  ].join('\n'),
  links: { 'Protein, carbs and fat': 'Protein, carbs and fat', 'How muscle grows': 'How muscle grows' } as Readonly<Record<string, string>>,
}

/** The card "How muscle grows" (another tree: Exercise). */
export const MUSCLE = {
  title: 'How muscle grows',
  id: 'DEMO-12',
  text: ['Muscle grows when hard work {{strains its fibres}}, and the body repairs them thicker.', '---', 'The repair happens during rest, not during the workout. It uses protein as its building blocks.'].join('\n'),
}

/** The card from chapter 2's walk-through, as it is reviewed in chapters 9 and 11. */
export const SLEEP_DEBT = {
  title: 'Sleep debt adds up',
  id: 'P2X9',
  text: 'Each hour of sleep you miss adds to your {{sleep debt}}.\n---\nIt builds up: one short hour a night for a week is seven hours.',
}

/** A card that asks too much at once (chapter 11): four blanks in one line, and a vague title. */
export const TOO_MUCH = {
  title: 'Sleep',
  id: 'K4M8',
  text: '{{Sleep debt}} builds when {{nights are short}}, and {{one long lie-in}} does not {{pay it back}}.\n---\nShort nights add up. A lazy Saturday helps a little, but you are still behind.',
}
