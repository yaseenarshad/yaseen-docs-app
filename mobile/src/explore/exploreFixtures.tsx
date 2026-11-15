import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import type { FetchLike } from '../github/client'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { fakeFriends, fakeScanner, fakeSync } from '../dev/fakes'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { openSheet } from './sheets'

/**
 * The screen fixtures of Explore on the phone (YAZ-5472), on the made-up vault of `readerVault.ts`:
 *  - `explore-one`: a page full screen ("Spanish words"), with one sheet over it ("Trip plan");
 *  - `explore-stack`: a Search row opens "Spanish words" as a FULL PAGE (YAZ-5472 Q4: a tab screen's first open), then
 *    three sheets over it: a card file, a page, a page (the vault says "explore");
 *  - `explore-review`: one sheet over Review (a card), and `explore-today`: the Today button opens today's daily page
 *    full screen (Q4), and a link in it opens a sheet (YAZ-5518: Safari's Back in a tab closes the sheet, then the page).
 * Only a `--mode fixtures` build has this file. Nothing calls GitHub.
 */
const refuseAll: FetchLike = async () => new Response('{}', { status: 401 })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(done: () => boolean, ms = 4000): Promise<void> {
  for (const end = Date.now() + ms; !done() && Date.now() < end; ) await wait(20)
}
const press = (name: RegExp) => [...document.querySelectorAll<HTMLElement>('button, a')].find((b) => name.test((b.getAttribute('aria-label') ?? b.textContent ?? '').trim()))?.click()
const topText = () => document.querySelector('.explore-sheet:last-of-type .explore-sheet__body')?.textContent ?? ''

export async function mountExploreFixture(root: Root, name: string): Promise<void> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  // `explore-one` opens its page full screen first (a vault with no link-click file); `explore-stack`'s vault says "explore".
  // Today's daily page, by this machine's day (the Today button opens today's, else the latest before it).
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const daily = { '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }), [`Daily/${day}.md`]: '# Made-up day\n\nToday words. See [[Trip plan]].\n' }
  const explore = { ...READER_FILES, '.yaseendocs/link-click.json': '{"click":"explore"}', ...(name === 'explore-today' && daily) }
  await seedReaderVault(store, tokens, name === 'explore-one' ? READER_FILES : explore)
  const services: AppServices = { store, tokens, sync: fakeSync(), friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: refuseAll }
  root.render(<App services={services} />)
  await until(() => document.querySelector('[role="tab"]') !== null)
  if (name === 'explore-review') {
    press(/^Review$/)
    await wait(300)
    openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' })
    await until(() => /Manzanares/.test(topText()))
    await wait(700)
    document.documentElement.dataset.fixtureReady = name
    return
  }
  press(/^Search$/)
  await until(() => document.querySelector('.tree') !== null)
  await wait(200)
  if (name === 'explore-today') {
    await until(() => document.querySelector('.tabbar__today') !== null)
    document.querySelector<HTMLElement>('.tabbar__today')?.click()
    await until(() => /Today words/.test(document.querySelector('.reader__body')?.textContent ?? ''))
    await wait(200)
    ;[...document.querySelectorAll<HTMLElement>('.reader__body a, .reader__body [data-open]')].find((a) => /Trip plan/.test(a.textContent ?? ''))?.click()
    await until(() => /Madrid, May 3/.test(topText()))
  } else if (name === 'explore-one') {
    press(/^Spanish words/)
    await until(() => document.querySelector('.reader__body h1') !== null)
    openSheet({ kind: 'page', path: 'Trip plan.md' })
    await until(() => /Madrid, May 3/.test(topText()))
  } else {
    press(/^Spanish words/)
    await until(() => /Words for a trip/.test(document.querySelector('.reader__body')?.textContent ?? ''))
    openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' })
    await until(() => /Manzanares/.test(topText()))
    openSheet({ kind: 'page', path: 'Trip plan.md' })
    await until(() => /Madrid, May 3/.test(topText()))
    openSheet({ kind: 'page', path: 'Spanish words.md' })
    await until(() => /Words for a trip/.test(topText()))
  }
  // The slide up and the counts.
  await wait(700)
  document.documentElement.dataset.fixtureReady = name
}
