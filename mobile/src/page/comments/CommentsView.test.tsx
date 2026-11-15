// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { readCommentsAndShape } from '@shared/comments'
import type { CommentsPort } from '../../comments/bridge'
import type { WaitingComment } from '../../comments/outbox'
import type { NewCommentInput } from '../../comments/sender'
import { APPROVED_UNDO_MS, CommentsView } from './CommentsView'

/** YAZ-5461: the page's comments (read only) and the Comment button with its box. Made-up comments; a fake list. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PAGE = [
  '---',
  'comments:',
  '  - {id: aaaa0001, n: 1, at: "2026-11-10T09:00:00Z", by: sam, body: "First thought"}',
  '  - {id: aaaa0002, n: 1, at: "2026-11-10T09:05:00Z", by: yaseen-a, reply_to: aaaa0001, body: "A reply"}',
  '  - {id: aaaa0003, n: 2, at: "2026-11-11T09:00:00Z", by: sam, title: Done, resolved: "2026-11-12T09:00:00Z", body: "Old point"}',
  '---',
  'Body',
].join('\n')

function fakePort(waiting: WaitingComment[] = []) {
  const added: NewCommentInput[] = []
  const undone: string[] = []
  const port: CommentsPort = {
    ready: async () => {},
    waiting: (path) => waiting.filter((w) => path === undefined || w.path === path),
    add: async (input) => {
      added.push(input)
      const c: WaitingComment = { id: `new${added.length}`, path: input.path, body: input.body, at: '2026-11-14T10:00:00Z', by: input.by, madeAt: Date.now(), notBefore: Date.now() + (input.holdMs ?? 0) }
      waiting.push(c)
      return c
    },
    undo: async (id) => (undone.push(id), true),
    discard: async () => true,
    subscribe: () => () => {},
  }
  return { port, added, undone }
}

let root: Root | null = null
let host: HTMLDivElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

async function mount(port: CommentsPort | null, text = PAGE, noun?: string) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const { comments, shape } = readCommentsAndShape(text)
  const names: Record<string, string> = { 'yaseen-a': 'Yaseen A' }
  await act(async () =>
    root!.render(createElement(CommentsView, { path: 'notes/plan.md', comments, shape, port, signer: async () => 'yaseen-a', nameOf: (h) => (h === undefined ? 'Someone' : (names[h] ?? h)), version: 0, ...(noun !== undefined && { noun }) })),
  )
}
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined
const click = async (name: string) => {
  const b = button(name)
  if (b === undefined) throw new Error(`No button ${name} in ${host.textContent}`)
  await act(async () => b.click())
}
const type = async (text: string) => {
  const box = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the comments of a page, read only', () => {
  it('number, who, when, words; a reply one level in; a resolved thread folded at the bottom', async () => {
    await mount(fakePort().port)
    const items = [...host.querySelectorAll('.page-comments__item')]
    expect(items.map((i) => i.querySelector('.page-comments__meta')?.textContent?.split(' · ')[0])).toEqual(['#1 sam', '#1.1 Yaseen A'])
    expect(items[0].textContent).toContain('First thought')
    expect(items[0].textContent).toMatch(/Nov/)
    expect(items[1].classList.contains('page-comments__item--reply')).toBe(true)
    expect(host.textContent).toContain('Comments · 2')
    expect(host.textContent).not.toContain('Old point')
    await click('▸ 1 resolved')
    const resolved = host.querySelector('.page-comments__item--resolved')!
    expect(resolved.textContent).toContain('#2 sam')
    expect(resolved.textContent).toContain('Done')
    expect(resolved.textContent).toContain('Old point')
  })

  it('a comment waiting to be sent shows at once; a refused one says why, with Discard', async () => {
    const waiting: WaitingComment[] = [
      { id: 'w1', path: 'notes/plan.md', body: 'On its way', at: '2026-11-14T10:00:00Z', by: 'yaseen-a', madeAt: 0, notBefore: 0 },
      { id: 'w2', path: 'notes/plan.md', body: 'Refused one', at: '2026-11-14T10:00:00Z', by: 'yaseen-a', madeAt: 0, notBefore: 0, refused: 'foreign' },
      { id: 'w3', path: 'other.md', body: 'Elsewhere', at: '2026-11-14T10:00:00Z', madeAt: 0, notBefore: 0 },
    ]
    await mount(fakePort(waiting).port)
    expect(host.textContent).toContain('Yaseen A · Waiting to send')
    expect(host.textContent).toContain('On its way')
    expect(host.textContent).toContain('uses "comments" for something else')
    expect(button('Discard')).toBeDefined()
    expect(host.textContent).not.toContain('Elsewhere')
  })
})

describe('a card file (YAZ-5477): the same block, its refusals name the card file', () => {
  it('a refused comment and a refused file say "card file", not "page"', async () => {
    const waiting: WaitingComment[] = [
      { id: 'w1', path: 'notes/plan.md', body: 'Gone one', at: '2026-11-14T10:00:00Z', madeAt: 0, notBefore: 0, refused: 'gone' },
      { id: 'w2', path: 'notes/plan.md', body: 'Odd one', at: '2026-11-14T10:00:00Z', madeAt: 0, notBefore: 0, refused: 'invalid' },
    ]
    await mount(fakePort(waiting).port, PAGE, 'card file')
    expect(host.textContent).toContain('This card file is no longer in the vault')
    expect(host.textContent).toContain("This card file's properties do not read correctly")
    expect(host.textContent).not.toMatch(/\bpage\b/)
  })
})

describe('the Comment button and its box', () => {
  it('waits for the list; one tap opens the box with the focus (the keyboard)', async () => {
    await mount(null, 'Body')
    expect(button('Comment')!.disabled).toBe(true)
    act(() => root!.unmount())
    await mount(fakePort().port, 'Body')
    await click('Comment')
    expect(document.activeElement).toBe(host.querySelector('textarea'))
    expect(button('Approved')).toBeDefined()
  })

  it('Send is off while the box is empty or blank; typed words go with Send, signed', async () => {
    const f = fakePort()
    await mount(f.port, 'Body')
    await click('Comment')
    expect(button('Send')!.disabled).toBe(true)
    await type('   \n ')
    expect(button('Send')!.disabled).toBe(true)
    await type('Please add the numbers')
    expect(button('Send')!.disabled).toBe(false)
    await click('Send')
    expect(f.added).toEqual([{ path: 'notes/plan.md', body: 'Please add the numbers', by: 'yaseen-a', holdMs: 0 }])
    expect(host.querySelector('textarea')).toBeNull() // the box closed
  })

  it('"Approved" posts in ONE tap, with a 4-second Undo in the box; Undo takes it back', async () => {
    const f = fakePort()
    await mount(f.port, 'Body')
    await click('Comment')
    await click('Approved')
    expect(f.added).toEqual([{ path: 'notes/plan.md', body: 'Approved', by: 'yaseen-a', holdMs: APPROVED_UNDO_MS }])
    expect(APPROVED_UNDO_MS).toBe(4000)
    expect(host.textContent).toContain('Approved · posting')
    await click('↶ Undo')
    expect(f.undone).toEqual(['new1'])
    expect(host.textContent).not.toContain('posting')
  })

  it('a page whose comments is not a comment list: the box says so and nothing is added', async () => {
    const f = fakePort()
    await mount(f.port, '---\ncomments: see the doc\n---\nBody')
    await click('Comment')
    await click('Approved')
    expect(f.added).toEqual([])
    expect(host.textContent).toContain('Nothing was changed.')
  })
})
