import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import type { FetchLike } from '../github/client'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { fakeFriends, fakeScanner, fakeSync } from './fakes'
import { READER_FILES, READER_NOT_STORED, cardBlock, seedReaderVault } from './readerVault'
import { DRAWING_FILES } from './drawingVault'
import { fileType, storedMedia, type VaultMedia } from '../media/ui/vaultMedia'

/**
 * The screen fixtures of 4C (YAZ-5079): Search, a page and a card on the made-up vault of `readerVault.ts`, for the
 * screenshots (`#fixture=page`). Only a `--mode fixtures` build has this file. Nothing calls GitHub.
 */
const NAMES = ['search', 'search-typed', 'search-type', 'search-none', 'page', 'page-lower', 'card', 'card-file', 'card-invalid', 'page-offline', 'page-online', 'page-tricks', 'page-cards', 'search-tree', 'search-clear', 'page-drawing', 'search-found', 'page-comments'] as const
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
      : name === 'page-cards' || name === 'search-tree' || name === 'search-found'
        ? { 'travel/Rivers of Europe.md': `---\ntitle: Rivers of Europe\n---\n\n${THREE_CARDS}\n`, 'travel/2026/Madrid days.md': '---\ntitle: Madrid days\n---\n\nDay one.\n' }
        : name === 'page-drawing'
          ? DRAWING_FILES
          : name === 'page-comments'
            ? { 'Review notes.md': COMMENTED }
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
  switch (name) {
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
    case 'search-found':
      // YAZ-5447: the matches in the tree: a page two folders down, a card under its page, the typed text marked.
      await typed('madrid')
      break
    case 'search-clear':
      document.querySelector<HTMLInputElement>('input[name="search"]')?.focus()
      await typed('spa')
      break
    case 'page-comments':
      await open(/^Review notes/, '.page-comments')
      document.querySelector('.page-comments')?.scrollIntoView({ block: 'start' })
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
  await wait(100)
  document.documentElement.dataset.fixtureReady = name
}
