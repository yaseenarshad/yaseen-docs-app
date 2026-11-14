import type { Root } from 'react-dom/client'
import { App } from '../App'
import { answersSetup } from '../answers/testing'
import type { AppServices } from '../app/AppState'
import { fakeFriends, fakeScanner, fakeSync } from '../dev/fakes'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import type { VaultMedia } from '../media/ui/vaultMedia'

/**
 * The Review tab's screen fixtures (4B), for the screenshots: `#fixture=review-…`. Made-up data only: the REAL engine
 * and answer list on the fake GitHub (no network), the real app around them. Only the `--mode fixtures` build has it.
 */
const block = (text: string, line: string, fence = '```') => `${fence}card\n${text}\n${fence}\n<!-- card: ${line} -->`
const page = (title: string, ...cards: string[]) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${cards.join('\n\n')}\n`
const DUE = '2026-10-02T09:00Z good, 2026-10-12T09:00Z good'

const FILES: Record<string, string> = {
  '.yaseendocs/review.json': '{"newPerDay": 10}',
  'spanish-words.md': page(
    'Spanish words',
    block('What does "la biblioteca" mean?\n---\nThe {{library}}. A bookshop is "la {{librería}}".', `DEMO-12, ${DUE}`),
    block('Hola\n---\n{{Hello}}', 'DEMO-13'),
    block('Verbs: ser\n\n| | ser |\n| -- | -- |\n| yo | {{soy}} |\n| tú | {{eres}} |\n| él | {{es}} |', 'DEMO-14, next'),
  ),
  'git-cheat-sheet.md': page(
    'Git cheat sheet',
    block('What does git pull do?\n---\nIt {{fetches}} and then {{merges}}.', `DEMO-38, ${DUE}`),
    block('What prints?\n\n```js\nconsole.log([1, 2, 3].map((n) => n * 2))\n```\n---\n{{[2, 4, 6]}}', 'DEMO-39', '````'),
  ),
  'cards/speed-of-light.md': `---\nkind: card\ntitle: Speed of light\n---\n\n${block('How fast is light?\n---\nAbout {{300,000 km}} each second.', 'DEMO-40')}\n`,
  'birds.md': page('Birds', block('Which bird is this?\n\n![a robin](robin.png)\n---\nA {{robin}}.', 'DEMO-41'), block('Which bird sings this?\n\n![[blackbird.mp3]]\n---\nA {{blackbird}}.', 'DEMO-42')),
  'robin.png': 'made-up picture bytes',
  'blackbird.mp3': 'made-up sound bytes',
  'history.md': page(
    'History',
    block(
      `The long card\n\n${Array.from({ length: 30 }, (_, i) => `${i + 1}. A long line of made-up notes about the history of the printing press, line ${i + 1}.`).join('\n')}\n---\nThe press came to Europe in about {{1450}}.`,
      'DEMO-50',
    ),
  ),
}

/** A made-up robin: a small picture drawn as a data URL. */
const ROBIN = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#e9eef5"/><circle cx="120" cy="78" r="38" fill="#7a5a43"/><circle cx="106" cy="86" r="22" fill="#d8642b"/><circle cx="134" cy="62" r="5" fill="#222"/></svg>')}`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const press = (name: string | RegExp) => {
  const el = [...document.querySelectorAll<HTMLElement>('button, a')].find((b) => {
    const n = (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim()
    return typeof name === 'string' ? n === name : name.test(n)
  })
  el?.click()
}
const tap = () => document.querySelector<HTMLElement>('.review__card')?.click()

export async function mountReviewFixture(root: Root, name: string): Promise<void> {
  const files = name === 'review-done' ? { '.yaseendocs/review.json': '{"newPerDay": 2}', 'p.md': page('Spanish words', ...Array.from({ length: 5 }, (_, i) => block(`Card ${i + 1}?\n---\n{{answer}}`, `DEMO-${i + 1}`))) } : FILES
  const step = (n: string) => void (document.body.dataset.fixtureStep = n)
  step('setup')
  // The fake GitHub runs in this one tab: no Web Lock, as in the tests (Node has none).
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  const t = await answersSetup({ files })
  step('engine')
  if (name === 'review-offline') t.s.github.offline = true
  const media: VaultMedia = {
    show: async (path) => (path.endsWith('.png') && name !== 'review-offline' ? { status: 'ready', path, url: ROBIN, type: 'image/svg+xml' } : { status: 'missing', path, why: 'offline' }),
  }
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  await tokens.write(VAULT, 'github_pat_11FIXTURE0' + 'f'.repeat(72))
  const vault = { repo: REPO, branch: BRANCH, addedAt: 1 }
  await saveVaultList(store, { vaults: [vault], open: VAULT })
  const sync = fakeSync()
  sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store, media })
  const services: AppServices = { store, tokens, sync, friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: async () => new Response('{}', { status: 401 }) }
  root.render(<App services={services} />)
  step('render')
  await wait(400)

  switch (name) {
    case 'review-shown':
      tap()
      await wait(30)
      tap()
      break
    case 'review-filter':
      press(/^All cards/)
      break
    case 'review-more':
      press('Remembered')
      await wait(80)
      press('More card actions')
      break
    case 'review-table':
      // Up next goes first: DEMO-14, the table.
      tap()
      break
    case 'review-code':
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      await wait(60)
      press('Remembered')
      await wait(60)
      tap()
      break
    case 'review-picture':
    case 'review-offline':
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      for (let i = 0; i < 4; i++) {
        await wait(60)
        press('Remembered')
      }
      break
    case 'review-long':
      press(/^All cards/)
      await wait(30)
      press(/^New cards/)
      for (let i = 0; i < 6; i++) {
        await wait(60)
        press('Remembered')
      }
      await wait(60)
      tap()
      break
    case 'review-done':
      for (let i = 0; i < 4; i++) {
        await wait(80)
        press('Remembered')
      }
      break
    case 'review-lost':
      press('Remembered')
      await wait(80)
      await t.s.git.push({ 'spanish-words.md': page('Spanish words', block('Hola\n---\n{{Hello}}', 'DEMO-13')) })
      await t.tick(5_000)
      break
  }
  await wait(300)
  document.documentElement.dataset.fixtureReady = name
}
