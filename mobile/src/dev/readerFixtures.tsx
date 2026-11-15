import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import type { FetchLike } from '../github/client'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { fakeFriends, fakeScanner, fakeSync, reviewOnTabs } from './fakes'
import { READER_FILES, READER_ID, READER_NOT_STORED, STICKY_FILES, cardBlock, seedReaderVault } from './readerVault'
import { DRAWING_FILES, FLOW_DRAWIO_SVG, GARDEN_SCENE } from './drawingVault'
import { FOLDER_FILES } from './folderVault'
import { fileType, storedMedia, type VaultMedia } from '../media/ui/vaultMedia'
import { remember } from '../search/recent'
import { CALENDAR_NOW, CALENDAR_PAGE, FROZEN_PAGE, LOOK_PAGE, TABLE_PAGE } from './tableFixtures'
import { setCalendarClock } from '../page/tableCalendar'
import { READING_LOOK_PAGE } from './readingLookFixture'
import { NUMBERED_TASKS_PAGE, TASKS_PAGE } from './taskFixtures'
import { fixtureAnswers } from './fixtureAnswers'

/**
 * The screen fixtures of 4C (YAZ-5079): Search, a page and a card on the made-up vault of `readerVault.ts`, for the
 * screenshots (`#fixture=page`). Only a `--mode fixtures` build has this file. Nothing calls GitHub.
 * YAZ-5449 to YAZ-5451: `page` has the ID chip, the dot alone and the page arrows; `page-copied` the toast after a tap
 * on the chip; `page-copy-by-hand` the path to copy by hand (the clipboard says no); `page-last` the last page (its
 * "next" side dim); `card-next` a card after one step of its arrows. YAZ-5468: `page-folder` the arrows of a page in a folder of
 * two pages ("1 / 2": the folder's pages only). The clipboard is a fake: nothing reaches the
 * phone's real one.
 * YAZ-5474: `search-collapsed` the tree after "Collapse all folders" in the box, its Expand all icon at the right end.
 * YAZ-5471: `page-tables` a page of made-up tables in the real shapes (`tableFixtures.ts`), at its six-column table;
 * `page-table-full` that table full screen (its ⤢, at the top right of the table: YAZ-5479).
 * YAZ-5458: `page-look` a made-up page with every block and deep nesting (`readingLookFixture.ts`), for the reading look.
 * YAZ-5477: `card-file-comments` a card file's own view, scrolled to its comments under the card (its Comment button).
 * YAZ-5508: `card-strip` a card file's view with the Mac's strip under the card, closed (properties, a page linking it,
 * comments); `page-card-strip` a page's own card and a card embed, each with its strip.

 * YAZ-5497: `page-headings` the Headings sheet of a page with 60 headings (over the arrows and the tab bar);
 * `page-headings-few` of a page with none ("no headings to list"); `page-headings-alone` in a vault with Search alone (no
 * tab bar: Review off). (YAZ-5504: a card's ⋯ holds the card actions and Find in card, no Headings: no `card-headings`.)
 * YAZ-5498: `page-menu-title` a page whose long title the top bar cuts, its ⋯ open: the full title and folder on top.
 * YAZ-5480: `page-table-frozen` a tall table whose file freezes 2 rows and 1 column; `page-table-frozen-full` it full screen.
 * YAZ-5482: `page-table-look` tables whose comments set every part of the look (`LOOK_PAGE`).
 * YAZ-5493: `page-calendar` a made-up day plan as a calendar table, the clock frozen at 9:40 am (`CALENDAR_NOW`): the now
 * line a third down the 9:30 row, the rows before it dimmed; `page-calendar-chip` the same (`proveLayout.ts` scrolls it past the now
 * row: the Now pill at the bottom); `page-calendar-full` the table full screen.
 * YAZ-5494: `page-tasks` a made-up page of tasks in every shape (`taskFixtures.ts`): each box of the page a check box a
 * tap ticks (44 px around it), the card's box a glyph. YAZ-5510: `page-tasks-numbered` numbered tasks (`1.` to `11.`): only
 * the box, in the number's place (the Mac's rule), then the text.
 * YAZ-5460: the folder page on the made-up `Projects` folder (`folderVault.ts`): `folder-hold` the menu of a held
 * folder; `folder-page` its page (text, tabs, the table); `folder-table` scrolled to its table; `folder-grouped` the
 * grouped table; `folder-board`, `folder-cards`, `folder-calendar` (every day, "Earlier" open) its other views;
 * `folder-sheet` the page in a sheet over Search (the vault says "explore").
 * YAZ-5504: `card-menu` a card file's view (YAZ-5527: River of Seville) with the card's own ⋯ (on its head) open, Archive
 * card tapped once ("Tap again to archive");
 * `page-card-menu` the page of three cards with the ⋯ of its first card open (a made-up answer list, `fixtureAnswers`).
 * YAZ-5506: `search-sticky` a made-up tree nine folders deep, every folder open, scrolled to its deepest pages: the open
 * folders stuck at the top (`STICKY_FILES`).
 * YAZ-5507: `search-lines` the same tree, a finger on it (its guide lines show), scrolled so three folders stick.
 * YAZ-5521 (sweep2 S-B): `page-not-sent`, `page-waiting`, `page-long-id-not-sent`, `page-long-id-waiting`: `page` and
 * `page-long-id` with the dot amber: one comment not sent (its page gone), or two comments waiting.
 * YAZ-5524 (sweep3 S-1): `page-no-id` a page with a long title and NO ID chip; `-waiting1-offline` "1 comment waiting ·
 * no signal", `-waiting2-offline` "2 waiting · no signal" (a comment and a tick), `-waiting`, `-not-sent`. YAZ-5524 S-2:
 * `-mixed-offline` (also on `page`, with the ID chip): one comment not sent AND two waiting, no signal.
 * YAZ-5534: the Type filter over a made-up vault of pages, cards, drawings and diagrams in folders (`TYPES_FILES`):
 * `search-types` Cards, Drawings and Diagrams on, no text: each in its folders, the parents open ("3 types");
 * `search-types-menu` the menu open, Pages and Cards checked; `search-types-favorites` Favorites with Cards.
 */
/** YAZ-5534: drawings and diagrams in folders beside the reader vault's pages and cards (made up). */
const TYPES_FILES: Record<string, string | Uint8Array> = {
  'travel/Rivers of Europe.md': '---\ntitle: Rivers of Europe\n---\n\nThe long ones.\n',
  'travel/plans/Garden beds.excalidraw': new TextEncoder().encode(JSON.stringify(GARDEN_SCENE)),
  'travel/plans/Seed to harvest.drawio.svg': new TextEncoder().encode(FLOW_DRAWIO_SVG),
  'work/flows/Sign in.drawio': new TextEncoder().encode('<mxfile><diagram id="d" name="Page-1"></diagram></mxfile>'),
  'work/Whiteboard.excalidraw': new TextEncoder().encode(JSON.stringify(GARDEN_SCENE)),
  '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites: ['git', 'cards/capital-of-spain-demo-40.md', 'travel'] }),
}
const NAMES = ['search', 'search-typed', 'search-type', 'search-none', 'page', 'page-lower', 'card', 'card-file', 'card-invalid', 'page-offline', 'page-online', 'page-tricks', 'page-cards', 'search-tree', 'search-clear', 'page-drawing', 'search-found', 'page-copied', 'page-copy-by-hand', 'page-last', 'card-next', 'page-code', 'search-favorites', 'search-focus', 'search-ids', 'search-recent', 'page-comments', 'search-collapsed', 'page-tables', 'page-table-full', 'page-folder', 'page-links', 'page-linked-from', 'page-pills', 'page-tools', 'page-find', 'page-headings', 'page-headings-few', 'page-headings-alone', 'page-menu-title', 'page-properties', 'page-properties-closed', 'page-properties-title', 'card-file-comments', 'page-table-frozen', 'page-table-frozen-full', 'page-table-look', 'page-look', 'page-calendar', 'page-calendar-chip', 'page-calendar-full', 'page-tasks', 'page-tasks-numbered', 'folder-hold', 'folder-page', 'folder-table', 'folder-grouped', 'folder-board', 'folder-cards', 'folder-calendar', 'folder-sheet', 'card-menu', 'page-card-menu', 'search-sticky', 'search-lines', 'card-strip', 'page-card-strip', 'page-long-id', 'page-not-sent', 'page-waiting', 'page-long-id-not-sent', 'page-long-id-waiting', 'page-no-id', 'page-no-id-waiting1-offline', 'page-no-id-waiting2-offline', 'page-no-id-waiting', 'page-no-id-not-sent', 'page-no-id-mixed-offline', 'page-mixed-offline', 'search-types', 'search-types-menu', 'search-types-favorites'] as const
type ReaderFixture = (typeof NAMES)[number]

export const isReaderFixture = (name: string): name is ReaderFixture => (NAMES as readonly string[]).includes(name)

const refuseAll: FetchLike = async () => new Response('{}', { status: 401 })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Waits until `done()`, at most `ms`. */
async function until(done: () => boolean, ms = 3000): Promise<void> {
  for (const end = Date.now() + ms; !done() && Date.now() < end; ) await wait(20)
}

const press = (name: string | RegExp) => {
  const named = (b: Element) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim()
  const el = [...document.querySelectorAll<HTMLElement>('button, a')].find((b) => (typeof name === 'string' ? named(b) === name : name.test(named(b))))
  el?.click()
}

function typeSearch(value: string): void {
  const input = document.querySelector<HTMLInputElement>('input[name="search"]')
  if (input === null) return
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** YAZ-5364: a page with the parser tricks, each unclosed; its last line must draw (`publish/proveLayout.ts`). */
const TRICKS = [
  'x <template> [[Trip plan]] after',
  'x <math><mtext><textarea> [[Trip plan]] after',
  'x <select> [[Trip plan]] after',
  'x <svg><foreignObject> [[Trip plan]] after',
  'x <desc> [[Trip plan]] after',
  '<div title="x',
  '',
  '## The end',
  '',
  'The end of the page.',
  '',
  '<!--',
].join('\n\n')

/** YAZ-5437: a page with three cards: a title, no title, a title hidden in review on an archived card. */
const THREE_CARDS = [
  '# Rivers of Europe',
  'Three cards for the trip.',
  cardBlock('DEMO-51', 'Which river runs through Madrid?\n---\nThe Manzanares', ['title "River of Madrid"']),
  cardBlock('DEMO-52', 'Which river runs through Paris?\n---\nThe Seine'),
  cardBlock('DEMO-53', 'Which river runs through Vienna?\n---\nThe Danube', ['title "River of Vienna"', 'notitle', 'off']),
].join('\n\n')

/** YAZ-5448: a page with long code lines (a code block, a card's code block, a long inline code and URL): each wraps. */
const LONG_CODE = 'const answer = someVeryLongFunctionName(firstArgument, secondArgument, thirdArgument, fourthArgument)'
const LONG_URL = 'https://example.com/a/very/long/path/that/never/stops/with-no-spaces-at-all-1234567890abcdef'
const CODE_PAGE = [
  '# Code notes',
  'A block with a long line:',
  ['```ts', 'function show() {', `  if (ready) {`, `    ${LONG_CODE}`, '  }', '}', '```'].join('\n'),
  `A long inline code: \`${LONG_CODE.replace(/ /g, '')}\`, and a long address: ${LONG_URL}`,
  cardBlock('DEMO-61', ['What does {{show}} print?', '', '```js', `    ${LONG_CODE}`, '```', '---', `It prints \`${LONG_URL}\``].join('\n'), ['title "Long code"']),
].join('\n\n')
/** YAZ-5461: a page with comments (made-up): a thread with a reply, a resolved one, and a hand-written one. */
const COMMENTED = [
  '---',
  'title: Review notes',
  'comments:',
  '  - {id: demo0001, n: 1, at: "2026-11-10T09:00:00Z", by: demo, body: "Can we add the May dates?"}',
  '  - {id: demo0002, n: 1, at: "2026-11-10T09:30:00Z", by: sam, reply_to: demo0001, body: "Added."}',
  '  - {id: demo0003, n: 2, at: "2026-11-11T08:00:00Z", by: demo, title: Budget, resolved: "2026-11-12T08:00:00Z", body: "Check the hotel price."}',
  '  - {by: agent, body: "Approved"}',
  '---',
  '',
  '# Review notes',
  '',
  'The trip, for review.',
  '',
].join('\n')

/** YAZ-5477: a card file with comments (made-up): in its front matter after `kind: card`, never on the card line. */
const COMMENTED_CARD = [
  '---',
  'kind: card',
  'comments:',
  '  - {id: demo0011, n: 1, at: "2026-11-12T09:00:00Z", by: demo, body: "Is it the Guadalquivir or the Guadiana?"}',
  '  - {id: demo0012, n: 1, at: "2026-11-12T09:20:00Z", by: sam, reply_to: demo0011, body: "The Guadalquivir."}',
  '  - {id: demo0013, n: 2, at: "2026-11-13T08:00:00Z", by: demo, resolved: "2026-11-13T09:00:00Z", body: "Add a picture."}',
  '---',
  '',
  cardBlock('DEMO-45', 'Which river runs through Seville?\n---\nThe Guadalquivir.', ['title "River of Seville"', '2026-11-01T08:00Z good']),
  '',
].join('\n')

/** YAZ-5504: the page of `page-card-menu`: three cards, none archived (an archived card is dim by design, the Mac's). */
const MENU_CARDS = [
  '# Rivers of Europe',
  'Three cards for the trip.',
  cardBlock('DEMO-51', 'Which river runs through Madrid?\n---\nThe Manzanares', ['title "River of Madrid"']),
  cardBlock('DEMO-52', 'Which river runs through Paris?\n---\nThe Seine'),
  cardBlock('DEMO-53', 'Which river runs through Vienna?\n---\nThe Danube', ['title "River of Vienna"', 'notitle', 'fix']),
].join('\n\n')
/** YAZ-5508: the commented card with its own properties and four reviews, for `card-strip`. */
const STRIP_CARD = COMMENTED_CARD.replace(
  /<!-- card: DEMO-45, [^>]*-->/,
  '<!-- card: DEMO-45, title "River of Seville", tags "spain" "rivers", level "B1", 2026-09-08T08:00Z good, 2026-09-12T08:00Z good, 2026-09-25T08:00Z good, 2026-11-13T08:00Z good -->',
)

export async function mountReaderFixture(root: Root, fixture: ReaderFixture): Promise<void> {
  // YAZ-5521: the amber dot's variants are their page's fixture, with a made-up answer list's state under the dot.
  // YAZ-5524: `-offline` after it: the engine has no signal.
  const dotMatch = /-(not-sent|waiting1|waiting2|waiting|mixed)(-offline)?$/.exec(fixture)
  const dotKind = dotMatch?.[1] as 'not-sent' | 'waiting1' | 'waiting2' | 'waiting' | 'mixed' | undefined
  const dotOffline = dotMatch?.[2] !== undefined
  const name = (dotMatch === null ? fixture : fixture.slice(0, dotMatch.index)) as ReaderFixture
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  const extra: Record<string, string | Uint8Array> =
    name === 'page-tricks'
      ? { 'Parser tricks.md': `---\ntitle: Parser tricks\n---\n# Parser tricks\n\n${TRICKS}\n\nAfter the comment.\n` }
      : name === 'page-card-menu'
        ? { 'travel/Rivers of Europe.md': `---\ntitle: Rivers of Europe\n---\n\n${MENU_CARDS}\n` }
      : name === 'page-cards' || name === 'search-tree' || name === 'search-found' || name === 'search-collapsed'
        ? { 'travel/Rivers of Europe.md': `---\ntitle: Rivers of Europe\n---\n\n${THREE_CARDS}\n`, 'travel/2026/Madrid days.md': '---\ntitle: Madrid days\n---\n\nDay one.\n' }
        : name === 'page-code'
          ? { 'Code notes.md': `---\ntitle: Code notes\n---\n\n${CODE_PAGE}\n` }
        : name === 'page-look'
          ? { 'Reading look.md': `---\ntitle: Reading look\n---\n\n${READING_LOOK_PAGE}\n` }
        : name === 'page-tables' || name === 'page-table-full'
          ? { 'Table shapes.md': `---\ntitle: Table shapes\n---\n\n${TABLE_PAGE}\n` }
        : name === 'page-table-frozen' || name === 'page-table-frozen-full'
          ? { 'Frozen table.md': `---\ntitle: Frozen table\n---\n\n${FROZEN_PAGE}\n` }
        : name === 'page-tasks'
          ? { 'home/Weekend jobs.md': TASKS_PAGE }
        : name === 'page-tasks-numbered'
          ? { 'home/Shed list.md': NUMBERED_TASKS_PAGE }
        : name === 'page-calendar' || name === 'page-calendar-chip' || name === 'page-calendar-full'
          ? { 'Day plan.md': `---\ntitle: Day plan\n---\n\n${CALENDAR_PAGE}\n` }
        : name === 'page-table-look'
          ? { 'Table look.md': `---\ntitle: Table look\n---\n\n${LOOK_PAGE}\n` }
        : name === 'search-sticky' || name === 'search-lines'
          ? STICKY_FILES
        : name === 'search-types' || name === 'search-types-menu' || name === 'search-types-favorites'
          ? TYPES_FILES
        : name === 'page-drawing'
          ? DRAWING_FILES
          : name === 'search-favorites'
            ? {
                'travel/Rivers of Europe.md': `---\ntitle: Rivers of Europe\n---\n\n${THREE_CARDS}\n`,
                'travel/2026/Madrid days.md': '---\ntitle: Madrid days\n---\n\nDay one.\n',
                // YAZ-5452: the Mac's Favorites, in its order: a page, a folder, a card file, and a path that is gone (no row).
                '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites: ['Trip plan.md', 'travel', 'cards/capital-of-spain-demo-40.md', 'Gone.md'] }),
              }
            : name === 'search-focus'
              ? {
                  // YAZ-5453: two Macs' focus files (the newer is the list) and a folder of the Focus tab.
                  '.yaseendocs/focus.aaaaaaaaaaaa.json': JSON.stringify({ version: 1, at: '2026-11-01T10:00:00Z', focus: ['Café notes.md'] }),
                  '.yaseendocs/focus.bbbbbbbbbbbb.json': JSON.stringify({ version: 1, at: '2026-11-02T10:00:00Z', focus: ['Trip plan.md', 'git'] }),
                  '.yaseendocs/focus-folders.bbbbbbbbbbbb.json': JSON.stringify({ version: 1, at: '2026-11-02T10:00:00Z', self: 'vault', folders: [{ id: 'f1', name: 'Spanish study', created: 1, at: 1, items: [{ vault: 'vault', path: 'Spanish words.md' }, { vault: 'vault', path: 'cards' }] }] }),
                }
              : name === 'search-ids'
                ? { '.yaseendocs/show-ids.json': JSON.stringify({ search: 'always', title: true, files: 'number' }) } // YAZ-5454: "#12" at each page row's end
                : name === 'page-comments'
                  ? { 'Review notes.md': COMMENTED }
          : name === 'page-links' || name === 'page-linked-from'
            ? {
                'Links.md': `---\ntitle: Links\nid: DEMO-7\n---\n\n# Links\n\nBy words: [[Trip plan|the trip]]. By ID: [[DEMO-4]]. To a heading: [[Spanish words#Places]].\n\nA card: [[DEMO-40]]. Missing: [[No such page]]. Web: [a site](https://example.com/x).\n\nRelative: [the guide](notes/Folder%20guide.md#step-two).\n`,
                'notes/Folder guide.md': '---\ntitle: Folder guide\n---\n\n# Folder guide\n\n## Step one\n\nOne.\n\n## Step two\n\nDone.\n',
              }
          : name.startsWith('page-properties')
            ? {
                // YAZ-5529: the page's own `# Trip notes` is its title (the chip on its line), but in `-title` (the reader's).
                'Trip notes.md':
                  '---\ntitle: Trip notes\nid: DEMO-8\nstatus: Planning\ndue: 2026-12-01\nstarts: 2026-12-01T09:30\nbudget: 1250.5\nbooked: true\npacked: false\ntags: [spain, trains]\nsee: "[[Trip plan]]"\nnote: Read [[Café notes]] first\naliases: [Viaje]\n---\n\n' +
                  (name === 'page-properties-title' ? '' : '# Trip notes\n\n') +
                  'The notes for the trip: the trains, the rooms and the days, as planned so far.\n\n## Days\n\nThe first day is in Madrid.\n',
              }
          : name === 'page-pills'
            ? {
                '.yaseendocs/link-pills.json': JSON.stringify({ version: 2, format: '{name} · {id}', box: { shape: 'underline' }, parts: { id: { bold: true } } }),
                '.yaseendocs/text-formatting.json': JSON.stringify({ version: 1, h1: { size: 30 }, h2: { underline: true } }),
              }
          : name === 'page-headings' || name === 'page-headings-alone'
            ? {
                'Long notes.md': `---\ntitle: Long notes\n---\n\n${Array.from({ length: 60 }, (_, i) => `## Part ${i + 1}\n\nA line of made-up notes for part ${i + 1}.`).join('\n\n')}\n`,
                // `page-headings-alone`: Review off in the vault's file, and the tabs read from it: Search alone, no tab bar.
                ...(name === 'page-headings-alone' && { '.yaseendocs/review.json': '{"enabled": false}' }),
              }
          : name === 'page-menu-title'
            ? { 'travel/2026/Madrid week.md': '---\ntitle: A very long page title about the first week of the trip to Madrid in May\n---\n\n# Week\n\nDay one.\n' }
          : name === 'page-folder'
            ? { 'git/Merge.md': '---\ntitle: Merge\n---\n\nMerge notes.\n', 'git/deep/Rebase.md': '---\ntitle: Rebase\n---\n\nRebase notes.\n' }
          : name === 'card-file-comments'
            ? { 'cards/river-of-seville-demo-45.md': COMMENTED_CARD }
          : name.startsWith('folder-')
            ? { ...FOLDER_FILES, ...(name === 'folder-sheet' && { '.yaseendocs/link-click.json': '{"click":"explore"}' }) }
          : name === 'page-long-id'
            ? {
                // YAZ-5519 S3: a long title and the longest ID letters (5) with a long number, for the top bar at 320 px.
                'garden/Garden plan.md': '---\ntitle: A very long garden plan for the whole back yard, the shed and the raised beds\nid: GARDN-1234567\n---\n\n# Beds\n\nTomatoes.\n',
                '.yaseendocs/ids.json': '{"enabled": true, "letters": "GARDN"}',
              }
          : name === 'page-no-id'
            ? { 'notes/Very long words about the whole trip and the plans for every day.md': '---\ntitle: Very long words about the whole trip and the plans for every day\n---\n\n# Words\n\nMade-up words.\n' }
          : name === 'card-strip' || name === 'card-menu'
            ? { 'cards/river-of-seville-demo-45.md': STRIP_CARD, 'trips/Seville.md': '---\ntitle: Seville\nid: DEMO-46\n---\n\nThe river card: [[DEMO-45]].\n' }
            : {}
  await seedReaderVault(store, tokens, { ...READER_FILES, ...extra })
  // `page-online`: a media that "downloads" the picture that is not on the phone (as 3D does with a signal).
  const stored = storedMedia(store, 'yaseen/vault@main')
  const online: VaultMedia = {
    async show(path) {
      const bytes = READER_NOT_STORED[path]
      if (bytes === undefined) return stored.show(path)
      return { status: 'ready', path, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: fileType(path) })), type: fileType(path) }
    },
  }
  // `page-drawing` (YAZ-5440): the stored files with their real type, as 3D gives them (an SVG is `image/svg+xml`).
  const typedMedia: VaultMedia = {
    async show(path) {
      const shown = await stored.show(path)
      if (shown.status !== 'ready' || !/\.svg$/i.test(path)) return shown
      const file = await store.read('yaseen/vault@main', path)
      return file === null ? shown : { ...shown, url: URL.createObjectURL(new Blob([file.content as BlobPart], { type: 'image/svg+xml' })), type: 'image/svg+xml' }
    },
  }
  const sync = fakeSync()
  // YAZ-5504: the card menu's fixtures get a made-up answer list (in memory; nothing is sent).
  if (name === 'card-menu' || name === 'page-card-menu') {
    const answers = fixtureAnswers(store, READER_ID)
    sync.review = async () => ({ answers }) as unknown as Awaited<ReturnType<NonNullable<typeof sync.review>>>
  }
  if (dotKind !== undefined) {
    const waitingComments = { waiting: 2, waiting1: 1, waiting2: 2, mixed: 2, 'not-sent': 0 }[dotKind]
    const notSent = dotKind === 'not-sent' || dotKind === 'mixed'
    const state = { vault: READER_ID, waiting: 0, lost: [], sending: false, problem: null, retryAt: null, lastSentAt: null, comments: waitingComments, ticks: dotKind === 'waiting2' ? 1 : 0, notSent: notSent ? { n: 1, ticks: 0, gone: 1 } : undefined }
    // The comment not sent holds a long URL (sweep2 S-C: the Discard ask must wrap it).
    const lost = { id: 'a1b2c3d4', path: 'garden/Old plan.md', body: 'See https://example.com/a/very/long/path/that/does/not/wrap/nicely/at/all/Supercalifragilisticexpialidocious', at: '2026-11-15T09:00:00Z', madeAt: 0, notBefore: 0, refused: 'gone' as const }
    const comments = { ready: async () => {}, waiting: (path?: string) => (notSent && (path === undefined || path === lost.path) ? [lost] : []), add: async () => lost, undo: async () => false, discard: async () => true, subscribe: () => () => {} }
    const answers = { state: () => state, subscribe: () => () => {}, waiting: () => [], comments }
    sync.review = async () => ({ answers }) as unknown as Awaited<ReturnType<NonNullable<typeof sync.review>>>
  }
  const services: AppServices = { store, tokens, vaultTabs: name === 'page-headings-alone' ? undefined : reviewOnTabs, sync, friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: refuseAll, ...(name === 'page-online' && { media: online }), ...(name === 'page-drawing' && { media: typedMedia }) }
  root.render(<App services={services} />)
  await until(() => document.querySelector('[role="tab"]') !== null || (name === 'page-headings-alone' && document.querySelector('input[name="search"]') !== null))
  press('Search')
  await until(() => document.querySelector('.search__rows, .tree') !== null)

  const typed = async (q: string) => {
    typeSearch(q)
    await wait(150)
    // The results' tree is a lazy chunk (YAZ-5438, YAZ-5447): the first one waits for it.
    await until(() => document.querySelector('.search__found') !== null || /No matches/.test(document.body.textContent ?? ''))
  }
  const open = async (row: RegExp, ready: string) => {
    press(row)
    await until(() => document.querySelector(ready) !== null)
    await wait(400)
  }
  const fakeClipboard = (works: boolean) =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => (works ? Promise.resolve() : Promise.reject(new DOMException('Not allowed', 'NotAllowedError'))) } })
  /** YAZ-5460: a finger held on a folder row of the tree, as long as the hold. */
  const hold = async (folder: string) => {
    const row = [...document.querySelectorAll<HTMLElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === folder)
    row?.dispatchEvent(new (typeof PointerEvent === 'function' ? PointerEvent : MouseEvent)('pointerdown', { bubbles: true, button: 0, clientX: 40, clientY: 40 }))
    await until(() => document.querySelector('.hold-menu') !== null, 1500)
    await wait(250)
  }
  const folderTab = async (tab: string) => {
    press(/^Open folder page$/)
    await until(() => document.querySelector('.folder-view') !== null)
    if (tab !== '') press(tab)
    await wait(400)
  }
  switch (name) {
    case 'folder-hold':
      await hold('Projects')
      break
    case 'folder-page':
    case 'folder-sheet':
      await hold('Projects')
      await folderTab('')
      break
    case 'folder-table':
      await hold('Projects')
      await folderTab('')
      document.querySelector('.folder-tabs')?.scrollIntoView({ block: 'start' })
      await wait(150)
      break
    case 'folder-grouped':
    case 'folder-board':
    case 'folder-cards':
    case 'folder-calendar':
      await hold('Projects')
      await folderTab({ 'folder-grouped': 'By status', 'folder-board': 'Board', 'folder-cards': 'Cards', 'folder-calendar': 'Calendar' }[name])
      if (name === 'folder-calendar') press(/^Earlier/)
      await wait(150)
      document.querySelector('.folder-tabs')?.scrollIntoView({ block: 'start' })
      await wait(150)
      break
    case 'page-copied':
    case 'page-copy-by-hand':
      fakeClipboard(name === 'page-copied')
      if (!/Git cheat sheet/.test(document.querySelector('.tree')?.textContent ?? '')) {
        press(/^git, folder/)
        await wait(80)
      }
      await open(/^Git cheat sheet/, '.reader__body')
      press(/Copy the path$/)
      await until(() => document.querySelector('.toast, .copy-by-hand') !== null)
      break
    case 'page-tools':
    case 'page-find':
      await open(/^Spanish words/, '.reader__body h1')
      press('Page tools')
      await wait(50)
      if (name === 'page-find') {
        press(/Find in page/)
        await until(() => document.querySelector('.find-line__input') !== null)
        const box = document.querySelector<HTMLInputElement>('.find-line__input')!
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'spa')
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(200)
        press('Next match')
      }
      break
    case 'page-headings':
    case 'page-headings-alone':
    case 'page-headings-few':
      if (name === 'page-headings-few') await open(/^Trip plan/, '.reader__body p')
      else {
        await typed('long notes')
        await open(/^Long notes/, '.reader__body h2')
      }
      press('Page tools')
      await wait(50)
      press(/Headings/)
      await until(() => document.querySelector('.headings-sheet__row, .headings-sheet__none') !== null)
      break
    case 'page-menu-title':
      await typed('madrid week')
      await open(/^A very long page title/, '.reader__body h1')
      press('Page tools')
      await until(() => document.querySelector('.page-tools__menu') !== null)
      break
    case 'page-properties':
    case 'page-properties-closed':
    case 'page-properties-title':
      await typed('trip notes')
      await open(/^Trip notes/, '.reader__body p')
      await until(() => document.querySelector('.page-props') !== null)
      if (name === 'page-properties-closed') break
      press(/^Properties/)
      await until(() => document.querySelector('.page-props__rows') !== null)
      await wait(150)
      break
    case 'page-pills':
      await open(/^Spanish words/, '.reader__body h1')
      break
    case 'page-no-id':
      await typed('very long words')
      await open(/^Very long words/, '.reader__body h1')
      break
    case 'page-long-id':
      await typed('very long garden')
      await open(/^A very long garden plan/, '.reader__body h1')
      break
    case 'page-links':
      await typed('links')
      await open(/^Links/, '.reader__body h1')
      break
    case 'page-linked-from':
      await typed('trip plan')
      await open(/^Trip plan/, '.linked-mentions')
      press(/^Linked mentions/)
      await until(() => document.querySelectorAll('.linked-mentions__line').length >= 2)
      document.querySelector('.linked-mentions')?.scrollIntoView({ block: 'start' })
      break
    case 'page-folder':
      if (!/Git cheat sheet/.test(document.querySelector('.tree')?.textContent ?? '')) {
        press(/^git, folder/)
        await wait(80)
      }
      await open(/^Git cheat sheet/, '.page-arrows')
      break
    case 'page-last':
      await open(/^Trip plan/, '.page-arrows')
      break
    case 'card-next':
      if (!/Capital of Spain/.test(document.querySelector('.tree')?.textContent ?? '')) {
        press(/^cards, folder/)
        await wait(80)
      }
      await open(/^Capital of Spain/, '.page-arrows')
      press(/^Next: card/)
      await until(() => document.querySelector('.topbar__title')?.textContent === 'Two cards in one')
      await wait(300)
      break
    case 'search-typed':
      await typed('spa')
      break
    case 'search-type':
      press(/All types/)
      await wait(50)
      press('Cards')
      await wait(100)
      press(/Cards/)
      break
    case 'search-none':
      await typed('zebra')
      break
    case 'search-types':
    case 'search-types-menu':
    case 'search-types-favorites': {
      // YAZ-5534: the types picked in the menu, which stays open for more; the pill again closes it.
      if (name === 'search-types-favorites') {
        press('Favorites')
        await until(() => document.querySelector('[role="tree"][aria-label="Favorites"]') !== null)
      }
      press(/^All types/)
      await until(() => document.querySelector('[role="menu"][aria-label="Type"]') !== null)
      const picks = name === 'search-types' ? ['Cards', 'Drawings', 'Diagrams'] : name === 'search-types-menu' ? ['Pages', 'Cards'] : ['Cards']
      for (const pick of picks) {
        press(pick)
        await wait(60)
      }
      await until(() => document.querySelector('.search__found') !== null)
      if (name !== 'search-types-menu') press(/ ▾$/)
      await wait(150)
      break
    }
    case 'page':
      await open(/^Spanish words/, '.reader__body h1')
      break
    case 'page-lower':
      await open(/^Spanish words/, '.reader__body h1')
      document.querySelector('.card-embed')?.scrollIntoView({ block: 'start' })
      break
    case 'page-offline':
    case 'page-online':
      await open(/^Spanish words/, '.reader__body h1')
      document.querySelector('.reader__body blockquote:not(.page-callout)')?.scrollIntoView({ block: 'start' })
      await wait(400)
      break
    case 'page-drawing':
      await typed('garden')
      await open(/^Garden plan/, '.reader__body h1')
      await until(() => document.querySelector('.page-drawing__img') !== null && !document.querySelector('.page-drawing--wait'), 15000)
      break
    case 'card':
      await typed('la bib')
      await open(/^la biblioteca/, '.card-view__card .card__sides, .card-view__card *')
      break
    case 'page-cards':
      await typed('rivers')
      await open(/^Rivers of Europe/, '.reader__body .page-card')
      break
    case 'search-tree':
      for (const folder of [/^travel, folder/, /^2026, folder/, /^cards, folder/]) {
        press(folder)
        await wait(80)
      }
      break
    case 'search-collapsed':
      // YAZ-5474: folders opened to two depths, then "Collapse all folders" in the box: all closed, the box shows Expand all.
      for (const folder of [/^travel, folder/, /^2026, folder/, /^cards, folder/]) {
        press(folder)
        await wait(80)
      }
      await until(() => document.querySelector('.search__fold') !== null)
      press('Collapse all folders')
      await until(() => document.querySelector('[aria-label="Expand all folders"]') !== null)
      break
    case 'search-sticky': {
      // YAZ-5506: every folder open (Expand all), then the list scrolled so a page eight folders down is at the top.
      await until(() => document.querySelector('[aria-label="Expand all folders"]') !== null)
      press('Expand all folders')
      await until(() => document.querySelector('[aria-label="Number 12 note 2, page"]') !== null)
      await wait(300)
      const screen = document.querySelector<HTMLElement>('.screen')
      const li = document.querySelector('[aria-label="Calle Betis note 3, page"]')?.closest('li')
      if (screen !== null && li != null) screen.scrollTop += li.getBoundingClientRect().top - screen.getBoundingClientRect().top
      await until(() => document.querySelectorAll('.tree__row--stuck').length > 0)
      await wait(150)
      break
    }
    case 'search-lines': {
      // YAZ-5507: every folder open, a finger on the list ("On hover", the Mac's default: the lines show while it is
      // there), and the list scrolled so Spain's pages pass under three stuck folders.
      await until(() => document.querySelector('[aria-label="Expand all folders"]') !== null)
      press('Expand all folders')
      await until(() => document.querySelector('[aria-label="Number 12 note 2, page"]') !== null)
      await wait(300)
      const screen = document.querySelector<HTMLElement>('.screen')
      const list = document.querySelector<HTMLElement>('ul.tree')
      list?.dispatchEvent(new Event('touchstart'))
      const li = document.querySelector('[aria-label="Andalusia, folder"]')?.closest('li')
      if (screen !== null && li != null) screen.scrollTop += li.getBoundingClientRect().top - screen.getBoundingClientRect().top - 2 * 44 + 20
      await until(() => document.querySelectorAll('.tree__row--stuck').length > 0)
      await wait(250)
      break
    }
    case 'search-found':
      // YAZ-5447: the matches in the tree: a page two folders down, a card under its page, the typed text marked.
      await typed('madrid')
      break
    case 'search-favorites':
      // YAZ-5452: the Favorites chip on, the folder favorite open.
      press('Favorites')
      await until(() => document.querySelector('[role="tree"][aria-label="Favorites"]') !== null)
      press(/^travel, folder/)
      await wait(80)
      break
    case 'search-focus':
      press('Focus')
      await until(() => document.querySelector('[role="tree"][aria-label="Focus"]') !== null)
      press(/^cards, folder/)
      await wait(80)
      break
    case 'search-ids':
      press(/^git, folder/)
      await until(() => document.querySelector('.tree__id') !== null)
      break
    case 'search-recent':
      // YAZ-5457: what this phone opened, newest first (a card in a page, a card file, a page), the Recent chip on.
      for (const route of [{ kind: 'page', path: 'Trip plan.md' }, { kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' }, { kind: 'card', path: 'Spanish words.md', id: 'DEMO-12' }] as const) await remember(store, 'yaseen/vault@main', route)
      press('Recent')
      await until(() => document.querySelector('[role="tree"][aria-label="Recent"]') !== null)
      break
    case 'search-clear':
      document.querySelector<HTMLInputElement>('input[name="search"]')?.focus()
      await typed('spa')
      break
    case 'page-code':
      await typed('code notes')
      await open(/^Code notes/, '.reader__body pre')
      break
    case 'page-look':
      await typed('reading look')
      await open(/^Reading look/, '.reader__body h1')
      break
    case 'page-comments':
      await open(/^Review notes/, '.page-comments')
      document.querySelector('.page-comments')?.scrollIntoView({ block: 'start' })
      break
    case 'card-menu':
      // YAZ-5527: a card FILE's view: the card's own ⋯ at the right of its head opens the card actions; one tap arms Archive card.
      await typed('seville')
      await open(/^River of Seville/, '.card-view__card .card__more')
      press('Card actions: River of Seville')
      await until(() => document.querySelector('.card-menu [data-action="off"]:not(:disabled)') !== null)
      press('Archive card')
      await wait(50)
      break
    case 'page-card-menu':
      await typed('rivers')
      await open(/^Rivers of Europe/, '.reader__body .page-card')
      press('Card actions: River of Madrid')
      await until(() => document.querySelector('.card-menu [data-action="off"]:not(:disabled)') !== null)
      break
    case 'card-file-comments':
      await typed('seville')
      await open(/^River of Seville/, '.card-view .page-comments')
      document.querySelector('.card-view .page-comments')?.scrollIntoView({ block: 'start' })
      break
    case 'card-strip':
      await typed('seville')
      await open(/^River of Seville/, '.card-view .phone-strip')
      break
    case 'page-card-strip':
      await open(/^Spanish words/, '.reader__body .card-embed .phone-strip')
      document.querySelector('.reader__body .page-card')?.scrollIntoView({ block: 'start' })
      break
    case 'page-tables':
    case 'page-table-full': {
      await typed('table shapes')
      await open(/^Table shapes/, '.reader__body .page-table-box')
      const wide = document.querySelectorAll<HTMLElement>('.reader__body .page-table-box')[2]
      wide?.previousElementSibling?.scrollIntoView({ block: 'start' })
      if (name === 'page-table-full') {
        wide?.querySelector<HTMLElement>('[data-table-open]')?.click()
        await until(() => document.querySelector('.table-view') !== null)
      }
      await wait(200)
      break
    }
    case 'page-table-frozen':
    case 'page-table-frozen-full': {
      await typed('frozen table')
      await open(/^Frozen table/, '.reader__body .page-table-box')
      if (name === 'page-table-frozen-full') {
        document.querySelector<HTMLElement>('.reader__body [data-table-open]')?.click()
        await until(() => document.querySelector('.table-view') !== null)
      }
      await wait(200)
      break
    }
    case 'page-calendar':
    case 'page-calendar-chip':
    case 'page-calendar-full': {
      setCalendarClock(() => CALENDAR_NOW)
      await typed('day plan')
      await open(/^Day plan/, '.reader__body .table-now-row')
      if (name === 'page-calendar-full') {
        document.querySelector<HTMLElement>('.reader__body [data-table-open]')?.click()
        await until(() => document.querySelector('.table-view') !== null)
      }
      await wait(300)
      break
    }
    case 'page-tasks':
      await typed('weekend jobs')
      await open(/^Weekend jobs/, '.reader__body .page-task[data-task]')
      break
    case 'page-tasks-numbered':
      await typed('shed list')
      await open(/^Shed list/, '.reader__body .page-task[data-task]')
      break
    case 'page-table-look':
      await typed('table look')
      await open(/^Table look/, '.reader__body .page-table-box')
      await wait(200)
      break
    case 'page-tricks':
      await typed('parser')
      await open(/^Parser tricks/, '.reader__body h1')
      break
    case 'card-file':
      await typed('capital')
      await open(/^Capital of Spain/, '.card-view__card *')
      break
    case 'card-invalid':
      await typed('two cards')
      await open(/^Two cards in one/, '.card-view__card *')
      break
  }
  // YAZ-5524: no signal (the engine's state, as after a failed poll).
  if (dotOffline) sync.set({ status: 'off', problem: 'OFFLINE' })
  await wait(100)
  document.documentElement.dataset.fixtureReady = fixture
}
