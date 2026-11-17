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

/**
 * YAZ-5482: a table whose comment sets every part of the look the phone shows: the Mac's column widths, cell fills (a
 * name and a custom colour), text colours (a name and a custom dark ink, which the phone makes readable in dark mode),
 * a cell's own alignment, the table's and a cell's vertical alignment, two merged cells (the file keeps the full grid:
 * the covered cells are empty), its own border, a plain header row, stripes and compact rows. Made-up data.
 */
export const LOOK = [
  '| Area | Owner | Budget | Spent | Status |',
  '| --- | --- | --: | --: | --- |',
  '| Garden | Sam | 1,200 | 950 | On track, the beds are dug and the seeds are in |',
  '|  | Ana | 300 | 410 | Over: the fence posts cost more than we thought |',
  '| Kitchen | Lee | 4,800 | 2,100 | Waiting for the counter top |',
  '| Shed | Pat |  | 120 | Paint only |',
  '| Total | 6,300 |  | 3,580 | |',
].join('\n')

/** The comment the Mac would write after `LOOK` (its parts in the Mac's fixed order). */
export const LOOK_COMMENT = '<!-- table: widths 160 110 90 90 240, fill A1:E1 blue B3 #ff8800 E3 green E4 red, color D4 red E5 #1a1a40 B6 purple, align A6 center B6 right, valign middle E2 top, merge A2:A3 B6:C6, border 2px 40%, header plain, stripes, height compact -->'

/** A table with a coloured header row of its own (red, strong, regular weight, white text, centred) and its cells clipped, but one column wrapping. */
export const LOOK_CLIP = [
  '| Book | Shelf | Notes |',
  '| --- | --- | --- |',
  '| The long walk home through the hills and the quiet valleys beyond them | B2 | A slow start, then very hard to put down for the last hundred pages. |',
  '| Rivers and roads | C1 | Maps in the back. |',
  '| Small kitchen, big meals | A4 | The bread chapter is the reason to own it. |',
].join('\n')
export const LOOK_CLIP_COMMENT = '<!-- table: header red strong regular text-white align-center, nowrap, text 3:wrap -->'

/** A page with both, a line before each. */
export const LOOK_PAGE = ['# Table look', 'The house projects, as the Mac shows them:', LOOK, LOOK_COMMENT, 'Books, clipped on the Mac:', LOOK_CLIP, LOOK_CLIP_COMMENT, 'The end of the tables.'].join('\n\n')

/**
 * YAZ-5493: a made-up day plan as a calendar table, as the Mac writes it ("/Calendar table": `Time | Plan 1`, a row each
 * 30 minutes, `calendar 30m`, compact rows, the header row and column A frozen), with a to-do row above the times that
 * the file keeps out of the dimming (`nodim 2`). The fixture's clock is frozen at `CALENDAR_NOW`.
 */
export const CALENDAR = [
  '| Time | Plan | Where |',
  '| --- | --- | --- |',
  '| To-do | Call the plumber, buy stamps | |',
  ...[
    ['7:00 am', 'Run by the river', 'Park'],
    ['7:30 am', 'Breakfast', 'Home'],
    ['8:00 am', 'Read the week\'s notes', ''],
    ['8:30 am', '', ''],
    ['9:00 am', 'Garden plan with Sam', 'Shed'],
    ['9:30 am', 'Write the seed list', ''],
    ['10:00 am', 'Bake bread', 'Kitchen'],
    ['10:30 am', '', ''],
    ['11:00 am', 'Walk to the market', 'Town'],
    ['11:30 am', 'Lunch', ''],
    ['12:00 pm', 'Library hour', 'Library'],
    ['12:30 pm', '', ''],
    ['1:00 pm', 'Paint the fence', 'Garden'],
    ['1:30 pm', '', ''],
    ['2:00 pm', 'Tea', ''],
    ['2:30 pm', 'Call Ana about the trip', ''],
    ['3:00 pm', '', ''],
    ['3:30 pm', 'Pick beans', 'Garden'],
    ['4:00 pm', 'Cook dinner', 'Kitchen'],
    ['4:30 pm', '', ''],
    ['5:00 pm', 'Dinner with the neighbours', 'Home'],
    ['5:30 pm', '', ''],
    ['6:00 pm', 'Wash up', ''],
    ['6:30 pm', '', ''],
    ['7:00 pm', 'Film night', 'Sofa'],
    ['7:30 pm', '', ''],
    ['8:00 pm', '', ''],
    ['8:30 pm', 'Read in bed', ''],
    ['9:00 pm', 'Lights out', ''],
  ].map(([time, plan, where]) => `| ${time} | ${plan} | ${where} |`),
].join('\n')
export const CALENDAR_COMMENT = '<!-- table: nodim 2, height compact, freeze 1 row 1 col, calendar 30m -->'
/** The fixture's frozen clock: 9:40 am on a made-up day, a third of the way into the 9:30 slot. */
export const CALENDAR_NOW = new Date(2026, 10, 14, 9, 40, 0)
/** YAZ-5606, Time in slot: 46 seconds on, so the 9:30 slot reads `19:14 left` (count down) and `10:46 in` (count up). */
export const CALENDAR_SLOT_NOW = new Date(2026, 10, 14, 9, 40, 46)
/** A page with the calendar table, a line before and text after it. */
export const CALENDAR_PAGE = ['# Day plan', 'Saturday, planned on the Mac:', CALENDAR, CALENDAR_COMMENT, 'Notes for the evening.', ...Array.from({ length: 20 }, (_, i) => `Line ${i + 1} after the table.`)].join('\n\n')

/**
 * YAZ-5658: a made-up daily page's Time · Plan · Lookback table, as the phone's picture in the issue (a long Lookback in
 * the now row, short Plans, an empty Lookback lower down). The clock 7:23 (`WIDE_NOW`): the now row is "7:00 am", its
 * Time in slot pill counts down (the vault's table-look.json).
 */
export const WIDE_NOW = new Date(2026, 10, 14, 7, 23, 0)
export const WIDE_TABLE = [
  '| Time | Plan | Lookback |',
  '| --- | --- | --- |',
  ...[
    ['Sleep', 'Sleep', 'Slept 10:40 pm to 5:10 am'],
    ['6:00 am', 'Morning walk + stretch', 'Walked the long loop, 25 min'],
    ['6:30 am', 'Read 20 pages', 'Read 12 pages'],
    ['7:00 am', 'Write', 'Wrote the outline for the garden post, then two sections on soil and watering (about 900 words) + a short walk'],
    ['7:30 am', 'Gym', ''],
    ['8:00 am', 'Gym', ''],
    ['8:30 am', 'Shower + breakfast', ''],
    ['9:00 am', 'Team call about the spring launch plan', ''],
  ].map(([time, plan, back]) => `| ${time} | ${plan} | ${back} |`),
  '<!-- table: freeze 1 row 1 col, calendar 30m -->',
].join('\n')
export const WIDE_PAGE = ['# Day plan', WIDE_TABLE, 'Notes after the table.'].join('\n\n')
/** YAZ-5658 round 2: the same table with the widths the Mac saved (Lookback widened to 320 px): Same as Desktop draws them. */
export const WIDE_DESK_TABLE = WIDE_TABLE.replace('<!-- table: freeze 1 row 1 col, calendar 30m -->', '<!-- table: widths 96 176 320, freeze 1 row 1 col, calendar 30m -->')
export const WIDE_DESK_PAGE = ['# Day plan', WIDE_DESK_TABLE, 'Notes after the table.'].join('\n\n')

/**
 * YAZ-5683: long code in a cell. A made-up copy of the report's "What is on the Mac" table (paths with no spaces in
 * inline code, the Where column saved at 304 px on the Mac), then each kind of long text beside a column that must not be
 * covered: a plain 64-letter word, a URL, code with spaces, code with none, and bold or a link around it.
 */
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosisxyzabcdefghijklmnop'
const LONG_URL = 'https://example.com/a/very/long/path/with/no/spaces/at/all/index.html'
export const CELL_CODE_TABLE = [
  '| What | Where | What it gave us |',
  '| :-- | :-- | :-- |',
  '| The desktop program | `/Applications/Sample.app/Contents/Resources/app.asar` | The desktop shell\'s code |',
  '| The local database | `~/Library/Application Support/Sample/Partitions/sample2/IndexedDB/` | Projects and every change made to them |',
  '| The cache | `~/Library/Application Support/Sample/Partitions/sample2/Cache/Cache_Data/` | The editor\'s code, and the servers\' saved replies |',
  '| Helper programs | `/Applications/Sample.app/Contents/Resources/` | Names only: screen capture, mouse, keyboard |',
  '<!-- table: widths auto 304 auto -->',
].join('\n')
export const CELL_CODE_CASES = [
  '| Case | Cell | Next column |',
  '| --- | --- | --- |',
  `| Plain long word | ${LONG_WORD} | Next column text |`,
  `| Plain URL | ${LONG_URL} | Next column text |`,
  '| Code with spaces | `run the long command --with --many --flags here` | Next column text |',
  `| Code, no spaces | \`${LONG_URL}\` | Next column text |`,
  `| Bold code | **\`${LONG_WORD}\`** | Next column text |`,
  `| Link code | [\`${LONG_URL}\`](https://example.com) | Next column text |`,
  '<!-- table: widths 120 200 auto -->',
].join('\n')
export const CELL_CODE_PAGE = ['# What is on the Mac', CELL_CODE_TABLE, 'Every kind of long text:', CELL_CODE_CASES, 'Notes after the tables.'].join('\n\n')
