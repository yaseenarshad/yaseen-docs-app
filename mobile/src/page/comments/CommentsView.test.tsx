// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { readCommentsAndShape } from '@shared/comments'
import type { CommentsPort } from '../../comments/bridge'
import type { WaitingComment } from '../../comments/outbox'
import type { NewCommentInput } from '../../comments/sender'
import { CommentsCount, CommentsView } from './CommentsView'

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

describe('the inline box at the end of the comments (YAZ-5478)', () => {
  it('always there, after the comments, one quiet line; no floating button, no Undo', async () => {
    await mount(fakePort().port)
    const section = host.querySelector('.page-comments')!
    const box = section.querySelector('textarea')!
    expect(box.getAttribute('placeholder')).toBe('Add a comment…')
    expect(box.rows).toBe(1)
    // The box is the section's last part: every comment sits above it.
    const items = [...section.querySelectorAll('.page-comments__item')]
    for (const item of items) expect(item.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.querySelector('.page-comments__fab, .page-comments__dock')).toBeNull()
    expect(host.textContent).not.toMatch(/Undo|posting/)
  })

  it('a page with no comments: the section is there with its box, and no count', async () => {
    await mount(fakePort().port, 'Body')
    expect(host.querySelector('.page-comments__head')?.textContent).toBe('Comments')
    expect(host.querySelector('textarea')).not.toBeNull()
  })

  it('grows when it takes the focus; Comment is off while the box is empty or blank, and while the list loads', async () => {
    await mount(null, 'Body')
    expect(button('Comment')!.disabled).toBe(true)
    act(() => root!.unmount())
    await mount(fakePort().port, 'Body')
    const box = host.querySelector('textarea')!
    await act(async () => box.focus())
    expect(host.querySelector('textarea')!.rows).toBe(3)
    expect(button('Comment')!.disabled).toBe(true)
    await type('   \n ')
    expect(button('Comment')!.disabled).toBe(true)
  })

  it('typed words go with Comment, signed; the box empties and the comment shows as waiting', async () => {
    const f = fakePort()
    await mount(f.port, 'Body')
    await type('Please add the numbers')
    expect(button('Comment')!.disabled).toBe(false)
    await click('Comment')
    expect(f.added).toEqual([{ path: 'notes/plan.md', body: 'Please add the numbers', by: 'yaseen-a', holdMs: 0 }])
    expect(host.querySelector('textarea')!.value).toBe('')
    // The fake list holds it now; the view shows it on its next draw (the port's `subscribe`).
    act(() => root!.unmount())
    await mount(f.port, 'Body')
    expect(host.textContent).toContain('Yaseen A · Waiting to send')
  })

  it('"Approved" is a PRE-FILL: a tap puts it in the box and focuses it; nothing is sent until Comment', async () => {
    const f = fakePort()
    await mount(f.port, 'Body')
    await click('Approved')
    expect(f.added).toEqual([])
    expect(host.querySelector('textarea')!.value).toBe('Approved')
    expect(document.activeElement).toBe(host.querySelector('textarea'))
    // It can be changed before it goes.
    await type('Approved, with one note')
    await click('Comment')
    expect(f.added).toEqual([{ path: 'notes/plan.md', body: 'Approved, with one note', by: 'yaseen-a', holdMs: 0 }])
  })

  it('approvedChip_keepsTypedDraft: with words in the box, "Approved" goes in at the cursor; the words stay (S10)', async () => {
    const f = fakePort()
    await mount(f.port, 'Body')
    const box = host.querySelector('textarea')!
    await type('Looks good to me, ship it')
    // The cursor at the end (the person typed there): " Approved" after the words.
    act(() => box.focus())
    box.setSelectionRange(box.value.length, box.value.length)
    await click('Approved')
    expect(box.value).toBe('Looks good to me, ship it Approved')
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(box.value.length)
    // A second tap does not add it again.
    await click('Approved')
    expect(box.value).toBe('Looks good to me, ship it Approved')
    // The cursor in the middle (after "me,"): the word goes in there, spaced, with the cursor after it.
    await type('Looks good to me, ship it')
    box.setSelectionRange(17, 17)
    await click('Approved')
    expect(box.value).toBe('Looks good to me, Approved ship it')
    expect(box.selectionStart).toBe('Looks good to me, Approved'.length)
    // Not focused (the person tapped away): after the words.
    await type('Fine')
    act(() => box.blur())
    box.setSelectionRange(0, 0)
    await click('Approved')
    expect(box.value).toBe('Fine Approved')
    expect(f.added).toEqual([])
  })

  it('approvedTwice_thenTyping_keepsCaretAtEnd: a second "Approved" tap is a no-op; the selection and focus stay exactly (sweep2 S-A)', async () => {
    const f = fakePort()
    await mount(f.port, 'Body')
    const box = host.querySelector('textarea')!
    await click('Approved')
    expect(box.value).toBe('Approved')
    // The person selects part of the word, then taps Approved again: nothing moves.
    box.setSelectionRange(2, 5)
    await click('Approved')
    expect(box.value).toBe('Approved')
    expect([box.selectionStart, box.selectionEnd]).toEqual([2, 5])
    expect(document.activeElement).toBe(box)
    // The next letters land where they are typed (the caret at the end), not at a stale spot.
    box.setSelectionRange(8, 8)
    await type('Approved -')
    expect(box.value).toBe('Approved -')
    expect(box.selectionStart).toBe('Approved -'.length)
    await type('Approved - ship it')
    expect(box.selectionStart).toBe('Approved - ship it'.length)
  })

  it('approved_thenSystemUndo_doesNotDuplicateDraft: the fill is ONE native edit (insertText), so the system Undo takes it back whole (sweep3 N-1)', async () => {
    const f = fakePort()
    await mount(f.port, 'Body')
    const box = host.querySelector('textarea')!
    await type('Keep me')
    act(() => box.focus())
    box.setSelectionRange(7, 7)
    // A browser's insertText: the edit goes in at the selection, as typing would (one step on the Undo stack).
    const calls: [string, string | undefined, number, number][] = []
    const real = document.execCommand
    document.execCommand = (command: string, _ui?: boolean, value?: string) => {
      calls.push([command, value, box.selectionStart, box.selectionEnd])
      box.setRangeText(value ?? '', box.selectionStart, box.selectionEnd, 'end')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    try {
      await click('Approved')
    } finally {
      document.execCommand = real
    }
    expect(calls).toEqual([['insertText', ' Approved', 7, 7]])
    expect(box.value).toBe('Keep me Approved')
    expect(box.selectionStart).toBe('Keep me Approved'.length)
    // The system Undo (the browser puts the value back and says so): the box and the draft are the typed words, once.
    box.setRangeText('', 7, 16, 'end')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await type('Keep meX')
    expect(box.value).toBe('Keep meX')
  })

  it('a page whose comments is not a comment list: Comment says so and nothing is added', async () => {
    const f = fakePort()
    await mount(f.port, '---\ncomments: see the doc\n---\nBody')
    await click('Approved')
    await click('Comment')
    expect(f.added).toEqual([])
    expect(host.textContent).toContain('Nothing was changed.')
  })
})

describe('the comment count near the title (YAZ-5478)', () => {
  it('a speech bubble and the open count (resolved ones left out); none with no open comment; a tap goes to the comments', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const { comments } = readCommentsAndShape(PAGE)
    const article = document.createElement('article')
    host.append(article)
    const at = document.createElement('div')
    const section = document.createElement('section')
    section.className = 'page-comments'
    const went: unknown[] = []
    section.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => void went.push(arg)
    article.append(at, section)
    const r = createRoot(at)
    await act(async () => r.render(createElement(CommentsCount, { comments })))
    const b = at.querySelector('button')!
    expect(b.textContent).toBe('2')
    expect(b.querySelector('svg')).not.toBeNull()
    expect(b.getAttribute('aria-label')).toBe('2 comments. Go to the comments')
    await act(async () => b.click())
    expect(went).toEqual([{ block: 'start', behavior: 'smooth' }])
    await act(async () => r.render(createElement(CommentsCount, { comments: comments.filter((c) => c.resolved !== undefined) })))
    expect(at.querySelector('button')).toBeNull()
    act(() => r.unmount())
  })
})
