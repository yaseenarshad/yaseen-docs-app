import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { freePort } from './freePort'

/**
 * REAL TAPS ON THE PHONE'S REVIEW SCREEN (YAZ-5616, the YAZ-5611 rules), in headless Chromium at an iPhone's size with
 * touch (Playwright's `tap`: a real touch the browser hit-tests). The fixtures build, `#fixture=review-taps`: one card
 * marked Up next, four due cards, five new cards in two folders (three a day), one archived card; the real engine and
 * answer list on the fake GitHub. Each run opens the fixture fresh. It proves:
 *  1. THE LISTS: the sheet's counts at the start (All 8, Up next 1, Due today 4, New 3: each card in one list, Review
 *     rules v1 rule 7, so the Up next card, due too, is under Up next alone),
 *     the archived card in none; each list (Up next, Due today, New cards) shows "1 / M" with M its cards, and its
 *     done screen ("No Up next cards left." + "7 more in All cards"; Due today's end; "No new cards left.").
 *  2. A WHOLE DAY in All cards, one tap at a time: after each ✕ / ✓ the top's M and the bar's whole stay at 8 (a ✕ never
 *     adds to them), N never passes M, no sheet count grows from a ✕; the ✕ card comes back with "Again" after the
 *     other due cards; the end of Due today ("You remembered 80% of 5 cards." + "Review missed cards 1", then "Due
 *     today is done." + "Learn new cards 3"); a new card needs two ✓ (New −1, Due today +1 after the first);
 *     "Inbox complete." with "2 new cards wait for another day." and "Add 2 new cards", which adds 2 (9 / 10).
 *  5. NEW CARDS FIRST (the bug this proof found): the 3 new cards begun in the New cards list, then All cards: after the
 *     due cards "Due today is done." offers "Learn new cards 3", and each begun card comes back for its second ✓.
 *  3. UNDO: the hint line's Undo and ⋯ › Undo take back the last answer: the same card again, N and the counts back.
 *  4. SAVED: after the send (the fake clock's 5 s), each card on the fake GitHub has exactly the answers that stayed
 *     (an undone one is not there), Up next's `next` is gone, the archived card and the cards not shown are unchanged.
 * Run after `npm run build:fixtures -w mobile`: `npx vite-node mobile/publish/proveReviewTaps.ts` (LAYOUT_DIST: another
 * build folder; PROOF_PORT: the port; PROOF_DIR: the pictures). Exit 0: every check passed.
 */

const mobile = new URL('..', import.meta.url).pathname
const DIST = process.env.LAYOUT_DIST ?? join(mobile, 'dist-fixtures')
const PORT = await freePort(process.env.PROOF_PORT)
const out = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), 'notecards-review-taps-'))
mkdirSync(out, { recursive: true })
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 300_000).unref()

process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')

const results: { step: string; ok: boolean; detail: string }[] = []
const check = (step: string, ok: boolean, detail = '') => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`)
}
const same = (step: string, got: unknown, want: unknown) => check(step, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}${JSON.stringify(got) === JSON.stringify(want) ? '' : `, want ${JSON.stringify(want)}`}`)

/** What the screen shows: the list, N / M, the bar, the card, its chip and "Again", the done screen's words. */
interface Screen {
  list: string
  n: number | null
  m: number | null
  bar: { done: number; size: number; forgot: number }
  card: string | null
  chip: string | null
  again: boolean
  done: string | null
}
const screen = (page: Page): Promise<Screen> =>
  page.evaluate(() => {
    const text = (sel: string) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null
    const place = text('.review__place')
    const [n, m] = place === null ? [null, null] : place.split('/').map((x) => Number(x.trim()))
    const bar = document.querySelector('.review__progress')
    return {
      list: text('.review__filter-label') ?? '',
      n,
      m,
      bar: { done: Number(bar?.getAttribute('aria-valuenow')), size: Number(bar?.getAttribute('aria-valuemax')), forgot: document.querySelectorAll('.review__step[data-answer="forgot"]').length },
      card: text('.review__card .review__id'),
      chip: text('.review__chip'),
      again: document.querySelector('.review__again') !== null,
      done: text('.review__done'),
    }
  })

/** Waits until the screen takes taps: the card drawn and past the tap guard, or the done screen settled. */
async function settled(page: Page) {
  await page.waitForFunction(
    () => {
      const answers = document.querySelector('.review__answers')
      if (answers !== null) return !answers.hasAttribute('data-guard') && document.querySelector('.review__answer:not([disabled])') !== null && document.querySelector('.review__card-wait') === null
      const done = document.querySelector('.review__stage--done')
      return done !== null && !done.hasAttribute('data-settling')
    },
    null,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(80)
}

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' }).first()
async function tap(page: Page, name: string | RegExp) {
  await settled(page)
  await button(page, name).tap()
  await page.waitForTimeout(120)
  await settled(page)
}

/** The sheet's counts ("All cards" → "8"), opened by a tap on the top and closed by another. */
async function sheet(page: Page): Promise<Record<string, string>> {
  await settled(page)
  await page.locator('.review__filter').tap()
  await page.waitForSelector('.review__sheet')
  const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.review__sheet-row')].map((r) => [r.querySelector('.review__sheet-name')?.textContent ?? '', r.querySelector('.review__sheet-n')?.textContent ?? ''])))
  await page.locator('.review__filter').tap()
  await page.waitForSelector('.review__sheet', { state: 'detached' })
  return rows
}
async function pick(page: Page, list: string) {
  await settled(page)
  await page.locator('.review__filter').tap()
  await page.locator(`.review__sheet-pick[aria-label="${list}"]`).tap()
  await page.waitForTimeout(150)
  await settled(page)
}

let browser: Browser
async function open(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check('no page error', false, e.message))
  await page.goto(`http://127.0.0.1:${PORT}/?taps#fixture=review-taps`)
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'review-taps' || document.body.dataset.fixtureError !== undefined, null, { timeout: 30_000 })
  await settled(page)
  return page
}

/** The answers on each card line of the vault (its review parts), and its `next` / `off`. */
function cardLines(files: Record<string, string>): Map<string, { reviews: string[]; next: boolean; off: boolean }> {
  const lines = new Map<string, { reviews: string[]; next: boolean; off: boolean }>()
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.md') || typeof text !== 'string') continue
    for (const m of text.matchAll(/<!-- card: (.*?) -->/g)) {
      const parts = m[1].split(', ')
      lines.set(parts[0], { reviews: parts.filter((p) => /^\d{4}-\d\d-\d\dT/.test(p)), next: parts.includes('next'), off: parts.includes('off') })
    }
  }
  return lines
}
const sent = (page: Page) => page.evaluate(() => (window as unknown as { __reviewTaps: { send: () => Promise<Record<string, string>> } }).__reviewTaps.send())

const server = await serveDist(DIST, PORT)
browser = await chromium.launch()
try {
  // 1. THE LISTS
  {
    const page = await open()
    const s = await screen(page)
    same('start: All cards, 1 / 8, the Up next card first', [s.list, s.n, s.m, s.card], ['All cards', 1, 8, 'UP-1'])
    same('start: the bar has 8 empty steps', s.bar, { done: 0, size: 8, forgot: 0 })
    same('start: the sheet counts (the archived card in none)', await sheet(page), { 'All cards': '8', 'Up next': '1', 'Due today': '4', 'New cards': '3' })
    await page.screenshot({ path: join(out, 'start.png') })

    await pick(page, 'Up next')
    same('Up next: 1 / 1, UP-1', [(await screen(page)).list, (await screen(page)).n, (await screen(page)).m, (await screen(page)).card], ['Up next', 1, 1, 'UP-1'])
    await tap(page, 'Remembered')
    const upDone = await screen(page)
    check('Up next done: "No Up next cards left." and "7 more in All cards"', /No Up next cards left\./.test(upDone.done ?? '') && /7 more in All cards/.test(upDone.done ?? ''), upDone.done ?? 'no done screen')
    // YAZ-5321: the Up next row stays while it is the list on show, at 0.
    same('Up next done: the sheet counts (Up next 0 while it is on show)', await sheet(page), { 'All cards': '7', 'Up next': '0', 'Due today': '4', 'New cards': '3' })
    await tap(page, '7 more in All cards')
    const back = await screen(page)
    // The session goes on: UP-1 is the 1 done card of All cards' 8, so DUE-1 is 2 / 8.
    same('"7 more in All cards" opens All cards at 2 / 8, the bar 1 / 8', [back.list, back.n, back.m, back.card, back.bar.done, back.bar.size], ['All cards', 2, 8, 'DUE-1', 1, 8])
    same('All cards: the sheet has no Up next row now', await sheet(page), { 'All cards': '7', 'Due today': '4', 'New cards': '3' })
    await page.context().close()
  }
  {
    const page = await open()
    await pick(page, 'Due today')
    const s = await screen(page)
    same('Due today: 1 / 4 (the Up next card is under Up next alone, rule 7)', [s.list, s.n, s.m, s.card], ['Due today', 1, 4, 'DUE-1'])
    for (let i = 0; i < 4; i++) await tap(page, 'Remembered')
    const end = await screen(page)
    check('Due today all remembered: "Due today is done." and "Learn new cards 3"', /Due today is done\./.test(end.done ?? '') && /Learn new cards\s*3/.test(end.done ?? ''), end.done ?? 'no done screen')
    check('Due today all remembered: 100%', /You remembered 100% of 4 cards\./.test(end.done ?? ''), end.done ?? '')
    await page.context().close()
  }
  {
    const page = await open()
    await pick(page, 'New cards')
    const s = await screen(page)
    same('New cards: 1 / 3, a New card', [s.list, s.n, s.m, s.chip], ['New cards', 1, 3, 'New'])
    const seen: string[] = []
    for (let i = 0; i < 12 && (await screen(page)).card !== null; i++) {
      const now = await screen(page)
      seen.push(`${now.card} ${now.n}/${now.m}`)
      check(`New cards step ${i + 1}: M stays 3, N within it`, now.m === 3 && now.n !== null && now.n >= 1 && now.n <= 3, `${now.card} ${now.n}/${now.m}`)
      await tap(page, 'Remembered')
    }
    // After its first ✓ a new card is in Due today (the YAZ-5611 rule): it leaves the New cards list.
    same('New cards: the 3 cards once each in this list', seen, ['NEW-1 1/3', 'NEW-2 2/3', 'NEW-3 3/3'])
    const done = await screen(page)
    check('New cards done: "No new cards left.", "Add 2 new cards", "8 more in All cards" (the 3 begun ones are due now)', /No new cards left\./.test(done.done ?? '') && /Add 2 new cards/.test(done.done ?? '') && /8 more in All cards/.test(done.done ?? ''), done.done ?? 'no done screen')
    // Due today 7: the 4 due cards and the 3 begun ones; UP-1 is under Up next alone (rule 7).
    same('New cards done: the sheet', await sheet(page), { 'All cards': '8', 'Up next': '1', 'Due today': '7', 'New cards': '0' })
    await tap(page, '8 more in All cards')
    const rest: string[] = []
    for (let i = 0; i < 14; i++) {
      const now = await screen(page)
      if (now.card === null) {
        rest.push(`[${now.done}]`)
        if (!/Learn new cards|Review missed cards/.test(now.done ?? '')) break
        await tap(page, /^(Learn new cards|Review missed cards)/)
        continue
      }
      rest.push(now.card)
      await tap(page, 'Remembered')
    }
    check('New cards first, then All cards: "Due today is done." offers "Learn new cards 3" (the begun cards)', rest.some((r) => /Due today is done\..*Learn new cards\s*3/.test(r)), rest.join(' '))
    check('New cards first, then All cards: the day ends at "Inbox complete."', /Inbox complete\./.test(rest.at(-1) ?? ''), rest.at(-1) ?? '')
    for (const id of ['NEW-1', 'NEW-2', 'NEW-3']) check(`New cards: ${id} comes back the same day for its second ✓`, rest.includes(id), rest.join(' '))
    const sent3 = cardLines(await sent(page))
    same('New cards: each begun card saved with two answers', ['NEW-1', 'NEW-2', 'NEW-3', 'NEW-4'].map((id) => sent3.get(id)?.reviews.length), [2, 2, 2, 0])
    await page.context().close()
  }

  // 2. + 3. + 4. A WHOLE DAY IN ALL CARDS, UNDO, SAVED
  {
    const page = await open()
    const given = new Map<string, number>()
    const answer = async (rating: 'Forgot' | 'Remembered') => {
      const before = await screen(page)
      given.set(before.card!, (given.get(before.card!) ?? 0) + 1)
      await tap(page, rating)
      return before
    }
    let last = await sheet(page)
    const counts = (rows: Record<string, string>) => Number(rows['All cards'])
    const step = async (name: string, rating: 'Forgot' | 'Remembered') => {
      const before = await answer(rating)
      const after = await screen(page)
      const rows = await sheet(page)
      check(`${name}: M stays 8, the bar's whole stays 8`, after.done !== null || (after.m === 8 && after.bar.size === 8), `${before.card} ${rating}: ${after.n}/${after.m}, bar ${after.bar.done}/${after.bar.size}`)
      if (after.done === null) check(`${name}: N within 1..M`, after.n !== null && after.n >= 1 && after.n <= after.m!, `${after.n}/${after.m}`)
      if (rating === 'Forgot') check(`${name}: no sheet count grows from the ✕`, Object.keys(rows).every((k) => Number(rows[k]) <= Number(last[k] ?? Infinity)), `${JSON.stringify(last)} -> ${JSON.stringify(rows)}`)
      check(`${name}: All cards never grows`, counts(rows) <= counts(last), `${last['All cards']} -> ${rows['All cards']}`)
      last = rows
      return after
    }

    await step('✓ UP-1', 'Remembered')
    const f = await step('✕ DUE-1', 'Forgot')
    same('after ✕ DUE-1: DUE-2 shows, the bar has 1 red step and 1 done', [f.card, f.bar], ['DUE-2', { done: 1, size: 8, forgot: 1 }])
    same('after ✕ DUE-1: the sheet still counts DUE-1', last, { 'All cards': '7', 'Due today': '4', 'New cards': '3' })
    await step('✓ DUE-2', 'Remembered')

    // 3. UNDO from the hint line (it shows until the next card's first action, so no sheet between): DUE-3 again,
    // N and the counts back.
    const beforeUndo = await answer('Remembered')
    await tap(page, 'Undo')
    const undone = await screen(page)
    given.set('DUE-3', given.get('DUE-3')! - 1)
    same('hint Undo: DUE-3 again, at its place', [undone.card, undone.n, undone.m, undone.bar.done], ['DUE-3', beforeUndo.n, 8, beforeUndo.bar.done])
    same('hint Undo: the sheet counts DUE-3 again', await sheet(page), { 'All cards': '6', 'Due today': '3', 'New cards': '3' })
    last = await sheet(page)
    await step('✓ DUE-3 again', 'Remembered')
    await step('✓ DUE-4', 'Remembered')

    const missed = await screen(page)
    check('end of the first pass: "You remembered 80% of 5 cards." and "Review missed cards 1"', /You remembered 80% of 5 cards\./.test(missed.done ?? '') && /Review missed cards\s*1/.test(missed.done ?? ''), missed.done ?? 'no done screen')
    check('end of the first pass: no skip button', !/Learn new cards/.test(missed.done ?? ''), missed.done ?? '')
    await page.screenshot({ path: join(out, 'missed.png') })
    await tap(page, /^Review missed cards/)
    const again = await screen(page)
    same('Review missed cards: DUE-1 with "Again"', [again.card, again.again], ['DUE-1', true])
    await step('✓ DUE-1', 'Remembered')
    const dueDone = await screen(page)
    check('then: "Due today is done." and "Learn new cards 3"', /Due today is done\./.test(dueDone.done ?? '') && /Learn new cards\s*3/.test(dueDone.done ?? ''), dueDone.done ?? '')
    await tap(page, /^Learn new cards/)

    const n1 = await screen(page)
    same('Learn new cards: a New card', n1.chip, 'New')
    await step(`✓ ${n1.card} (first)`, 'Remembered')
    same(`after the first ✓ of ${n1.card}: New −1, Due today +1`, last, { 'All cards': '3', 'Due today': '1', 'New cards': '2' })

    // 3. UNDO from ⋯: the first ✓ goes, the counts go back.
    await settled(page)
    await button(page, 'More card actions').tap()
    await page.getByRole('menuitem', { name: /Undo/ }).first().tap()
    await page.waitForTimeout(150)
    await settled(page)
    given.set(n1.card!, given.get(n1.card!)! - 1)
    const u2 = await screen(page)
    same('⋯ › Undo: the new card again, as New', [u2.card, u2.chip], [n1.card, 'New'])
    same('⋯ › Undo: New 3, Due today 0 again', await sheet(page), { 'All cards': '3', 'Due today': '0', 'New cards': '3' })
    last = await sheet(page)

    // The rest: ✕ the first new card once, then ✓ until the Inbox is done.
    await step(`✕ ${u2.card}`, 'Forgot')
    for (let i = 0; i < 12 && (await screen(page)).card !== null; i++) await step(`new cards, step ${i + 1}`, 'Remembered')
    const done = await screen(page)
    check('"Inbox complete." with today\'s work', /Inbox complete\./.test(done.done ?? '') && /Today:/.test(done.done ?? ''), done.done ?? '')
    check('"2 new cards wait for another day." and "Add 2 new cards"', /2 new cards wait for another day\./.test(done.done ?? '') && /Add 2 new cards/.test(done.done ?? ''), done.done ?? '')
    await page.screenshot({ path: join(out, 'complete.png') })

    // 4. SAVED
    const files = await sent(page)
    const lines = cardLines(files)
    const startReviews = (id: string) => (id.startsWith('NEW-') ? 0 : 2)
    for (const id of ['UP-1', 'DUE-1', 'DUE-2', 'DUE-3', 'DUE-4', 'NEW-1', 'NEW-2', 'NEW-3', 'NEW-4', 'NEW-5', 'OFF-1']) {
      const line = lines.get(id)
      same(`saved: ${id} has its answers once each`, line?.reviews.length, startReviews(id) + (given.get(id) ?? 0))
    }
    same('saved: Up next\'s `next` is gone', lines.get('UP-1')?.next, false)
    same('saved: the archived card stays archived', lines.get('OFF-1')?.off, true)
    same('saved: nothing waits to send', await page.evaluate(() => (window as unknown as { __reviewTaps: { waiting: () => number } }).__reviewTaps.waiting()), 0)

    // Add 2 new cards: two more today.
    await tap(page, 'Add 2 new cards')
    const more = await screen(page)
    // Spec 13: cards that join by Add more add to M; the 8 done stay done.
    same('Add 2 new cards: 9 / 10, a New card, the bar 8 / 10', [more.n, more.m, more.chip, more.bar.done, more.bar.size], [9, 10, 'New', 8, 10])
    same('Add 2 new cards: the sheet', await sheet(page), { 'All cards': '2', 'Due today': '0', 'New cards': '2' })
    await page.context().close()
  }
} catch (err) {
  check('the run', false, String((err as Error)?.stack ?? err))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} / ${results.length} passed. Pictures: ${out}`)
process.exit(failed.length === 0 ? 0 : 1)
