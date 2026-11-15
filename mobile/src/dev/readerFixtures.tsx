import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import type { FetchLike } from '../github/client'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { fakeFriends, fakeScanner, fakeSync } from './fakes'
import { READER_FILES, READER_NOT_STORED, cardBlock, seedReaderVault } from './readerVault'
import { fileType, storedMedia, type VaultMedia } from '../media/ui/vaultMedia'

/**
 * The screen fixtures of 4C (YAZ-5079): Search, a page and a card on the made-up vault of `readerVault.ts`, for the
 * screenshots (`#fixture=page`). Only a `--mode fixtures` build has this file. Nothing calls GitHub.
 */
const NAMES = ['search', 'search-typed', 'search-type', 'search-none', 'page', 'page-lower', 'card', 'card-file', 'card-invalid', 'page-offline', 'page-online', 'page-tricks', 'page-cards', 'search-tree', 'search-clear', 'search-found'] as const
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

export async function mountReaderFixture(root: Root, name: ReaderFixture): Promise<void> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  const extra: Record<string, string> =
    name === 'page-tricks'
      ? { 'Parser tricks.md': `---\ntitle: Parser tricks\n---\n# Parser tricks\n\n${TRICKS}\n\nAfter the comment.\n` }
      : name === 'page-cards' || name === 'search-tree' || name === 'search-found'
        ? { 'travel/Rivers of Europe.md': `---\ntitle: Rivers of Europe\n---\n\n${THREE_CARDS}\n`, 'travel/2026/Madrid days.md': '---\ntitle: Madrid days\n---\n\nDay one.\n' }
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
  const services: AppServices = { store, tokens, sync: fakeSync(), friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: refuseAll, ...(name === 'page-online' && { media: online }) }
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
