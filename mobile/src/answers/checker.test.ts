import { describe, expect, it } from 'vitest'
import { cardRecords } from '@shared/cardLine'
import { SEND_AFTER_MS } from '../sync/cadence'
import { BRANCH, VAULT, card, pageText } from '../sync/testing'
import { openOutbox } from './outbox'
import { DAYS_STATE, openPhoneDays, phoneReviewHost } from './reviewHost'
import { answer, answersSetup, at } from './testing'

// Checker probes for YAZ-5073 (round 1). Each 3C-x test names a bug; the others are probes that pass.

type Setup = Awaited<ReturnType<typeof answersSetup>>
const bytesAt = (t: Setup, path: string): Uint8Array => {
  const commit = t.s.git.commits.get(t.head())!
  return t.s.git.blobs.get(t.s.git.trees.get(commit.tree)!.get(path)!)!
}
const linesOf = (bytes: Uint8Array) => {
  const out: number[][] = [[]]
  for (const b of bytes) {
    out[out.length - 1].push(b)
    if (b === 0x0a) out.push([])
  }
  return out.map((l) => l.join(','))
}
const tick0 = () => new Promise((r) => setTimeout(r, 0))

describe('checker YAZ-5073: Undo and a send that already reached GitHub', () => {
  it('3C-A: Undo of an answer while its send is on the way to GitHub: GitHub must not keep the review', async () => {
    let release: () => void = () => {}
    let holding = false
    let hold = true
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        if ((init.method ?? 'GET') === 'PATCH' && hold) {
          hold = false
          holding = true
          await new Promise<void>((r) => (release = r))
        }
        return s.github.fetch(url, init)
      },
    })
    const days = await openPhoneDays(t.store, VAULT, t.clock.now)
    const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'v' })
    const R = { at: at(1), rating: 'good' as const }
    const next = await host.writeCardAnswer('a.md', 'NC-2', R)
    t.clock.advance(SEND_AFTER_MS) // the send starts 5 s after the answer
    for (let i = 0; i < 200 && !holding; i++) await tick0()
    expect(holding).toBe(true) // the commit is made; the ref move is on its way
    await host.undoCardAnswer('a.md', 'NC-2', R.at, next) // the person taps Undo now
    release()
    await t.answers.idle()
    await t.engine.idle()
    await t.tick(SEND_AFTER_MS * 2)
    // Expected: the person undid the answer, so GitHub (and the phone) end with no review.
    expect({ github: await t.remoteReviews(), phone: (await host.readCard('a.md', 'NC-2'))!.reviews.length }).toEqual({ github: [], phone: 0 })
  })

  it('3C-A (second path): the send reached GitHub but its answer was lost; Undo after that must not leave the review on GitHub', async () => {
    let dropNextPatchAnswer = true
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        const res = await s.github.fetch(url, init)
        if ((init.method ?? 'GET') === 'PATCH' && dropNextPatchAnswer) {
          dropNextPatchAnswer = false
          throw new TypeError('Load failed') // GitHub moved the ref; the phone never heard
        }
        return res
      },
    })
    const days = await openPhoneDays(t.store, VAULT, t.clock.now)
    const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'v' })
    const R = { at: at(1), rating: 'good' as const }
    const next = await host.writeCardAnswer('a.md', 'NC-2', R)
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.state()).toMatchObject({ problem: 'OFFLINE', waiting: 1 })
    await host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    await t.answers.sendNow()
    await t.tick(SEND_AFTER_MS * 2)
    expect({ github: await t.remoteReviews(), phone: (await host.readCard('a.md', 'NC-2'))!.reviews.length }).toEqual({ github: [], phone: 0 })
  })
})

describe('checker YAZ-5073: an action sent two times', () => {
  it('3C-B: `unreview` sent again after a lost answer removes a SECOND review of the same minute', async () => {
    const line = `<!-- card: NC-2, ${at(1)} again, ${at(1)} good -->`
    const files = { 'a.md': pageText('A', 'NC-1', ['NC-3']).replace('# A\n\n', `# A\n\n${card('NC-2').replace('<!-- card: NC-2 -->', line)}\n\n`) }
    let dropNextPatchAnswer = true
    const t = await answersSetup({
      files,
      fetch: (s) => async (url, init) => {
        const res = await s.github.fetch(url, init)
        if ((init.method ?? 'GET') === 'PATCH' && dropNextPatchAnswer) {
          dropNextPatchAnswer = false
          throw new TypeError('Load failed')
        }
        return res
      },
    })
    // Delete review (or Undo of a sent answer) of the 06:01 "good" review.
    // YAZ-5181: the action names the review it removes (its time AND its rating).
    await t.add({ kind: 'unreview', id: 'NC-2', at: at(1), rating: 'good' })
    await t.tick(SEND_AFTER_MS) // reaches GitHub; the answer is lost
    await t.answers.sendNow() // sent again
    const reviews = cardRecords((await t.s.git.filesAt(t.head()))['a.md']).find((c) => c.id === 'NC-2')!.reviews
    // Expected: ONE action removes ONE review: the "again" review stays.
    expect(reviews).toEqual([{ at: at(1), rating: 'again' }])
  })
})

describe('checker YAZ-5073: bytes the phone did not mean to change', () => {
  it('probe: CRLF, a BOM, odd spaces, unknown parts and a card in a list: only the answered line changes', async () => {
    const page = [
      '﻿---',
      'id: NC-1',
      'title: A',
      'custom:   keep  me',
      '---',
      '',
      '# A  ',
      '',
      '```card',
      'Q {{x}}?',
      '```',
      '<!--card:NC-2,zzz unknown,   2026-11-14T05:00Z good 3s,off-->',
      '',
      '```card',
      'Q2?',
      '```',
      '<!-- card: NC-3 , weird-part -->',
      '',
      'tail\t',
    ].join('\r\n')
    const t = await answersSetup({ files: { 'a.md': page } })
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    expect(t.commits()).toBe(1)
    const before = linesOf(new TextEncoder().encode(page))
    const after = linesOf(bytesAt(t, 'a.md'))
    expect(after.length).toBe(before.length)
    const changed = before.map((l, i) => (l === after[i] ? -1 : i)).filter((i) => i >= 0)
    expect(changed).toEqual([11])
    const line11 = new TextDecoder().decode(new Uint8Array(after[11].split(',').map(Number)))
    expect(line11).toBe(`<!-- card: NC-2, zzz unknown, 2026-11-14T05:00Z good 3s, ${at(1)} good, off -->\r\n`)
  })

  it('probe: a card ID inside a code block, and two cards with one ID: what the send writes', async () => {
    const page = pageText('A', 'NC-1', ['NC-2', 'NC-2'], '````md\n```card\nfake\n```\n<!-- card: NC-2 -->\n````\n\n')
    const t = await answersSetup({ files: { 'a.md': page } })
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    const text = (await t.s.git.filesAt(t.head()))['a.md']
    // Only ONE line changes, and not the one in the code block.
    const diff = page.split('\n').map((l, i) => (l === text.split('\n')[i] ? null : i)).filter((i) => i !== null)
    expect(diff.length).toBe(1)
    expect(text).toContain('````md\n```card\nfake\n```\n<!-- card: NC-2 -->\n````')
  })

  it('probe: a page with bytes that are not UTF-8 (Latin-1 é) next to the card', async () => {
    const enc = new TextEncoder()
    const head = enc.encode(pageText('A', 'NC-1', ['NC-2']))
    const latin = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]) // "caf\xE9\n"
    const page = new Uint8Array([...head, ...latin])
    const t = await answersSetup({ files: { 'a.md': page as unknown as string } })
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    const after = bytesAt(t, 'a.md')
    const tail = [...after.slice(after.length - 6)]
    // Record what happens: the last line's bytes.
    // The Mac reads text as UTF-8 too (Node `toString('utf8')`), so it writes the same U+FFFD: not a 3C rule.
    expect(tail).toEqual([0x61, 0x66, 0xef, 0xbf, 0xbd, 0x0a])
    console.log('LATIN1 tail bytes after the send:', tail.map((b) => b.toString(16)).join(' '))
  })
})

describe('checker YAZ-5073: the branch keeps moving', () => {
  it('probe: 30 STALE_HEADs in a row: how many writes, and is there a backoff?', async () => {
    let moves = 0
    const t = await answersSetup({
      fetch: (s) => async (url, init) => {
        if ((init.method ?? 'GET') === 'PATCH' && moves < 30) {
          moves++
          await s.git.push({ [`mac-${moves}.md`]: `# ${moves}\n` }) // the Mac commits just before each ref move
        }
        return s.github.fetch(url, init)
      },
    })
    await t.add(answer('NC-2', 1))
    const start = t.clock.now()
    const writesBefore = t.s.github.calls.filter((c) => c.method !== 'GET').length
    const at60: number[] = []
    // YAZ-5183: with the backoff the sends come at 5 s, then 1, 2, 4, 8, 16 minutes: run up to 1 hour.
    for (let i = 0; i < 720 && (await t.remoteReviews()).length === 0; i++) {
      await t.tick(SEND_AFTER_MS)
      at60.push(t.s.github.calls.filter((c) => c.method !== 'GET').length - writesBefore)
    }
    const writes = t.s.github.calls.filter((c) => c.method !== 'GET').length - writesBefore
    console.log('STALE x30: writes per 5 s step', at60.join(' '), 'total', writes, 'in', (t.clock.now() - start) / 1000, 's; state', t.answers.state().problem, 'reviews', (await t.remoteReviews()).length)
    expect((await t.remoteReviews()).length).toBe(1)
  })
})

describe('checker YAZ-5073: two tabs on one list', () => {
  it('3C-C: two tabs add an answer at the same moment: both answers stay', async () => {
    const t = await answersSetup()
    const a = await openOutbox(t.store, VAULT)
    const b = await openOutbox(t.store, VAULT)
    await Promise.all([a.add([{ op: answer('NC-2', 1), path: 'a.md', title: 'x' }], 1), b.add([{ op: answer('NC-3', 2), path: 'a.md', title: 'y' }], 2)])
    const c = await openOutbox(t.store, VAULT)
    expect(c.waiting().map((w) => w.op.id).sort()).toEqual(['NC-2', 'NC-3'])
  })
})

describe('checker YAZ-5073: security and day numbers', () => {
  it('probe: the token is in no stored list, no state, no event, and the commit names no person', async () => {
    const t = await answersSetup()
    await t.add(answer('NC-2', 1))
    await t.tick(SEND_AFTER_MS)
    const stored = JSON.stringify(await t.store.getState(VAULT, 'answers'))
    const days = JSON.stringify((await t.store.getState(VAULT, DAYS_STATE)) ?? null)
    const token = t.s.tokens ? await t.s.tokens.read(VAULT) : ''
    expect(token && token.length > 10).toBe(true)
    for (const text of [stored, days, JSON.stringify(t.events), JSON.stringify(t.answers.state())]) expect(text.includes(token!)).toBe(false)
    for (const c of t.s.github.calls) expect(c.url.includes(token!)).toBe(false)
    const msg = t.s.git.commits.get(t.head())!.message
    expect(msg).toBe('sync (phone): a.md')
    expect(BRANCH).toBe('main')
  })
})

describe('checker YAZ-5073: a big file', () => {
  it('probe: a page with 10,000 cards: one answer changes one line; applyOps time', async () => {
    const { applyOps } = await import('./ops')
    const ids = Array.from({ length: 10_000 }, (_, i) => `NC-${i + 10}`)
    const page = pageText('Big', 'NC-1', ids)
    const t0 = performance.now()
    const out = applyOps(page, [answer('NC-9999', 1), answer('NC-10', 2)])
    const ms = performance.now() - t0
    console.log(`10,000 cards: ${page.length} chars, applyOps ${ms.toFixed(1)} ms`)
    const a = page.split('\n')
    const b = out.content.split('\n')
    expect(b.length).toBe(a.length)
    expect(a.map((l, i) => (l === b[i] ? 0 : 1)).reduce((x: number, y) => x + y, 0)).toBe(2)
  })
})
