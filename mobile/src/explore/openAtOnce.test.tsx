// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { closeAll } from './sheets'

/**
 * YAZ-5589: ANY page opens at once, drawn (not only Today's): from a Search row, a link in a page, a link into an
 * Explore panel, the page arrows. jsdom paints nothing, so a "frame" here is what the screen holds at the end of each
 * task (the browser may paint between two tasks): the first one that shows the opened page already has its title AND
 * its text, and none is the empty waiting screen. Once drawn, the reads that follow (the stored text again, the vault's
 * data, its look) draw nothing a second time: the page's text and its cards' strips are all there in that first frame.
 * The layout proof checks the same frames after a real tap in Chrome (`publish/proveLayout.ts`). Made-up vault only.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  closeAll()
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

async function openSearch(files: Record<string, string | Uint8Array> = READER_FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  return x
}

interface Frame {
  title: string | null
  /** The text of the top panel, else of the page (spaces collapsed). */
  body: string
  sheet: boolean
  busy: boolean
  /** The strips under the page's cards. */
  strips: number
}
const snap = (x: Harness): Frame => {
  const sheet = [...document.querySelectorAll('.explore-sheet')].at(-1) ?? null
  const body = (sheet ?? x.host).querySelector('.reader__body')
  return {
    title: x.host.querySelector('.topbar__title')?.textContent ?? null,
    body: (body?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    sheet: sheet !== null,
    busy: document.querySelector('[aria-busy="true"]') !== null,
    strips: x.host.querySelectorAll('.reader__body .card__reviews').length,
  }
}

/**
 * The screen at the end of each task with a change, from now: a mutation arms a timer, which reads the screen once the
 * task (and its promises) is over. Then `frames()`; `bodyChanges()`: the changes in the page's text after `from`.
 */
function watchFrames(x: Harness) {
  const frames: Frame[] = []
  let armed = false
  const changes: number[] = []
  const watch = new MutationObserver((records) => {
    for (const r of records) if ((r.target as Element).closest?.('.reader__body') != null) changes.push(frames.length)
    if (armed) return
    armed = true
    setTimeout(() => {
      armed = false
      frames.push(snap(x))
    })
  })
  watch.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  return {
    stop: () => (watch.disconnect(), frames),
    /** Changes in a page's body that came after frame `i`. */
    changesAfter: (i: number) => changes.filter((at) => at > i).length,
  }
}

const tap = async (el: Element | null | undefined) => {
  if (el == null) throw new Error('nothing to tap')
  await act(async () => (el as HTMLElement).click())
}
const row = (x: Harness, name: RegExp) => [...x.host.querySelectorAll('.tree__row')].find((b) => name.test(b.getAttribute('aria-label') ?? ''))
const link = (x: Harness, words: string) => [...x.host.querySelectorAll<HTMLElement>('.reader__body [data-open]')].find((a) => a.textContent === words)

describe('YAZ-5589: any page opens at once, drawn', () => {
  it('searchOpen_firstFrameHasTitleAndText: a Search row: the first frame of the page has its title and its text, never the waiting screen', async () => {
    h = await openSearch()
    const seen = watchFrames(h)
    await tap(row(h, /^Trip plan, page/))
    await waitFor(h, () => /Madrid, May 3/.test(snap(h!).body))
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
    const frames = seen.stop()
    expect(frames.filter((f) => f.busy)).toEqual([])
    const first = frames.find((f) => f.title === 'Trip plan')
    expect(first?.body).toMatch(/^Madrid, May 3 to 10/)
  })

  it('linkOpen_firstFrameHasTitleAndText: a link in a page: its first frame has the title and the text', async () => {
    h = await openSearch()
    await tap(row(h, /^Trip plan, page/))
    await waitFor(h, () => link(h!, 'Spanish words') !== undefined)
    const seen = watchFrames(h)
    await tap(link(h, 'Spanish words'))
    await waitFor(h, () => /Words for a trip/.test(snap(h!).body))
    const frames = seen.stop()
    expect(frames.filter((f) => f.busy)).toEqual([])
    expect(frames.find((f) => f.title === 'Spanish words')?.body).toMatch(/Words for a trip to Madrid/)
  })

  it('a link into an Explore panel (the vault says "explore"): the panel comes up with its text drawn', async () => {
    h = await openSearch({ ...READER_FILES, '.yaseendocs/link-click.json': '{"click":"explore"}' })
    await tap(row(h, /^Trip plan, page/))
    await waitFor(h, () => link(h!, 'Spanish words') !== undefined)
    const seen = watchFrames(h)
    await tap(link(h, 'Spanish words'))
    await waitFor(h, () => snap(h!).sheet && /Words for a trip/.test(snap(h!).body))
    const frames = seen.stop()
    expect(frames.find((f) => f.sheet)?.body).toMatch(/Words for a trip to Madrid/)
  })

  it('the page arrows: the next page\'s first frame has its title and its text', async () => {
    h = await openSearch()
    await tap(row(h, /^Café notes, page/))
    await waitFor(h, () => /straße/.test(snap(h!).body) && h!.host.querySelector('.page-arrows__go--after') !== null)
    const seen = watchFrames(h)
    await tap(h.host.querySelector('.page-arrows__go--after'))
    await waitFor(h, () => /Words for a trip/.test(snap(h!).body))
    const frames = seen.stop()
    expect(frames.filter((f) => f.busy)).toEqual([])
    expect(frames.find((f) => f.title === 'Spanish words')?.body).toMatch(/Words for a trip to Madrid/)
  })

  it('noSecondPaint_whenNothingChanged: once a page is drawn, the reads after it change nothing in its text (its card strips in the first frame)', async () => {
    h = await openSearch()
    await tap(row(h, /^git, folder/))
    const seen = watchFrames(h)
    await tap(row(h, /^Git cheat sheet, page/))
    await waitFor(h, () => /Fetch and merge/.test(snap(h!).body))
    // The stored text read again, the vault's data and look, an unrelated sync pass: none of it draws again.
    await act(async () => void (await new Promise((r) => setTimeout(r, 300))))
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: [], diff: { added: [], changed: ['Café notes.md'], removed: [], renamed: [] } })
    await act(async () => void (await new Promise((r) => setTimeout(r, 300))))
    const frames = seen.stop()
    const first = frames.findIndex((f) => f.title === 'Git cheat sheet')
    expect(frames[first]?.body).toMatch(/Short notes/)
    expect(frames[first]?.strips).toBe(1)
    expect(seen.changesAfter(first)).toBe(0)
  })
})
