// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

// Checker round 2 probes for YAZ-5078 (4B): the 400 ms guard and VoiceOver. Made-up data only.

let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})

const OLD = '2026-10-04T09:00Z good'
const dueCards = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`Q${i + 1}?\n---\n{{w${i + 1}}}`, `DC-${i + 1}, ${OLD}`))
const ids = (hh: ReviewHarness) => hh.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id)
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const raw = async (hh: ReviewHarness, name: string) => {
  const b = hh.button(name)
  if (b === null) throw new Error(`no ${name}`)
  await act(async () => b.click())
  await hh.settle()
}
const guarded = (hh: ReviewHarness) => hh.host.querySelector('[data-guard]') !== null

/** The text a screen reader gets from the card box: role=img uses its label; aria-hidden is skipped. */
function spoken(el: Element): string {
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.nodeType === 3) return void out.push(n.textContent ?? '')
    if (!(n instanceof Element)) return
    if (n.getAttribute('aria-hidden') === 'true') return
    if ((n as HTMLElement).hidden || (n as HTMLElement).style?.display === 'none') return
    const role = n.getAttribute('role')
    if (role === 'img' || role === 'presentation') {
      const label = n.getAttribute('aria-label')
      if (label) out.push(` [${label}] `)
      return
    }
    n.childNodes.forEach(walk)
  }
  walk(el)
  return out.join('').replace(/\s+/g, ' ').trim()
}

describe('checker round 2: the 400 ms guard (YAZ-5226)', () => {
  it('G1: Undo within the guard brings the answered card back; after 1 s the card and the buttons still work', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(3)) })
    await raw(h, 'Remembered') // DC-1 answered, DC-2 shows; the guard runs
    console.log('[G1] after answer: head', h.head(), 'guard', guarded(h))
    await raw(h, 'Undo') // fast: inside the 400 ms
    console.log('[G1] after fast Undo: head', h.head(), 'guard', guarded(h))
    await real(1000)
    await h.settle()
    console.log('[G1] 1 s later: guard', guarded(h), 'head', h.head())
    const before = h.cardText()
    const card = h.host.querySelector<HTMLElement>('.review__card')!
    // (builder, YAZ-5266) The guard is checked BEFORE the next answer: right after an answer it is on again, by design.
    expect(guarded(h)).toBe(false)
    await act(async () => card.click())
    await h.settle()
    console.log('[G1] tap 1 s later: card', JSON.stringify(before), '->', JSON.stringify(h.cardText()))
    expect(h.cardText()).not.toBe(before)
    await raw(h, 'Remembered')
    console.log('[G1] Remembered 1 s later: answered', JSON.stringify(ids(h)))
    expect(ids(h)).toEqual(['DC-1'])
  })

  it('G2: a new card answered Forgot comes back as the only card: the guard ends', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Only?\n---\n{{one}}', 'NW-1')) })
    console.log('[G2] start head', h.head())
    await raw(h, 'Forgot')
    console.log('[G2] after Forgot: head', h.head(), 'guard', guarded(h), 'text', h.text().slice(0, 120))
    await real(1000)
    await h.settle()
    console.log('[G2] 1 s later: guard', guarded(h))
    expect(guarded(h)).toBe(false)
  })

  it('G3: a tap during the guard is dropped, never queued to land later', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(3)) })
    await raw(h, 'Remembered')
    await raw(h, 'Remembered')
    const card = h.host.querySelector<HTMLElement>('.review__card')!
    await act(async () => card.click())
    await real(1000)
    await h.settle()
    console.log('[G3] answered after 1 s:', JSON.stringify(ids(h)), 'card', JSON.stringify(h.cardText()))
    expect(ids(h)).toEqual(['DC-1'])
    expect(h.cardText()).not.toContain('w2')
  })

  it('G4: how long the guard holds after the next card shows (real time)', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(3)) })
    const b = h.button('Remembered')!
    const t0 = performance.now()
    await act(async () => b.click())
    let shown = -1
    let free = -1
    for (let i = 0; i < 400; i++) {
      await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
      if (shown < 0 && h.head().includes('DC-2')) shown = performance.now() - t0
      if (shown >= 0 && !guarded(h)) {
        free = performance.now() - t0
        break
      }
    }
    console.log(`[G4] next card shown at ${shown.toFixed(0)} ms; taps free at ${free.toFixed(0)} ms; guard after show ${(free - shown).toFixed(0)} ms`)
    expect(free - shown).toBeGreaterThanOrEqual(380)
  })

  it('G5: the answer write fails: the card stays; does the guard end?', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(2)) })
    const add = h.answers.add.bind(h.answers)
    ;(h.answers as { add: unknown }).add = async () => {
      throw new Error('the disk is full')
    }
    await raw(h, 'Remembered')
    console.log('[G5] after a failed answer: head', h.head(), 'guard', guarded(h), 'notice', h.host.querySelector('.review__notice')?.textContent)
    ;(h.answers as { add: unknown }).add = add
    await real(1000)
    await h.settle()
    console.log('[G5] 1 s later: guard', guarded(h))
    await raw(h, 'Remembered')
    console.log('[G5] answer again:', JSON.stringify(ids(h)))
    expect(ids(h)).toEqual(['DC-1'])
  })
})

describe('checker round 2: the stuck guard, ways out', () => {
  it('G6 (probe): after the fast Undo: does Up next or a filter change free it?', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(3)) })
    await raw(h, 'Remembered')
    await raw(h, 'Undo')
    await real(600)
    const tries: string[] = []
    await h.click('More card actions')
    await h.click('Up next')
    await real(600)
    tries.push(`Up next: guard ${guarded(h)} head ${h.head()}`)
    await h.click(/^All cards/)
    const due = h.button(/^Due today/)
    if (due) { await act(async () => due.click()); await h.settle() }
    await real(600)
    tries.push(`filter Due today: guard ${guarded(h)} head ${h.head()}`)
    console.log('[G6] ' + tries.join(' | '))
  })
})

describe('checker round 2: VoiceOver (YAZ-5229)', () => {
  it('V1: three hidden words: the order of reading; nothing hidden is exposed before it shows', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Name three: {{alpha}}, {{beta}} and {{gamma}}.', `VO-3, ${OLD}`)) })
    const box = h.host.querySelector('.review__card')!
    const live = () => h!.host.querySelector('[aria-live]')?.textContent ?? ''
    const order = [...h.host.querySelectorAll('.review *')].filter((e) => e.matches('.review__card, button, [aria-live]')).map((e) => (e.matches('.review__card') ? 'CARD' : e.matches('[aria-live]') ? 'LIVE' : (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))
    console.log('[V1] reading order:', JSON.stringify(order))
    const steps: string[] = []
    steps.push(`0: ${spoken(box)} | live "${live()}" | html has words: ${['alpha', 'beta', 'gamma'].filter((w) => box.innerHTML.includes(w)).join(',')}`)
    for (let i = 1; i <= 3; i++) {
      await h.click('Show the next part')
      await real(10)
      await h.settle()
      steps.push(`${i}: ${spoken(box)} | live "${live()}" | html has words: ${['alpha', 'beta', 'gamma'].filter((w) => box.innerHTML.includes(w)).join(',')}`)
    }
    console.log('[V1]\n  ' + steps.join('\n  '))
    console.log('[V1] last button:', h.button(/fully shown|next part/)?.textContent, 'disabled', h.button(/fully shown|next part/)?.disabled)
    console.log('[V1] answer buttons:', JSON.stringify([...h.host.querySelectorAll('.review__answers button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)))
    expect(spoken(box)).toContain('alpha') // all shown now
    expect(steps[0].split(' | ')[0]).not.toMatch(/alpha|beta|gamma/)
  })

  it('V2: two sides, the front with a hidden word: the step to the back says the back, not the old word', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Front {{one}}\n---\nThe back side', `VO-2, ${OLD}`)) })
    const box = h.host.querySelector('.review__card')!
    const live = () => h!.host.querySelector('[aria-live]')?.textContent ?? ''
    console.log('[V2] start:', spoken(box), '| back in DOM before shown:', box.innerHTML.includes('back side'))
    await h.click('Show the next part')
    await real(10)
    await h.settle()
    const l1 = live()
    await h.click('Show the next part')
    await real(10)
    await h.settle()
    const l2 = live()
    console.log(`[V2] live after step 1: "${l1}"; after step 2 (the back): "${l2}"; spoken: ${spoken(box)}`)
    expect(l2).toContain('back side')
  })

  it('V3: the ⋯ menu, the lost line and its confirm, as a screen reader names them', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(2)) })
    await h.click('More card actions')
    const menu = [...h.host.querySelectorAll('[role="menu"] *, .review__menu button')].filter((e) => e.matches('button, [role="menuitem"]')).map((e) => `${e.getAttribute('role') ?? e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim()}`)
    const more = h.button('More card actions')
    console.log('[V3] ⋯ items:', JSON.stringify(menu), '| ⋯ aria-expanded', more?.getAttribute('aria-expanded'), 'haspopup', more?.getAttribute('aria-haspopup'))
    await h.click('More card actions')
    await h.click('Remembered')
    await h.s.git.push({ 'p.md': page('P', dueCards(2)[1]) })
    await h.wait(5_000)
    const lost = h.host.querySelector('.review__lost')
    console.log('[V3] lost line role', lost?.getAttribute('role'), '| spoken:', lost === null ? null : spoken(lost))
    const discard = [...h.host.querySelectorAll('.review__lost button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)
    console.log('[V3] lost buttons:', JSON.stringify(discard))
    const d = h.host.querySelector<HTMLButtonElement>('.review__lost button')
    if (d) {
      await act(async () => d.click())
      await h.settle()
      const dlg = document.querySelector('[role="dialog"], [role="alertdialog"], dialog')
      console.log('[V3] confirm:', dlg?.getAttribute('role') ?? dlg?.tagName, '| label', dlg?.getAttribute('aria-label') ?? dlg?.getAttribute('aria-labelledby'), '| text', (dlg?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200), '| focus', document.activeElement?.textContent)
    }
  })
})
