import type { Root } from 'react-dom/client'
import { dailyPageName } from '@shared/dailyPage'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import { fakeFriends, fakeScanner, fakeSync } from '../dev/fakes'
import { READER_FILES, READER_NOT_STORED, seedReaderVault } from '../dev/readerVault'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'

/**
 * The Today button's fixtures (YAZ-5470), on the made-up vault of `readerVault.ts` with Daily pages on (`Journal`,
 * `MMM D, YYYY`). Only a `--mode fixtures` build has this file. Nothing calls GitHub. The days are the phone's own.
 *  - `today`: the tab bar with "Today" right of Search;
 *  - `today-open`: after a tap, today's page;
 *  - `today-latest`: no page for today: the tap opens the one of 2 days ago (3 days ago is older);
 *  - `today-none`: no daily page at all: the short line.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(done: () => boolean, ms = 3000): Promise<void> {
  for (const end = Date.now() + ms; !done() && Date.now() < end; ) await wait(20)
}

export async function mountTodayFixture(root: Root, name: string): Promise<void> {
  const format = 'MMM D, YYYY'
  const day = (back: number) => dailyPageName(format, new Date(Date.now() - back * 86_400_000))
  const days: Record<string, string> =
    name === 'today-none'
      ? {}
      : {
          ...(name !== 'today-latest' && { [`Journal/${day(0)}.md`]: `# ${day(0)}\n\n- Water the made-up plants\n- Call the demo shop\n` }),
          [`Journal/${day(2)}.md`]: `# ${day(2)}\n\n- A made-up walk in the park\n`,
          [`Journal/${day(3)}.md`]: `# ${day(3)}\n\n- Demo notes\n`,
        }
  const files = { ...READER_FILES, ...days, '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: true, folder: 'Journal', format, dayFolder: false }) }
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  await seedReaderVault(store, tokens, files, READER_NOT_STORED)
  const services: AppServices = { store, tokens, sync: fakeSync(), friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: async () => new Response('{}', { status: 401 }) }
  root.render(<App services={services} />)
  await until(() => document.querySelector('.tabbar__today') !== null)
  if (name !== 'today') {
    document.querySelector<HTMLButtonElement>('.tabbar__today')?.click()
    await until(() => document.querySelector('.toast, .screen--reader') !== null)
    await wait(400)
  }
  document.documentElement.dataset.fixtureReady = name
}
