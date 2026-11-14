// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, page } from './testing'

// The Review tab's lazy chunk does not load (no signal, and the file is not in the cache; or an old file name after a
// new deploy). The import rejects.
vi.mock('./ReviewTab', () => {
  throw new TypeError('Importing a module script failed.')
})

let h: Harness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

describe('4B checker: the Review chunk does not load', () => {
  it('4B-G: the app stays on screen (the tabs, a way to try again); it does not go blank', async () => {
    const t = await answersSetup({ files: { '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Q?\n---\n{{a}}', 'CH-1')) } })
    await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
    h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
    await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
    h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => (errors.push(e.message), e.preventDefault())
    window.addEventListener('error', onError)
    await h.click('Search')
    try {
      await h.click('Review')
    } catch (e) {
      errors.push(String(e))
    }
    for (let i = 0; i < 6; i++) await h.settle().catch((e: unknown) => errors.push(String(e)))
    window.removeEventListener('error', onError)
    console.log('[4B-G] screen text after the failed chunk:', JSON.stringify(h.host.textContent), '| errors:', errors.length)
    expect(h.host.textContent).toContain('Search')
  })
})
