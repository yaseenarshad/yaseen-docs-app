// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { GOOD, mount, signInWithForm, type Harness } from '../screens/testing'
import { NOW, cardBlock, page } from './testing'

/** 4B in the app: the Review tab replaces 4A's placeholder; "Open page" opens 4C's slot over the tabs; Back comes back. */
let h: Harness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

describe('the Review tab in the app shell', () => {
  it('waits for the engine calmly; then reviews; ⋯ › Open page opens the read-only slot; Back comes back to the card', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(h.text()).toContain('Reading your cards…') // a sync with no `review()` (4A's fake): the tab waits
    expect(h.text()).not.toContain('next build')

    const t = await answersSetup({ files: { '.yaseendocs/review.json': '{}', 'spanish.md': page('Spanish words', cardBlock('Hola?\n---\n{{Hello}}', 'TB-1')) } })
    h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
    await h.click('Search')
    await h.click('Review')
    for (let i = 0; i < 5 && !h.text().includes('TB-1'); i++) await h.settle()
    expect(h.text()).toContain('Hola? · TB-1 · in Spanish words')

    await h.click('More card actions')
    await h.click('Open page')
    expect(h.text()).toContain('The page opens here in the next build.')
    expect(h.text()).toContain('spanish')
    await h.click('‹ Back')
    for (let i = 0; i < 5 && !h.text().includes('TB-1'); i++) await h.settle()
    expect(h.text()).toContain('Hola? · TB-1 · in Spanish words')
  })
})
