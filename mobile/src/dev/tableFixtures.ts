/**
 * YAZ-5471: made-up tables in the shapes of a real vault's tables (counted, never copied: 187 tables in 69 notes; 2 to
 * 8 columns, most 2 or 3; a median of 6 rows, up to 169; a cell up to 1,500 characters; one cell in six empty; links,
 * code, check marks, emoji and numbers in cells). Each table here is one of those shapes. For the screen fixtures
 * (`readerFixtures.tsx`: `page-tables`, `page-table-full`) and the tests (`page/tables.test.ts`).
 */

/** 3 short columns: a word, a number, a check mark. Fits the screen, nothing wraps. */
export const NARROW = ['| Fruit | Count | Ripe |', '| --- | --- | --- |', '| Pear | 12 | ✅ |', '| Plum | 7 | ❌ |', '| Fig | 140 | ✅ |', '| Lime | 3 |  |'].join('\n')

/** 2 columns: a short name, then long text (a paragraph a row). */
export const TWO_LONG = [
  '| Habit | How it works |',
  '| --- | --- |',
  '| Morning walk | Leave the phone at home, walk the same loop around the park for twenty minutes, and note one thing that looked different from yesterday when you are back at the door. |',
  '| Weekly review | Every Sunday evening, read the week\'s notes from top to bottom, move what is still open to the next week, and cross out anything that no longer matters, without guilt about it. |',
  '| Reading hour | One chapter before bed, on paper, with a pencil for the margins; the questions go on the last page of the book so they are easy to find later. |',
  '| Tea break | Kettle on at three. |',
].join('\n')

/** 6 columns: a day, a city, a stay, a cost, notes and a link; some cells empty, an emoji, a long note. */
export const SIX_WIDE = [
  '| Day | City | Where we stay | Cost | Notes | Link |',
  '| --- | --- | --- | --- | --- | --- |',
  '| Mon 2 Mar | Lisbon 🇵🇹 | Small guest house near the river | €84 | Arrive by the morning train; the room is ready from two in the afternoon, so leave the bags at the desk first. | [[Trip plan]] |',
  '| Tue 3 Mar | Lisbon | Small guest house near the river | €84 | Tram to the old castle, then lunch on the hill. | |',
  '| Wed 4 Mar | Porto | Flat with a view of the bridges | €112 |  | https://example.com/porto-flat |',
  '| Thu 5 Mar | Porto | Flat with a view of the bridges | €112 | Boat on the river if the weather holds; otherwise the tiled station and the market. | |',
  '| Fri 6 Mar | Coimbra |  |  | Day trip only. | |',
].join('\n')

/** Numbers: right aligned in even digits; a total row; Markdown's own alignment on one column. */
export const NUMBERS = [
  '| Month | Visitors | Change | Share | Notes |',
  '| --- | --- | --- | --- | :-: |',
  '| January | 1,204 | +4.2% | 18% | quiet |',
  '| February | 986 | −18.1% | 15% | |',
  '| March | 2,310 | +134.3% | 35% | spring |',
  '| April | 2,077 | −10.1% | 32% | |',
  '| Total | 6,577 | | 100% | |',
].join('\n')

/** Links and code in cells, a check box list in a cell, a long address with no spaces. */
export const CODE_LINKS = [
  '| Command | What it does | Where to read more |',
  '| --- | --- | --- |',
  '| `npm run build` | Builds the site into the `dist` folder, ready to copy to the server. | [[Trip plan]] |',
  '| `git log --oneline --graph` | Shows the history as one short line a change, with the branches drawn at the left. | https://example.com/docs/a/very/long/path/to/the/history/page/with-no-spaces-at-all |',
  '| `ls -la` | Lists every file here, the hidden ones too. | [The manual](https://example.com/manual) |',
].join('\n')

/** 8 columns, a long first column, many empty cells. */
export const EIGHT_SPARSE = [
  '| Task in the garden | Mon | Tue | Wed | Thu | Fri | Sat | Sun |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| Water the tomatoes along the south fence | ✓ |  | ✓ |  | ✓ |  | ✓ |',
  '| Weed the bed by the shed |  | ✓ |  |  |  | ✓ |  |',
  '| Turn the compost |  |  |  | ✓ |  |  |  |',
  '| Pick beans |  |  |  |  | ✓ | ✓ | ✓ |',
].join('\n')

/** A page with every shape, as a note holds them: a heading and a line before each. */
export const TABLE_PAGE = [
  '# Table shapes',
  'Short columns that fit the screen:',
  NARROW,
  'Two columns, the second long:',
  TWO_LONG,
  '## A wide table',
  'Six columns, wider than the phone:',
  SIX_WIDE,
  'Numbers:',
  NUMBERS,
  'Code and links:',
  CODE_LINKS,
  'Eight columns, mostly empty:',
  EIGHT_SPARSE,
  'The end of the tables.',
].join('\n\n')

/**
 * YAZ-5480: a tall table whose file freezes its first two rows and its first column, as the Mac writes it: the table
 * comment after the table, a blank line between. 7 columns, 46 rows of made-up readings: taller than a phone, also full screen.
 */
export const FROZEN = [
  '| Station | Region | Mon | Tue | Wed | Thu | Notes |',
  '| --- | --- | --: | --: | --: | --: | --- |',
  '| (units) | | mm | mm | mm | mm | |',
  ...Array.from({ length: 44 }, (_, i) => {
    const name = ['North Ridge', 'Lake Shore', 'Old Mill', 'Pine Hollow', 'Stone Bridge', 'Harbor Point', 'Willow Bend', 'Cedar Flats', 'Fox Hill', 'Mossy Glen', 'Iron Gate'][i % 11]
    const n = (k: number) => ((i * 7 + k * 13) % 41) + 2
    return `| ${name} ${Math.floor(i / 11) + 1} | ${['East', 'West', 'Coast', 'Hills'][i % 4]} | ${n(1)} | ${n(2)} | ${n(3)} | ${n(4)} | ${i % 3 === 0 ? 'Gauge cleaned in the morning; reading taken after the shower passed.' : i % 3 === 1 ? 'Dry.' : ''} |`
  }),
].join('\n')

/** The comment the Mac writes after `FROZEN`. */
export const FROZEN_COMMENT = '<!-- table: freeze 2 rows 1 col -->'

/** A page with the frozen table, a line before and text after it, so the page scrolls past its end. */
export const FROZEN_PAGE = ['# Frozen table', 'Rain gauges, two header rows and the station column frozen on the Mac:', FROZEN, FROZEN_COMMENT, 'After the table.', ...Array.from({ length: 12 }, (_, i) => `Line ${i + 1} after the table, so the page goes on.`)].join('\n\n')
