import type { Root } from 'react-dom/client'
import { App } from '../App'
import { answersSetup } from '../answers/testing'
import type { AppServices } from '../app/AppState'
import { fakeFriends, fakeScanner, fakeSync } from '../dev/fakes'
import type { VaultMedia } from '../media/ui/vaultMedia'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { VECTORS } from './testing'

/**
 * YAZ-5242: the attack fixture for headless Chrome (`#fixture=attack-review`): Review on a made-up vault whose one card
 * holds all 90 vectors on its front and its back. The fixture shows both sides and taps each Play button; a net log of
 * the browser then says if any request left for another host. Only the `--mode fixtures` build has this file.
 */
const ATTACK = VECTORS.join('\n\n')
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mountAttackFixture(root: Root): Promise<void> {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  const t = await answersSetup({ files: { '.yaseendocs/review.json': '{"newPerDay": 10}', 'attack.md': `---\ntitle: Attack\n---\n\n${block(`${ATTACK}\n---\n${ATTACK}`, 'DEMO-90')}\n` } })
  const media: VaultMedia = { show: async (path) => ({ status: 'missing', path, why: 'offline' }) }
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  await tokens.write(VAULT, 'github_pat_11FIXTURE0' + 'f'.repeat(72))
  await saveVaultList(store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 1 }], open: VAULT })
  const sync = fakeSync()
  sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  const services: AppServices = { store, tokens, sync, media, friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: async () => new Response('{}', { status: 401 }) }
  root.render(<App services={services} />)
  await wait(800)
  // Show every hidden word and side, then tap each Play.
  for (let i = 0; i < 6; i++) {
    document.querySelector<HTMLElement>('.review__card')?.click()
    await wait(60)
  }
  for (const play of document.querySelectorAll<HTMLButtonElement>('.card__audio-play')) play.click()
  // A tap on each link (a web link opens a new tab, which the net log also sees).
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.review__card a')) a.click()
  await wait(800)
  document.body.dataset.attackCards = String(document.querySelectorAll('.review__card .card__sides').length)
  document.documentElement.dataset.fixtureReady = 'attack-review'
}
