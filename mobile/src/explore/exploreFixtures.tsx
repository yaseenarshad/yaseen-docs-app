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
 *  - `explore-stack`: three sheets over Search: a page, a card file, a page (the vault says "explore").
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
  await seedReaderVault(store, tokens, name === 'explore-one' ? READER_FILES : { ...READER_FILES, '.yaseendocs/link-click.json': '{"click":"explore"}' })
  const services: AppServices = { store, tokens, sync: fakeSync(), friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: refuseAll }
  root.render(<App services={services} />)
  await until(() => document.querySelector('[role="tab"]') !== null)
  press(/^Search$/)
  await until(() => document.querySelector('.tree') !== null)
  await wait(200)
  if (name === 'explore-one') {
    press(/^Spanish words/)
    await until(() => document.querySelector('.reader__body h1') !== null)
    openSheet({ kind: 'page', path: 'Trip plan.md' })
    await until(() => /Madrid, May 3/.test(topText()))
  } else {
    openSheet({ kind: 'page', path: 'Spanish words.md' })
    await until(() => /Words for a trip/.test(topText()))
    openSheet({ kind: 'card', path: 'cards/capital-of-spain-demo-40.md', id: 'DEMO-40' })
    await until(() => /Manzanares/.test(topText()))
    openSheet({ kind: 'page', path: 'Trip plan.md' })
    await until(() => /Madrid, May 3/.test(topText()))
  }
  // The slide up and the counts.
  await wait(700)
  document.documentElement.dataset.fixtureReady = name
}
