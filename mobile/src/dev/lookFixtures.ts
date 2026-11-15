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

/**
 * YAZ-5567: the table look's screen fixtures:
 *  - `page-table-subheads`: a long table with three subheader rows (`subhead 2 7 12`, the Mac's comment), stripes that
 *    start again in each section, and bullets in cells (the Mac's cell list HTML), in a vault with no table-look.json:
 *    the Mac's defaults (grey, medium, bold, sticky; 20 px indent, 4 px gap). `@scrolled` shows a subheader row stuck
 *    under the header row.
 *  - `page-table-centre`: a narrow table in a vault whose table-look.json says Table position Centre.
 */
const SUBHEAD_ROWS = [
  '| Day | Plan |',
  '| --- | --- |',
  '| Arrive | Train from the airport |',
  '| **Week one** | |',
  '| Mon | <ul><li>Walk the old town</li><li>Market<ul><li>Bread</li><li>Cheese</li></ul></li></ul> |',
  '| Tue | Museum in the morning, a long lunch, then the river walk at sunset. |',
  '| Wed | <ul><li>[ ] Book the boat</li><li>[x] Buy the tickets</li></ul> |',
  '| Thu | Rest day |',
  '| **Week two** | |',
  '| Mon | <ol><li>Pack</li><li>Check out</li></ol> |',
  '| Tue | Coast by bus |',
  '| Wed | Beach |',
  '| Thu | Hike to the lighthouse |',
  '| **Going home** | |',
  '| Fri | <ul><li>Taxi at 6</li><li>Flight at 9</li></ul> |',
  '| Sat | Unpack |',
].join('\n')

export const SUBHEADS_FILES: Record<string, string> = {
  'Trip table.md': `---\ntitle: Trip table\n---\n\n# Trip table\n\nThe trip, week by week.\n\n${SUBHEAD_ROWS}\n\n<!-- table: stripes, subhead 3 8 13 -->\n\nAfter the table.\n\n${Array.from({ length: 12 }, (_, i) => `A line of made-up notes ${i + 1}.`).join('\n\n')}\n`,
}

export const CENTRE_FILES: Record<string, string> = {
  'Centred table.md': `---\ntitle: Centred table\n---\n\n# Centred table\n\nThe vault puts its tables in the middle of the column.\n\n| Fruit | Count |\n| --- | --- |\n| Pear | 12 |\n| Fig | 140 |\n\nA wide table still fills the column:\n\n| Day | City | Where we stay | Notes |\n| --- | --- | --- | --- |\n| Mon | Lisbon | Small guest house near the river | Arrive by the morning train. |\n`,
  '.yaseendocs/table-look.json': JSON.stringify({ version: 1, look: { position: 'center' } }),
}
