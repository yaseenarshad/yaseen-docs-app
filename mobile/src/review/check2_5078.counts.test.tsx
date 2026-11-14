// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { waitingCount } from '../status/dot'
import { NOW, cardBlock, page } from './testing'

// Checker round 2: the Review tab, the dot and the sheet give the same counts at every step of a 20-action script.

let h: Harness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})
const OLD = '2026-10-04T09:00Z good'
const cards = (ids: number[]) => ids.map((i) => cardBlock(`Q${i}?\n---\n{{w${i}}}`, `CT-${i}, ${OLD}${i === 3 ? ', next' : ''}`))
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('checker round 2: counts agree (YAZ-5227)', () => {
  it('C1: tab, dot and sheet: lost answers and waiting answers by group, after each of 20 actions', async () => {
    const t = await answersSetup({ files: { '.yaseendocs/review.json': '{}', 'a.md': page('A', ...cards([1, 2, 3])), 'b.md': page('B', ...cards([4, 5, 6])) } })
    await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
    h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
    await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
    h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
    await h.click('Settings') // the dot mounts again and reads the list (the fake sync had no review() at the first mount)
    await h.click('‹ Back')
    await h.click('Search')
    await h.click('Review')
    for (let i = 0; i < 30 && !h.text().includes('CT-'); i++) await h.settle()
    const seen = async () => {
      for (let i = 0; i < 40 && h.host.querySelector('[data-guard]') !== null; i++) await real(20)
      await h.settle()
    }
    const press = async (name: string | RegExp) => {
      await seen()
      if (h.button(name) === null) return `(no ${name})`
      await h.click(name)
      await h.settle()
      return ''
    }
    const send = async () => {
      await act(async () => {
        await t.tick(5_000)
      })
      for (let i = 0; i < 4; i++) await h.settle()
    }
    const read = async () => {
      const dot = h.host.querySelector('.sync-status')?.getAttribute('aria-label') ?? ''
      const tabTitle = h.host.querySelector('.review__lost-title')?.textContent ?? ''
      const tabRows = h.host.querySelectorAll('.review__lost-row').length
      await h.click(/^Sync status/)
      const sheet = [...document.querySelectorAll('[role="dialog"] .row')].length
      const close = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => /close|done/i.test(b.textContent ?? b.getAttribute('aria-label') ?? ''))
      if (close) await act(async () => close.click())
      else await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      await h.settle()
      const lostN = Number(/(\d+) answers? could not/.exec(dot)?.[1] ?? 0)
      const waitN = Number(/(\d+) answers? waiting/.exec(dot)?.[1] ?? 0)
      const tabN = Number(/^(\d+)/.exec(tabTitle)?.[1] ?? 0)
      return { dot, lostN, waitN, tabN, tabRows, sheet, groups: waitingCount(t.answers.waiting()), lostList: t.answers.state().lost.length }
    }
    const actions: [string, () => Promise<string | void>][] = [
      ['Remembered', () => press('Remembered')],
      ['Forgot', () => press('Forgot')],
      ['Undo', () => press('Undo')],
      ['⋯ Up next', async () => (await press('More card actions')) + (await press(/^(Up next|Remove from Up next)$/))],
      ['send', send],
      ['Remembered', () => press('Remembered')],
      ['delete a.md on GitHub', async () => void (await t.s.git.push({ 'a.md': page('A') }))],
      ['send', send],
      ['Remembered', () => press('Remembered')],
      ['⋯ Fix later', async () => (await press('More card actions')) + (await press(/^(Fix later|Remove Fix later)$/))],
      ['send', send],
      ['Undo', () => press('Undo')],
      ['delete b.md on GitHub', async () => void (await t.s.git.push({ 'b.md': page('B', cards([6])[0]) }))],
      ['Remembered', () => press('Remembered')],
      ['send', send],
      ['Discard first lost', async () => {
        const d = h.host.querySelector<HTMLButtonElement>('.review__lost button')
        if (!d) return '(no discard)'
        await act(async () => d.click())
        await h.settle()
        const yes = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === 'Discard answer')
        if (yes) await act(async () => yes.click())
        await h.settle()
      }],
      ['Remembered', () => press('Remembered')],
      ['Forgot', () => press('Forgot')],
      ['send', send],
      ['Undo', () => press('Undo')],
    ]
    const rows: string[] = []
    let bad = 0
    for (const [i, [name, run]] of actions.entries()) {
      const note = (await run()) ?? ''
      const r = await read()
      const agree = r.lostN === r.tabN && (r.lostN === 0 || r.tabRows === r.lostN) && (r.lostN > 0 ? r.lostN : r.waitN) <= Math.max(r.sheet, r.lostN, r.waitN) && (r.lostN > 0 || r.waitN === r.groups)
      if (!agree) bad++
      rows.push(`${String(i + 1).padStart(2)} ${name.padEnd(22)} ${note} dot="${r.dot.replace('Sync status: ', '')}" tab=${r.tabN}/${r.tabRows} rows sheet=${r.sheet} rows; groups waiting=${r.groups}, lost actions=${r.lostList} ${agree ? 'OK' : 'DIFFER'}`)
    }
    console.log('[C1]\n' + rows.join('\n'))
    expect(bad).toBe(0)
  })
})
