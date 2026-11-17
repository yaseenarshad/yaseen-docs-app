// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, cardBlock, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import type { VaultData } from '../search/vaultData'
import { phoneRecord } from '../sync/phoneIndex'
import { mount, newPhone, type Harness } from '../screens/testing'
import { LINKED_MENTIONS_PAGE, linkedMentionsCount, moreStep } from './LinkedMentions'

/**
 * YAZ-5455: links work, and "Linked mentions". A `[[link]]` (with words, a heading, an ID) and a relative Markdown link open
 * their page, at the heading they name; a card link opens the card; a missing page's link is plain, dim and does
 * nothing; a web link opens Safari; Back returns to the page. At a page's end, "Linked mentions": the Mac's "Linked
 * mentions", from the phone's index. Made-up vault only (`readerVault.ts`).
 */
const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Links.md': page(
    'title: Links\nid: DEMO-7\n',
    [
      '# Links',
      'By words: [[Trip plan|the trip]]. By ID: [[DEMO-4]]. To a heading: [[Long read#Second part]]. Here: [[#Last words]].',
      'A card: [[DEMO-40]]. Missing: [[No such page]]. Web: [a site](https://example.com/x).',
      'Relative: [the guide](notes/Folder%20guide.md#Step-two). Up and over: [notes](notes/Folder%20guide).',
      '## Last words',
      'The end.',
    ].join('\n\n'),
  ),
  'Long read.md': page('title: Long read\n', ['# Long read', 'Start.', '## First part', 'One.', '## Second part', 'Two. Back to [[Links]].'].join('\n\n')),
  'notes/Folder guide.md': page('title: Folder guide\n', ['# Folder guide', '## Step one', 'Up: [links](../Links.md).', '## Step two', 'Done.'].join('\n\n')),
}

let h: Harness | null = null
let flashed: string[] = []
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  flashed = []
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  HTMLElement.prototype.animate = function (this: HTMLElement) {
    flashed.push(this.textContent ?? '')
    return {} as Animation
  } as unknown as typeof HTMLElement.prototype.animate
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
const title = (x: Harness) => x.host.querySelector('.reader__title')?.textContent
const link = (x: Harness, text: string) => [...x.host.querySelectorAll<HTMLElement>('.reader__body a')].find((a) => a.textContent === text)!

async function openLinks(): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, FILES)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.button(/^Links, page/) !== null)
  await x.click(/^Links, page/)
  await waitFor(x, () => x.host.querySelector('.reader__body h2') !== null)
  return x
}
async function tap(x: Harness, text: string): Promise<void> {
  await act(async () => link(x, text).click())
}

describe('YAZ-5455: links open their page', () => {
  it('a wiki link with words, with an ID, and a card link open what they name; Back returns to the page', async () => {
    h = await openLinks()
    await tap(h, 'the trip')
    await waitFor(h, () => title(h!) === 'Trip plan')
    await h.click('Back')
    await waitFor(h, () => title(h!) === 'Links' && h!.host.querySelector('.reader__body h2') !== null)
    // An ID link shows its page's title, and opens it.
    await tap(h, 'Café notes')
    await waitFor(h, () => title(h!) === 'Café notes')
    await h.click('Back')
    await waitFor(h, () => title(h!) === 'Links' && h!.host.querySelector('.reader__body h2') !== null)
    await tap(h, 'Capital of Spain')
    await waitFor(h, () => h!.host.querySelector('.card-view') !== null)
    await h.click('Back')
    await waitFor(h, () => title(h!) === 'Links')
  })

  it('a link to a heading opens the page there; a heading of this page lands at once', async () => {
    h = await openLinks()
    await tap(h, 'Last words')
    expect(flashed).toEqual(['Last words'])
    expect(title(h)).toBe('Links')
    await tap(h, 'Long read > Second part')
    await waitFor(h, () => title(h!) === 'Long read' && flashed.length === 2)
    expect(flashed[1]).toBe('Second part')
  })

  it('headingLink_scrollsHeadingBelowTopBar: the landing is measured after the page title that repeats the H1 left the flow (S2)', async () => {
    // The drawn page's H1 says its title, so the reader's own title (`.reader__title`) hides (`--same`, out of the
    // flow): everything under it moves up by its height. A landing measured before that put the heading under the bar.
    const atFlash: string[] = []
    const flash = HTMLElement.prototype.animate
    HTMLElement.prototype.animate = function (this: HTMLElement, ...a: Parameters<typeof flash>) {
      atFlash.push(document.querySelector('.reader__title')?.className ?? '')
      return flash.apply(this, a)
    } as typeof flash
    h = await openLinks()
    await tap(h, 'Long read > Second part')
    await waitFor(h, () => title(h!) === 'Long read' && flashed.length === 1)
    expect(atFlash).toEqual(['reader__title reader__title--same'])
  })

  it('a relative Markdown link opens its page at its heading (a GitHub-style `#step-two`); `../` goes up; no `.md` reads as a page name', async () => {
    h = await openLinks()
    await tap(h, 'the guide')
    await waitFor(h, () => title(h!) === 'Folder guide' && flashed.length === 1)
    expect(flashed).toEqual(['Step two'])
    await tap(h, 'links')
    await waitFor(h, () => title(h!) === 'Links')
    await h.click('Back')
    await h.click('Back')
    await waitFor(h, () => title(h!) === 'Links' && h!.host.querySelector('.reader__body h2') !== null)
    await tap(h, 'notes')
    await waitFor(h, () => title(h!) === 'Folder guide')
  })

  it('a missing page: plain and dim, no address, and a tap does nothing; a web link opens Safari', async () => {
    h = await openLinks()
    const missing = link(h, 'No such page')
    expect(missing.className).toBe('wikilink wikilink--unresolved')
    expect(missing.hasAttribute('href')).toBe(false)
    expect(missing.getAttribute('aria-disabled')).toBe('true')
    await act(async () => missing.click())
    expect(title(h)).toBe('Links')
    expect(h.host.querySelector('.reader__notice')).toBeNull()
    const web = link(h, 'a site')
    expect([web.getAttribute('href'), web.getAttribute('target'), web.getAttribute('rel')]).toEqual(['https://example.com/x', '_blank', 'noopener noreferrer'])
  })
})

describe('YAZ-5455: "Linked mentions" at the end of a page', () => {
  it('collapsed with its count; open, each linking page once with its lines, the mention marked; a tap opens it', async () => {
    h = await openLinks()
    await tap(h, 'the trip')
    await waitFor(h, () => title(h!) === 'Trip plan' && h!.host.querySelector('.linked-mentions') !== null)
    // Trip plan is linked from Links and from Spanish words.
    const header = h.host.querySelector<HTMLButtonElement>('.linked-mentions__header')!
    expect(header.textContent).toBe('Linked mentions (2)')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(h.host.querySelector('.linked-mentions__list')).toBeNull()
    await act(async () => header.click())
    await waitFor(h, () => h!.host.querySelectorAll('.linked-mentions__line').length === 2)
    expect([...h.host.querySelectorAll('.linked-mentions__page')].map((b) => b.textContent)).toEqual(['Links', 'Spanish words'])
    expect([...h.host.querySelectorAll('.linked-mentions__match')].map((m) => m.textContent)).toEqual(['the trip', 'Trip plan'])
    await h.click('Links')
    await waitFor(h, () => title(h!) === 'Links')
    await h.click('Back')
    await waitFor(h, () => title(h!) === 'Trip plan')
  })

  it('an ID link counts; a page linked only by Markdown links shows no section (the Mac counts `[[links]]` and embeds only)', async () => {
    h = await openLinks()
    await tap(h, 'Café notes')
    await waitFor(h, () => title(h!) === 'Café notes' && h!.host.querySelector('.reader__body p') !== null)
    expect(h.host.querySelector('.linked-mentions__header')?.textContent).toBe('Linked mentions (1)')
    await h.click('Back')
    await waitFor(h, () => title(h!) === 'Links' && h!.host.querySelector('.reader__body h2') !== null)
    await tap(h, 'the guide')
    await waitFor(h, () => title(h!) === 'Folder guide' && h!.host.querySelector('.reader__body p') !== null)
    expect(h.host.querySelector('.linked-mentions')).toBeNull()
  })

  it('linkedFrom_drawsFirst20_thenMore: 47 linking pages draw 20, then "Show all 47" (S4; YAZ-5521)', async () => {
    const many = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`many/Fan ${String(i).padStart(2, '0')}.md`, page(`title: Fan ${String(i).padStart(2, '0')}\n`, 'Back to [[Trip plan]].')]))
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, { ...FILES, ...many })
    h = await mount({ phone })
    await h.click('Search')
    await waitFor(h, () => h!.button(/^Links, page/) !== null)
    await h.click(/^Links, page/)
    await waitFor(h, () => h!.host.querySelector('.reader__body h2') !== null)
    await tap(h, 'the trip')
    await waitFor(h, () => title(h!) === 'Trip plan' && h!.host.querySelector('.linked-mentions') !== null)
    expect(h.host.querySelector('.linked-mentions__header')?.textContent).toBe('Linked mentions (47)')
    await act(async () => h!.host.querySelector<HTMLButtonElement>('.linked-mentions__header')!.click())
    const entries = () => h!.host.querySelectorAll('.linked-mentions__entry').length
    const more = () => h!.host.querySelector<HTMLButtonElement>('.linked-mentions__more')
    expect(entries()).toBe(20)
    // YAZ-5521 (sweep2 nit 1): then all of them in one tap, when 100 or fewer are left.
    expect(more()?.textContent).toBe('Show all 47')
    await act(async () => more()!.click())
    expect(entries()).toBe(47)
    expect(more()).toBeNull()
    // Closed and opened again: the first 20 again.
    await act(async () => h!.host.querySelector<HTMLButtonElement>('.linked-mentions__header')!.click())
    await act(async () => h!.host.querySelector<HTMLButtonElement>('.linked-mentions__header')!.click())
    expect(entries()).toBe(20)
  })

  it('linkedFrom_showMore_growsInLargerSteps: 1,301 linking pages: 20, then 100 at a time, then all of what is left (sweep2 nit 1)', () => {
    const steps: string[] = []
    let shown = LINKED_MENTIONS_PAGE
    for (let more = moreStep(shown, 1301); more !== null; more = moreStep(shown, 1301)) {
      steps.push(more.label)
      shown += more.count
    }
    expect(shown).toBe(1301)
    expect(steps.length).toBe(13)
    expect(steps.slice(0, 2)).toEqual(['Show 100 more', 'Show 100 more'])
    expect(steps.at(-1)).toBe('Show all 1301')
    expect(moreStep(20, 47)).toEqual({ count: 27, label: 'Show all 47' })
    expect(moreStep(20, 20)).toBeNull()
  })

  // timing test: up to 3 tries so a busy CI machine doesn't fail it (YAZ-4965); still fails if slow every time
  it('1,300 pages: the reverse map is one pass, built once per version of the vault data, then free', { retry: 2 }, () => {
    const records = Array.from({ length: 1300 }, (_, i) => {
      const body = `# Page ${i}\n\nSee [[Page ${(i + 1) % 1300}]], [[Page ${(i + 7) % 1300}|seven on]] and [[Page ${(i * 13) % 1300}#Part]].\n\n${cardBlock(`DEMO-${i + 100}`, 'Q\n---\nA')}\n`
      return phoneRecord(`notes/${i % 20}/Page ${i}.md`, body.length, `---\ntitle: Page ${i}\n---\n\n${body}`, { ctime: 1, mtime: 1 })
    })
    const byPath = Object.fromEntries(records.map((r) => [r.path, r]))
    const data: VaultData = { vault: 'v', commit: 'c', byPath, records, folders: [], files: records.map((r) => r.path), letters: ['DEMO'], ids: true, review: {} as VaultData['review'], version: 1 }
    const t0 = performance.now()
    expect(linkedMentionsCount(data, 'notes/1/Page 1.md')).toBe(2)
    const first = performance.now() - t0
    const t1 = performance.now()
    for (let i = 0; i < 100; i++) linkedMentionsCount(data, `notes/${i % 20}/Page ${i}.md`)
    const next = (performance.now() - t1) / 100
    console.log(`[YAZ-5455] Linked mentions on 1,300 pages: first page ${first.toFixed(1)} ms (resolver + reverse map), each page after ${next.toFixed(3)} ms`)
    expect(first).toBeLessThan(400)
    expect(next).toBeLessThan(2)
  })
})
