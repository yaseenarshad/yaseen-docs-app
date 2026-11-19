import { act, createElement } from 'react'
import { vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { SAME_WORD } from '@client/vault/unitWordText'
import { cardIdOf, pageCards, rewritePageCards, withCardTitle } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { answersSetup } from '../answers/testing'
import { BRANCH, VAULT } from '../sync/testing'
import type { VaultMedia } from '../media/ui/vaultMedia'
import type { ReviewLink } from './link'
import type { CardLinkOpen } from './PhoneCard'
import { ReviewView } from './ReviewView'

/**
 * Test help for the Review tab (4B): the REAL engine (3B) and answer list (3C) on the fake GitHub with a fake clock
 * (`answersSetup`), and the real screen on top, in jsdom. Nothing calls the real API. A test file that uses it says
 * `// @vitest-environment jsdom`, and fakes `Date` (the review hook reads the time) with `vi.useFakeTimers`.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// Each answer waits the short "seen" time of the next card (YAZ-5226), as a person does: a session takes longer.
vi.setConfig({ testTimeout: 30_000 })

/** Made-up "now": Friday 13 November 2026, 10:00 local time. */
export const NOW = new Date(2026, 10, 13, 10, 0, 0).getTime()

/** A made-up card block with its line (`line`: the card line's parts after `card: `). */
/**
 * Review rules v1, rule 5 (YAZ-5655): Due today takes the most overdue DAY first, then one random order for the day. A
 * test that wants its known cards in page order gives card `i` (0 first) the same `reviews`, each date moved earlier
 * by 10 × (20 − i) days: card 0 the most overdue, each next one 10 days less (more than any fuzz), all still due.
 */
export const inOrder = (reviews: string, i: number): string =>
  reviews.replace(/\d{4}-\d{2}-\d{2}(?=T)/g, (d) => new Date(Date.parse(`${d}T00:00:00.000Z`) - 10 * (20 - i) * 86_400_000).toISOString().slice(0, 10))
export const cardBlock = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
/** A made-up page with the cards given, as the Mac writes it. */
export const page = (title: string, ...cards: string[]) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${cards.join('\n\n')}\n`
/**
 * A made-up card file (YAZ-5037) in the form of YAZ-5308 (decision D): its properties hold only `kind: card`, and
 * `title` goes on the card line of `block`, right after its ID (`withCardTitle`, as the Mac writes it).
 */
export const cardFile = (title: string, block: string, extra = '') => `---\nkind: card\n---\n\n${rewritePageCards(block, (c, n) => (n === 0 ? withCardTitle(c.line, title) : undefined))}\n${extra}`

const named = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()

export async function reviewSetup(files: Record<string, string>, options: { media?: VaultMedia; titleRoom?: boolean; dueShuffle?: boolean; fetch?: Parameters<typeof answersSetup>[0] extends infer O ? (O extends { fetch?: infer F } ? F : never) : never } = {}) {
  return mountReview(await answersSetup({ files, fetch: options.fetch, dueShuffle: options.dueShuffle }), options)
}

/** The screen on a vault that is set up already (the 3,000-card test measures the screen alone). */
export async function mountReview(t: Awaited<ReturnType<typeof answersSetup>>, options: { media?: VaultMedia; titleRoom?: boolean } = {}) {
  const link: ReviewLink = { engine: t.engine, answers: t.answers, store: t.store, media: options.media }
  const opened: CardLinkOpen[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = async () => {
    for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  await act(async () => root.render(createElement(ReviewView, { link, vault: VAULT, vaultName: 'vault', unit: SAME_WORD, open: (to) => void opened.push(to), titleRoom: options.titleRoom })))
  await settle()
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
  const button = (name: string | RegExp) => buttons().find((b) => (typeof name === 'string' ? named(b) === name : name.test(named(b)))) ?? null
  /** A new card (YAZ-5226), and the screen after the last card (S5), take taps after a short time: wait, as a person does. */
  const seen = async () => {
    for (let i = 0; i < 100 && host.querySelector('[data-guard], [data-settling]') !== null; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 20))))
  }
  /**
   * A tap on the button named `name`. The ⋯'s card actions (YAZ-5505) are a lazy chunk: it waits for them to draw.
   * A card action needs two taps (`data-two-tap`): `click` gives both, as a person who means it does; `once` only the first.
   * A row that asks in place instead (YAZ-5697: Archive card, Title on the front): the second tap is its ask's answer.
   */
  const click = async (name: string | RegExp, options: { once?: boolean } = {}) => {
    // The answer buttons of a new card, and the screen after the last card (S5), take no tap for 400 ms.
    if (button(name)?.closest('.review__answers[data-guard], .review__stage--done[data-settling]') != null) await seen()
    for (let i = 0; i < 100 && button(name) === null && host.querySelector('[role="menu"] [aria-busy="true"]') !== null; i++) await settle()
    const b = button(name)
    if (b === null) throw new Error(`No button "${name}" on: ${host.textContent}`)
    const action = b.dataset.twoTap !== undefined && b.dataset.armed === undefined ? b.dataset.action : undefined
    await act(async () => b.click())
    await settle()
    if (action === undefined || options.once === true) return
    const again = host.querySelector<HTMLButtonElement>(`[data-action="${action}"][data-armed]`) ?? host.querySelector<HTMLButtonElement>(`[data-action="${action}"] [role="alertdialog"] button:last-child`)
    if (again === null) throw new Error(`The row "${name}" did not arm on: ${host.textContent}`)
    await act(async () => again.click())
    await settle()
  }
  /** The text of the card on show, spaces collapsed; hidden words that do not show are left out. */
  const cardText = () => {
    const box = host.querySelector('.phone-card__body')
    if (box === null) return null
    const clone = box.cloneNode(true) as HTMLElement
    for (const blank of clone.querySelectorAll('.card__blank')) blank.textContent = '_'
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  /** The card lines GitHub holds now, by card ID. */
  const remoteLines = async () => {
    const files = await t.s.git.filesAt(t.s.git.branches.get(BRANCH)!)
    const lines: Record<string, string> = {}
    for (const [path, content] of Object.entries(files)) {
      if (typeof content !== 'string' || !path.endsWith('.md')) continue
      // By the card's own line, as written: a title may hold `\>` (YAZ-5308), so no pattern on `>` reads it.
      for (const c of pageCards(content)) if (c.lineAt !== null) lines[cardIdOf(c.line) ?? '?'] = splitFrontmatter(content).body.split('\n')[c.lineAt].trim()
    }
    return lines
  }
  return {
    ...t,
    link,
    host,
    opened,
    settle,
    button,
    click,
    cardText,
    remoteLines,
    text: () => (host.textContent ?? '').replace(/\s+/g, ' '),
    /** The line under the buttons. */
    last: () => (host.querySelector('.review__last')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    head: () => (host.querySelector('.review__head')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    seen,
    async tap() {
      await seen()
      const card = host.querySelector<HTMLElement>('.review__card')
      if (card === null) throw new Error(`No card on: ${host.textContent}`)
      await act(async () => card.click())
      await settle()
    },
    /** The clock of the engine and the list moves on (the send's 5 s), then everything settles. */
    async wait(ms: number) {
      await act(async () => {
        await t.tick(ms)
      })
      await settle()
    },
    unmount() {
      act(() => root.unmount())
      host.remove()
    },
  }
}

export type ReviewHarness = Awaited<ReturnType<typeof mountReview>>
