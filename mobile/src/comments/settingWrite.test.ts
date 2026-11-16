import { describe, expect, it } from 'vitest'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { readPageSwitches, writePageSwitch } from '@shared/pageSwitches'
import { FIT_TABLES_KEY, applySetting, switchOf } from './settingWrite'
import { notSentWords } from '../status/NotSent'
import type { WaitingComment } from './outbox'
import { commentsSetup, isPatch } from './testing'

/**
 * YAZ-5568: "Folding on this page" from the phone's ⋯ writes the Mac's page setting (`folding: true | false`,
 * `shared/pageSwitches.ts`), only that line, and the Mac reads it back with its own parser. Made-up pages only.
 */
const off = { key: 'folding', on: false } as const
const on = { key: 'folding', on: true } as const
const props = (text: string) => parseFrontmatter(splitFrontmatter(text).frontmatter).properties

describe('YAZ-5568: the page setting write (folding)', () => {
  it('reads and writes as the Mac\'s readPageSwitches / writePageSwitch', () => {
    for (const page of ['x\n', '---\ntitle: A\n---\nx\n', '---\nfolding: false\n---\nx\n', '---\nfolding: true\n---\nx\n', '---\nfolding: "no"\n---\nx\n', '---\ntoc: true\nfolding: false\n---\nx\n'])
      for (const want of [true, false]) {
        expect(switchOf(page, 'folding')).toBe(readPageSwitches(page).folding)
        const a = applySetting(page, { key: 'folding', on: want })
        const mac = writePageSwitch(page, 'folding', want)
        if (a.kind === 'already') expect(mac).toBe(page)
        else if (a.kind === 'set') expect(readPageSwitches(a.content)).toEqual(readPageSwitches(mac))
        else throw new Error(JSON.stringify(a))
      }
  })

  it('round trip with the Mac: the phone writes `folding: false`, the Mac\'s parser reads it off; then on again', () => {
    const page = '---\ntitle: Garden plan\ntags: [garden, spring]\n---\n\n# Garden plan\n\nBeds.\n'
    const a = applySetting(page, off)
    expect(a).toEqual({ kind: 'set', content: '---\ntitle: Garden plan\ntags: [garden, spring]\nfolding: false\n---\n\n# Garden plan\n\nBeds.\n' })
    if (a.kind !== 'set') throw new Error()
    expect(readPageSwitches(a.content)).toEqual({ folding: false })
    // The Mac's own writer gives the same page here.
    expect(a.content).toBe(writePageSwitch(page, 'folding', false))
    const b = applySetting(a.content, on)
    if (b.kind !== 'set') throw new Error()
    expect(readPageSwitches(b.content)).toEqual({ folding: true })
    expect(b.content).toBe('---\ntitle: Garden plan\ntags: [garden, spring]\nfolding: true\n---\n\n# Garden plan\n\nBeds.\n')
  })

  it('every other byte of the block stays (the Mac\'s writer alone would lay it out again): spacing, quotes, flow lists, YAML comments, CRLF', () => {
    const page = '---\r\n# a note for agents\r\ntitle:   "Garden plan"\r\ntags: [garden,spring]\r\nfolding: true   # set on the Mac\r\nwhen: 2026-11-15\r\n---\r\nBody text.\r\n'
    const a = applySetting(page, off)
    if (a.kind !== 'set') throw new Error(JSON.stringify(a))
    expect(a.content).toBe(page.replace('folding: true', 'folding: false'))
    expect(readPageSwitches(a.content).folding).toBe(false)
    const { folding: _a, ...before } = props(page)
    const { folding: _b, ...after } = props(a.content)
    expect(after).toEqual(before)
  })

  it('a page with no block gets the Mac\'s new block; a byte order mark stays first', () => {
    const a = applySetting('\uFEFF# Notes\n\nText.\n', off)
    if (a.kind !== 'set') throw new Error()
    expect(a.content).toBe('\uFEFF---\nfolding: false\n---\n# Notes\n\nText.\n')
    expect(readPageSwitches(a.content).folding).toBe(false)
    expect(splitFrontmatter(a.content).body).toBe('# Notes\n\nText.\n')
  })

  it('idempotent: a page already so writes nothing (a retry); a block that does not parse is refused, nothing written', () => {
    expect(applySetting('---\nfolding: false\n---\nx\n', off)).toEqual({ kind: 'already' })
    expect(applySetting('---\ntitle: [unclosed\n---\nx\n', off)).toEqual({ kind: 'refused', why: 'invalid' })
    expect(applySetting('---\n{title: A, folding: true}\n---\nx\n', off)).toEqual({ kind: 'refused', why: 'layout' })
  })
})

describe('YAZ-5658: Wide tables on this page (`fit-tables`), three choices', () => {
  const page = '---\r\ntitle:   "Day plan"\r\ntags: [day]\r\n---\r\n| Time | Plan |\r\n'
  it('Fit Screen and Same as Desktop write the one line; Mobile Vault Default takes it away, every other byte as it was', () => {
    const fit = applySetting(page, { key: FIT_TABLES_KEY, on: true })
    if (fit.kind !== 'set') throw new Error(JSON.stringify(fit))
    expect(fit.content).toBe('---\r\ntitle:   "Day plan"\r\ntags: [day]\r\nfit-tables: true\r\n---\r\n| Time | Plan |\r\n')
    const scroll = applySetting(fit.content, { key: FIT_TABLES_KEY, on: false })
    if (scroll.kind !== 'set') throw new Error(JSON.stringify(scroll))
    expect(switchOf(scroll.content, FIT_TABLES_KEY)).toBe(false)
    const same = applySetting(scroll.content, { key: FIT_TABLES_KEY, on: null })
    expect(same).toEqual({ kind: 'set', content: page })
    // Already Mobile Vault Default: nothing to write (a retry).
    expect(applySetting(page, { key: FIT_TABLES_KEY, on: null })).toEqual({ kind: 'already' })
    // The key in the middle of the block, with a YAML comment after it on its line.
    const mid = '---\ntitle: A\nfit-tables: true # phone\nwhen: 2026-11-16\n---\nx\n'
    expect(applySetting(mid, { key: FIT_TABLES_KEY, on: null })).toEqual({ kind: 'set', content: '---\ntitle: A\nwhen: 2026-11-16\n---\nx\n' })
  })

  it('the not-sent row names the choice', () => {
    const w = (on: boolean | null): WaitingComment => ({ id: 'x', path: 'Day.md', body: '', at: '', madeAt: 0, notBefore: 0, setting: { key: FIT_TABLES_KEY, on } })
    expect([true, false, null].map((on) => notSentWords(w(on)))).toEqual(['Wide tables on this page: Fit Screen', 'Wide tables on this page: Same as Desktop', 'Wide tables on this page: Mobile Vault Default'])
  })
})

describe('YAZ-5568: the setting goes the comments\' safe path (fake GitHub, made-up vault)', () => {
  const PAGE = 'garden/Plan.md'
  const TEXT = '---\ntitle:   Plan\n---\n\n# Plan\n\n## Beds\n\nTomatoes.\n'

  it('one commit with compare-and-swap; only the `folding` line added; the Mac\'s parser reads it; nothing waits after', async () => {
    const t = await commentsSetup({ [PAGE]: TEXT })
    await t.port.add({ path: PAGE, body: '', setting: off })
    await t.settle()
    const page = (await t.remote(PAGE))!
    expect(page).toBe('---\ntitle:   Plan\nfolding: false\n---\n\n# Plan\n\n## Beds\n\nTomatoes.\n')
    expect(readPageSwitches(page).folding).toBe(false)
    expect(t.patches()).toBe(1)
    expect(t.s.github.calls.some((c) => c.method === 'PATCH' && c.url.includes('force=true'))).toBe(false)
    expect(t.port.waiting()).toEqual([])
    expect((await t.s.store.read('yaseen/vault@main', PAGE))?.content).toBe(page)
  })

  it('the race: the Mac edits the page just before the ref move; the phone writes the setting again on the fresh page', async () => {
    const t = await commentsSetup({ [PAGE]: TEXT })
    const mac = TEXT.replace('Tomatoes.', 'Tomatoes and basil.')
    let raced = false
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        await t.macPush({ [PAGE]: mac })
      }
      return forward()
    })
    await t.port.add({ path: PAGE, body: '', setting: off })
    await t.settle()
    const page = (await t.remote(PAGE))!
    expect(page).toBe(mac.replace('title:   Plan\n', 'title:   Plan\nfolding: false\n'))
    expect(t.patches()).toBe(2)
  })
})
