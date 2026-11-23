/**
 * The outside-change glow inside a drawn card (YAZ-5925, `cardGlow.ts`): the changed visible words only (plain, bold,
 * a link pill, a hidden-word blank, a table cell), the removed mark, the frame for a rewrite (D4), a card in a page
 * through the page's change list (own writes never glow, Checked and Mark all checked clear it), the timed glow, and
 * a card page's bar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { applyExternalMarkdown } from '../external/applyExternalMarkdown'
import { OutsideChangesBar } from '../external/OutsideChangesBar'
import { createOutsideChangesChannel } from '../external/outsideChangesChannel'
import { OUTSIDE_ACTIVE_CLASS, OUTSIDE_CHANGE_CLASS, OUTSIDE_REMOVED_CLASS, OUTSIDE_TIP_ATTR, OUTSIDE_TIP_CLASS } from '../external/outsideChanges'
import { _resetTwinEditors, announceTwinSave } from '../../lib/twinEditors'
import { renderCard, type CardLook } from './cardRender'
import { CARD_GLOW_CHECKED_CLASS, CARD_GLOW_SIDE_ATTR, CARD_REWRITTEN_CLASS, CardGlowTracker, cardGlowStats, glowCard } from './cardGlow'
import { useCardFileGlow, type CardFileGlow } from './useCardFileGlow'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const look: CardLook = { link: (inner) => ({ label: inner, resolved: true }) }
const draw = (text: string) => renderCard(text, {}, look)
const lit = (root: Element): string[] => [...root.querySelectorAll(`.${OUTSIDE_CHANGE_CLASS}`)].map((el) => el.textContent ?? '')
const marks = (root: Element): Element[] => [...root.querySelectorAll(`.${OUTSIDE_REMOVED_CLASS}`)]

/** The new drawing of `now`, lit against `before`. */
function glow(before: string, now: string, show = draw) {
  const drawn = show(now)
  const kind = glowCard(drawn, before, now, show)
  return { drawn, kind }
}

describe('glowCard lights only the changed visible words (D1)', () => {
  it('plain text: the new word lights, the rest of the card stays as it was drawn', () => {
    const { drawn, kind } = glow('The capital of France is Lyon.\n---\nIt is in the north.', 'The capital of France is Paris.\n---\nIt is in the north.')
    expect(kind).toBe('words')
    expect(lit(drawn)).toEqual(['Paris'])
    expect(drawn.textContent).toContain('The capital of France is Paris.')
    // Its side has the hook point for a folded side's dot; the other side has none.
    expect([...drawn.querySelectorAll(`[${CARD_GLOW_SIDE_ATTR}]`)].map((side) => (side as HTMLElement).dataset.side)).toEqual(['0'])
    // The box's short text names the card before.
    expect(drawn.querySelector(`.${OUTSIDE_CHANGE_CLASS}`)?.getAttribute(OUTSIDE_TIP_ATTR)).toMatch(/^Before: The capital of France is Lyon/)
  })

  it('YAZ-5925 nit: a new word before others lights without the space after it ("river", not "river ")', () => {
    const { drawn } = glow('The Nile is long.', 'The Nile river is a rusty long one.')
    expect(lit(drawn)).toEqual(['river', 'a rusty', 'one'])
    expect(drawn.textContent).toContain('The Nile river is a rusty long one.')
  })

  it('bold: the word inside the bold lights inside the <strong>, no Markdown star counts', () => {
    const { drawn } = glow('A **very big** dog with more words around it', 'A **very small** dog with more words around it')
    expect(lit(drawn)).toEqual(['small'])
    expect(drawn.querySelector(`strong .${OUTSIDE_CHANGE_CLASS}`)?.textContent).toBe('small')
  })

  it('a link pill: its label lights inside the pill', () => {
    const { drawn } = glow('See [[France]] for the long story here', 'See [[Germany]] for the long story here')
    expect(lit(drawn)).toEqual(['Germany'])
    expect(drawn.querySelector(`[data-card-link] .${OUTSIDE_CHANGE_CLASS}`)?.textContent).toBe('Germany')
  })

  it('a hidden word drawn as a blank: the blank lights, its word stays hidden', () => {
    const blanks = (text: string) => renderCard(text, { shown: 0 }, look)
    const { drawn } = glow('The capital of France is {{Lyon}} in this old card', 'The capital of France is {{Paris}} in this old card', blanks)
    const blank = drawn.querySelector('.card__blank')
    expect(blank?.classList.contains(OUTSIDE_CHANGE_CLASS)).toBe(true)
    expect(blank?.querySelector(`.${OUTSIDE_CHANGE_CLASS}`)).toBeNull()
  })

  it('a table cell: only the changed cell lights; two cells never join into one word', () => {
    const table = (cell: string) => `Countries and their capitals in one table\n\n| Country | Capital |\n| --- | --- |\n| France | ${cell} |\n| Spain | Madrid |`
    const { drawn } = glow(table('Lyon'), table('Paris'))
    expect(lit(drawn)).toEqual(['Paris'])
    expect(drawn.querySelector(`td .${OUTSIDE_CHANGE_CLASS}`)?.textContent).toBe('Paris')
  })

  it('removed words: a thin red mark where they were, its box names them; no glow for nothing new', () => {
    const { drawn, kind } = glow('Paris is a big old city in France with many people', 'Paris is a city in France with many people')
    expect(kind).toBe('words')
    expect(lit(drawn)).toEqual([])
    expect(marks(drawn)).toHaveLength(1)
    expect(marks(drawn)[0].getAttribute(OUTSIDE_TIP_ATTR)).toBe('Removed: big old')
    // The mark stands where the words were: between "a" and "city".
    expect(marks(drawn)[0].previousSibling?.textContent).toMatch(/is a $/)
  })

  it('one compare for each pair of texts: the same pair drawn again does not compare again', () => {
    const before = 'One two three four five six seven'
    const now = 'One two three FOUR five six seven'
    glow(before, now)
    const count = cardGlowStats.compares
    const { drawn } = glow(before, now)
    expect(cardGlowStats.compares).toBe(count)
    expect(lit(drawn)).toEqual(['FOUR'])
  })
})

describe('D4: a rewrite glows the frame', () => {
  it('80% or more of the old words gone: the frame glows, the box says "Rewritten", no word lights', () => {
    const { drawn, kind } = glow('alpha beta gamma delta epsilon', 'alpha one two three four five six')
    expect(kind).toBe('frame')
    expect(drawn.classList.contains(CARD_REWRITTEN_CLASS)).toBe(true)
    expect(drawn.getAttribute(OUTSIDE_TIP_ATTR)).toMatch(/^Rewritten/)
    expect(lit(drawn)).toEqual([])
    expect(marks(drawn)).toEqual([])
  })

  it('below 80%: the words light, the frame does not', () => {
    // 3 of 5 old words gone (60%).
    const { drawn, kind } = glow('alpha beta gamma delta epsilon', 'alpha beta one two three')
    expect(kind).toBe('words')
    expect(drawn.classList.contains(CARD_REWRITTEN_CLASS)).toBe(false)
    expect(lit(drawn)).toEqual(['one two three'])
  })
})

describe('a card in a page (D2a): the page`s change list', () => {
  const CARD = (word: string) => `# Page\n\nAbove.\n\n\`\`\`card\nThe capital of France is ${word}.\n---\nIt is a big city.\n\`\`\`\n\nBelow.\n`
  const mounted: { crepe: Crepe; root: HTMLElement }[] = []
  afterEach(async () => {
    for (const m of mounted.splice(0)) {
      await m.crepe.destroy()
      m.root.remove()
    }
    document.querySelectorAll(`.${OUTSIDE_TIP_CLASS}`).forEach((tip) => tip.remove())
  })
  async function mount() {
    const channel = createOutsideChangesChannel()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: CARD('Lyon'), outsideChanges: channel, image: { root: '/v', pagePath: '/v/Page.md' } })
    await crepe.create()
    mounted.push({ crepe, root })
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    const card = () => root.querySelector('.card')!
    const checked = () => card().querySelector<HTMLButtonElement>(`.${CARD_GLOW_CHECKED_CLASS}`)!
    return { crepe, root, view, channel, card, checked }
  }

  it('an outside write lights the new word in the drawn card; the bar counts it; the box shows it word by word', async () => {
    const { crepe, channel, card, checked } = await mount()
    expect(checked().hidden).toBe(true)
    expect(applyExternalMarkdown(crepe, CARD('Paris'))).toBe('applied')
    expect(lit(card())).toEqual(['Paris'])
    expect(channel.getState().count).toBe(1)
    expect(checked().hidden).toBe(false)
    const glowEl = card().querySelector(`.${OUTSIDE_CHANGE_CLASS}`)!
    glowEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    const tip = document.querySelector(`.${OUTSIDE_TIP_CLASS}`)!
    expect(tip.querySelector('del')?.textContent).toBe('Lyon')
    expect(tip.querySelector('ins')?.textContent).toBe('Paris')
    // Next change rings the lit word.
    channel.next()
    expect(card().querySelector(`.${OUTSIDE_CHANGE_CLASS}.${OUTSIDE_ACTIVE_CLASS}`)?.textContent).toBe('Paris')
  })

  it("the app's own write (a quiet apply) never glows", async () => {
    const { crepe, channel, card } = await mount()
    expect(applyExternalMarkdown(crepe, CARD('Paris'), true)).toBe('applied')
    expect(card().textContent).toContain('Paris')
    expect(lit(card())).toEqual([])
    expect(channel.getState().count).toBe(0)
  })

  it("Checked in the card's head clears it; Mark all checked clears it", async () => {
    const { crepe, channel, card, checked } = await mount()
    applyExternalMarkdown(crepe, CARD('Paris'))
    checked().click()
    expect(lit(card())).toEqual([])
    expect(channel.getState().count).toBe(0)
    expect(checked().hidden).toBe(true)
    applyExternalMarkdown(crepe, getMarkdownForSave(crepe).replace('Paris', 'Nice'))
    expect(lit(card())).toEqual(['Nice'])
    channel.clear()
    expect(lit(card())).toEqual([])
  })
})

describe('YAZ-5909 integration: the glow meets the fold (YAZ-5904) and the head marks (YAZ-5896)', () => {
  const FOLDED = (word: string) => `# Page\n\n\`\`\`card\nThe capital of France\n---\nIt is ${word}.\n\`\`\`\n<!-- card: WIKI-7, fix -->\n`
  const mounted: { crepe: Crepe; root: HTMLElement }[] = []
  afterEach(async () => {
    for (const m of mounted.splice(0)) {
      await m.crepe.destroy()
      m.root.remove()
    }
  })
  async function mount() {
    const channel = createOutsideChangesChannel()
    const root = document.createElement('div')
    // The page's own `card-sides` key on its mount: Fold.
    root.dataset.cardSides = 'fold'
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: FOLDED('Lyon'), outsideChanges: channel, image: { root: '/v', pagePath: '/v/Page.md' } })
    await crepe.create()
    mounted.push({ crepe, root })
    await new Promise((done) => setTimeout(done, 0))
    const card = () => root.querySelector('.card')!
    const side2 = () => card().querySelector<HTMLElement>('.card__side[data-side="1"]')!
    const rule = () => card().querySelector<HTMLElement>('.card__rule')!
    return { crepe, channel, card, side2, rule }
  }

  it('a glow in a folded side marks that side; Next change opens it and keeps it open', async () => {
    const { crepe, channel, side2, rule } = await mount()
    expect(side2().hidden).toBe(true)
    expect(applyExternalMarkdown(crepe, FOLDED('Paris'))).toBe('applied')
    await new Promise((done) => setTimeout(done, 0))
    expect(side2().hidden).toBe(true)
    expect(side2().hasAttribute(CARD_GLOW_SIDE_ATTR)).toBe(true)
    expect(rule().getAttribute('aria-expanded')).toBe('false')
    channel.next()
    await new Promise((done) => setTimeout(done, 0))
    expect(side2().querySelector(`.${OUTSIDE_CHANGE_CLASS}.${OUTSIDE_ACTIVE_CLASS}`)?.textContent).toBe('Paris')
    expect(side2().hidden).toBe(false)
    expect(rule().getAttribute('aria-expanded')).toBe('true')
  })

  it("the head shows its marks (YAZ-5915) and the glow's Checked together", async () => {
    const { crepe, card } = await mount()
    applyExternalMarkdown(crepe, FOLDED('Paris'))
    const head = card().querySelector('.card__head')!
    expect([...head.querySelectorAll('.card__marks > span')].map((el) => el.textContent)).toContain('To fix')
    const checked = head.querySelector<HTMLButtonElement>(`.${CARD_GLOW_CHECKED_CLASS}`)!
    expect(checked.hidden).toBe(false)
    expect(checked.compareDocumentPosition(head.querySelector('.card__marks')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it("card.css lights a folded side's rule when the side holds a glow", () => {
    const css = readFileSync(resolve(__dirname, 'card.css'), 'utf8')
    expect(css).toContain(".card .card__rule[data-fold]:has(+ .card__side[hidden][data-outside-side])::before")
  })
})

describe('a card page and an embed keep their last drawn text (D2b, D2c, D3)', () => {
  it('an outside write glows from the first old text; an own write never glows and clears; Checked clears', () => {
    const changed = vi.fn()
    const tracker = new CardGlowTracker(() => 'until-checked', changed)
    tracker.seen('Lyon', false)
    expect(tracker.current).toBeNull()
    tracker.seen('Paris', false)
    expect(tracker.current).toBeNull()
    tracker.seen('Nice', true)
    tracker.seen('Nice city', true)
    expect(tracker.current?.before).toBe('Paris')
    tracker.seen('Nice city!', false)
    expect(tracker.current).toBeNull()
    tracker.seen('Rome', true)
    tracker.check()
    expect(tracker.current).toBeNull()
    expect(changed).toHaveBeenCalled()
  })

  it('the timed glow (60 s) ends by itself', () => {
    vi.useFakeTimers()
    try {
      const tracker = new CardGlowTracker(() => '60s', () => undefined)
      tracker.seen('Lyon', false)
      tracker.seen('Paris', true)
      expect(tracker.ends).not.toBeNull()
      vi.advanceTimersByTime(59_000)
      expect(tracker.current).not.toBeNull()
      vi.advanceTimersByTime(1_500)
      expect(tracker.current).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  describe("a card page's bar", () => {
    let root: Root | null = null
    let container: HTMLElement | null = null
    afterEach(() => {
      act(() => root?.unmount())
      container?.remove()
      _resetTwinEditors()
    })

    it('counts the outside change, Next rings it, Mark all checked clears it; own writes never count', () => {
      let api: CardFileGlow | null = null
      function Page({ text }: { text: string }) {
        const body = useRef<HTMLDivElement>(null)
        const glow = useCardFileGlow('/v/Card.md', text, 'until-checked', body)
        api = glow
        const drawn = glow.body === undefined ? draw(text) : glow.body.paint(draw(text), text, draw)
        return (
          <>
            <OutsideChangesBar channel={glow.channel} pinned />
            <div ref={body} className="body" dangerouslySetInnerHTML={{ __html: drawn.outerHTML }} />
          </>
        )
      }
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      act(() => root!.render(<Page text="The capital is Lyon" />))
      const bar = () => container!.querySelector('.outside-changes-bar')?.textContent ?? ''
      expect(bar()).toBe('')
      // The page's own save of the file: no glow.
      announceTwinSave('/v/Card.md', 7)
      act(() => api!.seen('The capital is Rome', 7))
      act(() => root!.render(<Page text="The capital is Rome" />))
      expect(bar()).toBe('')
      // An outside write.
      act(() => api!.seen('The capital is Paris', 8))
      act(() => root!.render(<Page text="The capital is Paris" />))
      expect(bar()).toContain('1 outside change in this page')
      expect(lit(container!.querySelector('.body')!)).toEqual(['Paris'])
      expect(api!.channel.rows()).toHaveLength(1)
      act(() => api!.channel.next())
      expect(container!.querySelector(`.body .${OUTSIDE_CHANGE_CLASS}.${OUTSIDE_ACTIVE_CLASS}`)?.textContent).toBe('Paris')
      expect(marks(container!.querySelector('.body')!)[0].getAttribute(OUTSIDE_TIP_ATTR)).toBe('Removed: Rome')
      act(() => api!.channel.clear())
      expect(bar()).toBe('')
      expect(lit(container!.querySelector('.body')!)).toEqual([])
    })
  })
})
