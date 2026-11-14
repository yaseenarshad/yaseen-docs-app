import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SAME_WORD } from '@client/vault/unitWordText'
import { answersSetup } from '../answers/testing'
import { BRANCH, VAULT } from '../sync/testing'
import type { CardMedia, ReviewLink } from './link'
import type { CardLinkOpen } from './PhoneCard'
import { ReviewView } from './ReviewView'

/**
 * Test help for the Review tab (4B): the REAL engine (3B) and answer list (3C) on the fake GitHub with a fake clock
 * (`answersSetup`), and the real screen on top, in jsdom. Nothing calls the real API. A test file that uses it says
 * `// @vitest-environment jsdom`, and fakes `Date` (the review hook reads the time) with `vi.useFakeTimers`.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Made-up "now": Friday 13 November 2026, 10:00 local time. */
export const NOW = new Date(2026, 10, 13, 10, 0, 0).getTime()

/** A made-up card block with its line (`line`: the card line's parts after `card: `). */
export const cardBlock = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
/** A made-up page with the cards given, as the Mac writes it. */
export const page = (title: string, ...cards: string[]) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${cards.join('\n\n')}\n`
/** A made-up card file (YAZ-5037). */
export const cardFile = (title: string, block: string, extra = '') => `---\nkind: card\ntitle: ${title}\n---\n\n${block}\n${extra}`

const named = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()

export async function reviewSetup(files: Record<string, string>, options: { media?: CardMedia } = {}) {
  return mountReview(await answersSetup({ files }), options)
}

/** The screen on a vault that is set up already (the 3,000-card test measures the screen alone). */
export async function mountReview(t: Awaited<ReturnType<typeof answersSetup>>, options: { media?: CardMedia } = {}) {
  const link: ReviewLink = { engine: t.engine, answers: t.answers, store: t.store, media: options.media }
  const opened: CardLinkOpen[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = async () => {
    for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  await act(async () => root.render(createElement(ReviewView, { link, vault: VAULT, vaultName: 'vault', unit: SAME_WORD, open: (to) => void opened.push(to) })))
  await settle()
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
  const button = (name: string | RegExp) => buttons().find((b) => (typeof name === 'string' ? named(b) === name : name.test(named(b)))) ?? null
  const click = async (name: string | RegExp) => {
    const b = button(name)
    if (b === null) throw new Error(`No button "${name}" on: ${host.textContent}`)
    await act(async () => b.click())
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
      for (const m of content.matchAll(/<!-- card: ([^,\s>]+)[^>]*-->/g)) lines[m[1]] = m[0]
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
    async tap() {
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
