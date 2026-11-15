/**
 * YAZ-5566: made-up pages for the page look's screen fixtures (`readerFixtures.tsx`):
 *  - `page-text-size`: the vault's Text size (19 px) and default line (30%, 2 px, dashed) from `text-formatting.json`, on
 *    a page with text, bullets, a rule and a card set to Same as pages (`TEXT_SIZE_FILES`).
 *  - `page-sections`: a page with Section indent on and Guide lines off in its frontmatter (`SECTIONS_PAGE`): headings
 *    three deep, bullets, a code block, a quote, a callout and a table inside the sections.
 */
export const TEXT_SIZE_PAGE = [
  '# Text size',
  'The vault sets its Text size to 19 px: this paragraph, the bullets and the card below read at it, and the headings scale with it.',
  '## Bullets',
  ['- A first bullet that wraps onto a second line on a phone', '    - A child bullet', '- A second bullet'].join('\n'),
  'Above the rule.',
  '---',
  'Below the rule: the vault\'s default line is 30% dark, 2 px and dashed.',
  '```card\nWhat is the Spanish for river?\n---\nEl río.\n```\n<!-- card: DEMO-61 -->',
].join('\n\n')

export const TEXT_SIZE_FILES: Record<string, string> = {
  'Text size.md': `---\ntitle: Text size\n---\n\n${TEXT_SIZE_PAGE}\n`,
  '.yaseendocs/text-formatting.json': JSON.stringify({ version: 2, text: { size: 19 }, line: { darkness: 30, thickness: 2, pattern: 'dashed' } }),
}

export const SECTIONS_PAGE = [
  '# Garden year',
  'The plan for the garden, season by season.',
  '## Spring',
  'Dig the beds and sow the first seeds.',
  ['- Beds', '    - Turn the soil', '        - Add compost', '- Seeds'].join('\n'),
  '### Tomatoes',
  'Sow indoors in March; plant out after the last frost.',
  '#### Varieties',
  'Three kinds this year.',
  '```txt\nRoma, Gardener\'s Delight, Black Krim\n```',
  '### Beans',
  '> A quote in the beans section: pick them young.',
  '> [!tip] Watering\n> Water at the roots, in the morning.',
  '## Summer',
  '| Week | Job |\n| --- | --- |\n| 1 | Mulch |\n| 2 | Tie in |',
  'Harvest every other day.',
].join('\n\n')

export const SECTIONS_FILES: Record<string, string> = {
  'Garden year.md': `---\ntitle: Garden year\nsection-indent: true\nguide-lines: false\n---\n\n${SECTIONS_PAGE}\n`,
}
