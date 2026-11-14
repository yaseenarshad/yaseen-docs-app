// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, cardFile, page } from './testing'

// Checker round 2 probes for YAZ-5224 (the Review tab stays mounted). Made-up data only.

let h: Harness
let visible: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible })
const setVisible = async (state: DocumentVisibilityState) => {
  visible = state
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
}
const hostDivs: HTMLElement[] = []
const make = document.createElement.bind(document)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  hostDivs.length = 0
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: ElementCreationOptions) => {
    const el = make(tag, o)
    if (tag === 'div') hostDivs.push(el)
    return el
  }) as typeof document.createElement)
})
afterEach(() => {
  h?.unmount()
  visible = 'visible'
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete (navigator as { wakeLock?: unknown }).wakeLock
})

const FILES = {
  '.yaseendocs/review.json': '{}',
  'spanish.md': page('Spanish words', 'Words for a trip to Madrid. See [[light]] and [[other]].', cardBlock('Hola?\n---\n{{Hello}}', 'TB-1'), cardBlock('Adios?\n---\n{{Bye}} and {{so long}}', 'TB-3')),
  'cards/light.md': cardFile('Speed of light', cardBlock('How fast?\n---\n{{very}} {{fast}}', 'TB-2')),
}
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

async function app(files: Record<string, string> = FILES) {
  const t = await answersSetup({ files })
  await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
  h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
  await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
  h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  await h.click('Search')
  await h.click('Review')
  for (let i = 0; i < 30 && !h.text().includes('TB-'); i++) await h.settle()
  return t
}
const seen = async () => {
  for (let i = 0; i < 40 && h.host.querySelector('[data-guard]') !== null; i++) await real(20)
  await h.settle()
}
const state = () => ({ meta: h.host.querySelector('.review__meta')?.textContent, head: h.host.querySelector('.review__head')?.textContent, last: h.host.querySelector('.review__last')?.textContent, card: h.host.querySelector('.phone-card__body')?.textContent })
const many = async (n = 4) => {
  for (let i = 0; i < n; i++) await h.settle()
}
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 40 && !ok(); i++) await h.settle()
}

describe('checker round 2: the kept Review tab', () => {
  it('K1: off the screen the Review box is out of the document; nothing of it can take focus', async () => {
    await app()
    const reviewEl = h.host.querySelector('.review')!
    ;(h.button('Remembered') as HTMLButtonElement).focus()
    await h.click('Friends')
    console.log('[K1] .review in document:', document.contains(reviewEl), '| active element:', document.activeElement?.tagName, document.activeElement?.className)
    console.log('[K1] buttons in document named Remembered:', [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Remembered')).length)
    expect(document.contains(reviewEl)).toBe(false)
  })

  it('K2: the answer timer counts no time while a page is open, nor while on Friends', async () => {
    const t = await app()
    await h.click('Remembered') // TB-1; the next card shows at NOW
    await seen()
    const next = state().head
    vi.setSystemTime(NOW + 5_000)
    await h.click('More card actions')
    await h.click(/^Open (page|card)$/)
    await until(() => h.button('‹ Back') !== null)
    vi.setSystemTime(NOW + 105_000)
    await h.click('‹ Back')
    await many()
    vi.setSystemTime(NOW + 106_000)
    await h.click('Friends')
    vi.setSystemTime(NOW + 300_000)
    await h.click('Review')
    await many()
    vi.setSystemTime(NOW + 302_000)
    await h.click('Remembered')
    await many()
    const ops = t.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op)
    console.log('[K2] card', next, '| reviews:', JSON.stringify(ops.map((o) => o.kind === 'review' && [o.id, o.review.seconds])))
    const last = ops[ops.length - 1]
    expect(last.kind === 'review' && last.review.seconds).toBe(8)
  })

  it('K3: the Wake Lock is let go while a page or another tab shows, and taken again on return', async () => {
    const log: string[] = []
    let held = 0
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          held++
          log.push(`ask(held ${held})`)
          return { release: async () => void (held--, log.push(`release(held ${held})`)) }
        },
      },
    })
    await app()
    await many()
    const at = (s: string) => log.push(`-- ${s}: held ${held}`)
    at('on Review')
    await h.click('More card actions')
    await h.click(/^Open (page|card)$/)
    await many()
    at('page open')
    const onPage = held
    await h.click('‹ Back')
    await many()
    at('back')
    const back = held
    await h.click('Friends')
    await many()
    at('Friends')
    const friends = held
    await h.click('Review')
    await many()
    at('Review again')
    console.log('[K3] ' + log.join(' '))
    expect([onPage, back, friends, held]).toEqual([0, 1, 0, 1])
  })

  it('K4: background while a page is open; the chain page → card → page; then Back, Back, Back', async () => {
    await app()
    await h.click('Remembered') // TB-1 answered → TB-2 (card file)
    await seen()
    await h.click('Remembered') // TB-2 → TB-3 (in a page)
    await seen()
    const card = () => h.host.querySelector<HTMLElement>('.review__card')!
    await act(async () => card().click())
    await many()
    const before = state()
    console.log('[K4] before:', JSON.stringify(before))
    await h.click('More card actions')
    await h.click('Open page')
    await until(() => h.host.querySelector('[data-card-id="TB-3"]') !== null)
    await setVisible('hidden')
    await many()
    await setVisible('visible')
    await many()
    const steps: string[] = []
    const links = [...h.host.querySelectorAll<HTMLElement>('a, [data-card-link]')].map((a) => `${a.textContent}|${a.dataset.open}|${a.dataset.path}`)
    steps.push('links: ' + JSON.stringify(links))
    const link = h.host.querySelector<HTMLElement>('a[data-open="page"], a[data-open="card"]')
    if (link !== null) {
      await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
      await until(() => h.text().includes('How fast'))
      steps.push('second view: ' + h.text().slice(0, 60))
      const openPage = h.button('Open page')
      if (openPage !== null) {
        await h.click('Open page')
        await until(() => h.text().includes('Madrid'))
        steps.push('page again: ' + h.text().includes('Madrid'))
      }
    }
    for (let i = 0; i < 5 && h.button('‹ Back') !== null && h.host.querySelector('.review') === null; i++) {
      await h.click('‹ Back')
      await many(6)
      steps.push(`back ${i + 1}: review ${h.host.querySelector('.review') !== null}`)
    }
    const after = state()
    console.log('[K4] ' + steps.join(' | ') + '\n[K4] after:', JSON.stringify(after))
    expect(after).toEqual(before)
  })

  it('K5: a sync pass while Review is hidden changes the shown card on GitHub: back on Review', async () => {
    const t = await app()
    await h.click('Remembered')
    await seen()
    const card = () => h.host.querySelector<HTMLElement>('.review__card')!
    await act(async () => card().click())
    await many()
    const before = state()
    await h.click('Friends')
    // On the Mac: TB-2's back changes, and a new due card is added in front.
    await t.s.git.push({ 'cards/light.md': cardFile('Speed of light', cardBlock('How fast?\n---\n{{very}} {{quick}}', 'TB-2')), 'a-first.md': page('First', cardBlock('Newer?\n---\n{{n}}', 'TB-9, 2026-10-04T09:00Z good')) })
    await act(async () => {
      await t.engine.syncNow()
      await t.engine.idle()
    })
    await many()
    const idx = t.engine.index()
    console.log('[K5] engine has TB-9 now:', JSON.stringify(idx).includes('TB-9'), '| quick:', JSON.stringify(idx).includes('quick'))
    await h.click('Review')
    await many(6)
    console.log('[K5] before:', JSON.stringify(before), '\n[K5] after: ', JSON.stringify(state()))
  })

  it('K6: "Sign out and erase this phone": no card text is left in the Review box, and the box is empty', async () => {
    await app()
    await h.click('Remembered')
    await seen()
    const reviewHost = hostDivs.find((d) => d.className === 'review-host')!
    console.log('[K6] review host found:', reviewHost !== undefined, '| text before:', reviewHost?.textContent?.slice(0, 60))
    await h.click('Settings')
    await many()
    await h.click('Sign out and erase this phone')
    await many()
    await h.click('Erase this phone')
    for (let i = 0; i < 20 && !/Sign in|Repo/.test(h.text()); i++) await h.settle()
    await real(50)
    await many()
    console.log('[K6] screen after erase:', h.text().slice(0, 80))
    console.log('[K6] review host after erase: children', reviewHost.childNodes.length, 'text', JSON.stringify(reviewHost.textContent), '| in document', document.contains(reviewHost))
    const leftovers = ['Hola', 'Adios', 'How fast', 'Spanish words', 'TB-'].filter((w) => (document.body.innerHTML + reviewHost.innerHTML).includes(w))
    console.log('[K6] card words left in any DOM:', JSON.stringify(leftovers))
    expect(reviewHost.textContent).toBe('')
    expect(leftovers).toEqual([])
  })
})
