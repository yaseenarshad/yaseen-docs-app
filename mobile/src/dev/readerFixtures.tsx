import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import type { FetchLike } from '../github/client'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { fakeFriends, fakeScanner, fakeSync } from './fakes'
import { READER_FILES, READER_NOT_STORED, cardBlock, seedReaderVault } from './readerVault'
import { DRAWING_FILES } from './drawingVault'
import { fileType, storedMedia, type VaultMedia } from '../media/ui/vaultMedia'
import { remember } from '../search/recent'
import { TABLE_PAGE } from './tableFixtures'

/**
 * The screen fixtures of 4C (YAZ-5079): Search, a page and a card on the made-up vault of `readerVault.ts`, for the
 * screenshots (`#fixture=page`). Only a `--mode fixtures` build has this file. Nothing calls GitHub.
 * YAZ-5449 to YAZ-5451: `page` has the ID chip, the dot alone and the page arrows; `page-copied` the toast after a tap
 * on the chip; `page-copy-by-hand` the path to copy by hand (the clipboard says no); `page-last` the last page (its
 * "next" side dim); `card-next` a card after one step of its arrows. YAZ-5468: `page-folder` the arrows of a page in a folder of
 * two pages ("1 / 2": the folder's pages only). YAZ-5467: `page-jump` a long page just scrolled, the ⤒ ⤓ pill at the right edge. The clipboard is a fake: nothing reaches the
 * phone's real one.
 * YAZ-5474: `search-collapsed` the tree after "Collapse all folders" in the box, its Expand all icon at the right end.
 * YAZ-5471: `page-tables` a page of made-up tables in the real shapes (`tableFixtures.ts`), at its six-column table;
 * `page-table-full` that table full screen (its ⤢).
 */
const NAMES = ['search', 'search-typed', 'search-type', 'search-none', 'page', 'page-lower', 'card', 'card-file', 'card-invalid', 'page-offline', 'page-online', 'page-tricks', 'page-cards', 'search-tree', 'search-clear', 'page-drawing', 'search-found', 'page-copied', 'page-copy-by-hand', 'page-last', 'card-next', 'page-code', 'search-favorites', 'search-focus', 'search-ids', 'search-recent', 'page-comments', 'search-collapsed', 'page-tables', 'page-table-full', 'page-folder', 'page-jump', 'page-links', 'page-linked-from', 'page-pills', 'page-tools', 'page-find', 'page-headings', 'page-properties'] as const
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

export async function mountReaderFixture(root: Root, name: ReaderFixture): Promise<void> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  const extra: Record<string, string | Uint8Array> =
    name === 'page-tricks'
      ? { 'Parser tricks.md': `---\ntitle: Parser tricks\n---\n# Parser tricks\n\n${TRICKS}\n\nAfter the comment.\n` }
      : name === 'page-cards' || name === 'search-tree' || name === 'search-found' || name === 'search-collapsed'
        ? { 'travel/Rivers of Europe.md': `---\ntitle: Rivers of Europe\n---\n\n${THREE_CARDS}\n`, 'travel/2026/Madrid days.md': '---\ntitle: Madrid days\n---\n\nDay one.\n' }
        : name === 'page-code'
          ? { 'Code notes.md': `---\ntitle: Code notes\n---\n\n${CODE_PAGE}\n` }
        : name === 'page-tables' || name === 'page-table-full'
          ? { 'Table shapes.md': `---\ntitle: Table shapes\n---\n\n${TABLE_PAGE}\n` }
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
          : name === 'page-properties'
            ? {
                'Trip notes.md':
                  '---\ntitle: Trip notes\nid: DEMO-8\nstatus: Planning\ndue: 2026-12-01\nstarts: 2026-12-01T09:30\nbudget: 1250.5\nbooked: true\npacked: false\ntags: [spain, trains]\nsee: "[[Trip plan]]"\nnote: Read [[Café notes]] first\naliases: [Viaje]\n---\n\nThe notes.\n',
              }
          : name === 'page-pills'
            ? {
                '.yaseendocs/link-pills.json': JSON.stringify({ version: 2, format: '{name} · {id}', box: { shape: 'underline' }, parts: { id: { bold: true } } }),
                '.yaseendocs/text-formatting.json': JSON.stringify({ version: 1, h1: { size: 30 }, h2: { underline: true } }),
              }
          : name === 'page-jump' || name === 'page-headings'
            ? { 'Long notes.md': `---\ntitle: Long notes\n---\n\n${Array.from({ length: 60 }, (_, i) => `## Part ${i + 1}\n\nA line of made-up notes for part ${i + 1}.`).join('\n\n')}\n` }
          : name === 'page-folder'
            ? { 'git/Merge.md': '---\ntitle: Merge\n---\n\nMerge notes.\n', 'git/deep/Rebase.md': '---\ntitle: Rebase\n---\n\nRebase notes.\n' }
          : name === 'page-drawing'
            ? DRAWING_FILES
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
  const services: AppServices = { store, tokens, sync: fakeSync(), friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: refuseAll, ...(name === 'page-online' && { media: online }), ...(name === 'page-drawing' && { media: typedMedia }) }
  root.render(<App services={services} />)
  await until(() => document.querySelector('[role="tab"]') !== null)
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
  switch (name) {
    case 'page-copied':
    case 'page-copy-by-hand':
      fakeClipboard(name === 'page-copied')
      if (!/Git cheat sheet/.test(document.querySelector('.tree')?.textContent ?? '')) {
        press(/^git, folder/)
        await wait(80)
      }
      await open(/^Git cheat sheet/, '.reader__body')
      press(/Copy the path$/)
      await until(() => document.querySelector('.page-toast') !== null)
      break
    case 'page-jump': {
      await typed('long notes')
      await open(/^Long notes/, '.reader__body h2')
      const screen = document.querySelector<HTMLElement>('.screen--reader')
      if (screen !== null) screen.scrollTop = 600
      await until(() => document.querySelector('.scroll-jump[data-on]') !== null)
      break
    }
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
      await typed('long notes')
      await open(/^Long notes/, '.reader__body h2')
      press('Page tools')
      await wait(50)
      press(/Headings/)
      await until(() => document.querySelector('.headings-sheet__row') !== null)
      break
    case 'page-properties':
      await typed('trip notes')
      await open(/^Trip notes/, '.reader__body p')
      press('Properties')
      await until(() => document.querySelector('.props__panel[data-shown]') !== null)
      await wait(300)
      break
    case 'page-pills':
      await open(/^Spanish words/, '.reader__body h1')
      break
    case 'page-links':
      await typed('links')
      await open(/^Links/, '.reader__body h1')
      break
    case 'page-linked-from':
      await typed('trip plan')
      await open(/^Trip plan/, '.linked-from')
      press(/^Linked from/)
      await until(() => document.querySelectorAll('.linked-from__line').length >= 2)
      document.querySelector('.linked-from')?.scrollIntoView({ block: 'start' })
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
    case 'page-comments':
      await open(/^Review notes/, '.page-comments')
      document.querySelector('.page-comments')?.scrollIntoView({ block: 'start' })
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
  await wait(100)
  document.documentElement.dataset.fixtureReady = name
}
