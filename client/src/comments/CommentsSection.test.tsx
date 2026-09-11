/**
 * The comment stream block (YAZ-1472): one test per locked ruling, mounted with react-dom in
 * jsdom, `api` mocked so every read / write is observable — the properties panel's harness.
 * The block writes through `views/writeProperty`'s `transformFile`, so the mock sits UNDER it:
 * `readFile` hands back the fresh bytes, `writeFile` receives the exact bytes that would land,
 * and the real read → transform → write dance is what runs. The pure model has its own tests
 * (`comments.test.ts`); nothing here re-proves it.
 *
 * Only `Date` is faked — a fixed clock makes "2 days ago" and the written `at` deterministic —
 * while timers stay real, so a write's promise chain settles on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readComments } from '@shared/comments'
import { CommentsSection } from './CommentsSection'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { BridgeRequestError, api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/Funnel.md'
/** The clock every relative stamp is read against, and the `at` every write stamps. */
const NOW = Date.parse('2026-09-13T20:00:00Z')
const ID = /^[0-9a-f]{8}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

const fileOf = (content: string, mtime = 100) => ({ path: PATH, content, mtime, size: content.length })

const note = (entries: string) => `---\ntitle: Funnel\ncomments:\n${entries}---\nBody\n`

/** One comment, no replies yet. */
const LONE = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    body: Parent comment
`)

/** LONE as the disk moved on after the prop was taken: the FRESH bytes a write must build on. */
const FRESHER = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    body: Parent comment
  - id: ffffffff
    at: 2026-09-12T20:00:00Z
    body: Landed meanwhile
`)

/** Deliberately out of `at` order on disk: a thread of two replies, a lone comment, an orphan reply. */
const THREADED = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    body: Parent comment
  - id: bbbbbbbb
    at: 2026-09-12T20:00:00Z
    reply_to: aaaaaaaa
    body: First reply
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: Earliest, filed last
  - id: dddddddd
    at: 2026-09-12T21:00:00Z
    reply_to: zzzzzzzz
    body: Orphan reply
  - id: eeeeeeee
    at: 2026-09-13T08:00:00Z
    reply_to: aaaaaaaa
    body: Second reply
`)

/** A titled comment after a title-less one whose first line carries a Markdown marker. */
const TITLED = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    title: Churn
    body: Parent comment
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: |-
      # Heading line
      More text
`)

const AGENT = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    by: agent
    body: Written by an agent
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: Written by nobody in particular
`)

const EMPTY = '---\ntitle: Funnel\n---\nBody\n'
const FOREIGN = '---\ntitle: Funnel\ncomments: text\n---\nBody\n'
const INVALID = '---\ntags: [a, b\nstatus: : :\n---\nBody\n'

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  readFile.mockReset()
  writeFile.mockReset()
  writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 10 })
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
})

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

/** Mount over `content`; the disk agrees with the prop unless a test says otherwise via `readFile`. */
function mount(content: string, mtime = 100): HTMLElement {
  unmount()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  readFile.mockResolvedValue(fileOf(content, mtime))
  act(() => root?.render(<CommentsSection file={{ path: PATH, content, mtime }} />))
  return container
}

// ---------- DOM helpers ----------

const must = <T,>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new Error(`no ${what}`)
  return value
}
const q = <T extends Element = HTMLElement>(scope: ParentNode, selector: string): T | null => scope.querySelector<T>(selector)
const all = <T extends Element = HTMLElement>(scope: ParentNode, selector: string): T[] => [...scope.querySelectorAll<T>(selector)]

const header = (el: ParentNode) => q<HTMLButtonElement>(el, 'button.comments__header')
const tool = (el: ParentNode) => q<HTMLButtonElement>(el, 'button.comments__tool')
const threads = (el: ParentNode) => all(el, '.comments__thread')
const articles = (scope: ParentNode) => all(scope, 'article.comments__item')
const bodyText = (article: ParentNode) => q(article, '.comments__body')?.textContent?.trim() ?? null
const repliesOf = (thread: ParentNode) => all(thread, '.comments__replies > article.comments__item').map(bodyText)
const bottomComposer = (el: ParentNode) => must(q<HTMLElement>(el, '.comments > .comments__composer'), 'bottom composer')
const textareaOf = (composer: ParentNode) => q<HTMLTextAreaElement>(composer, 'textarea.comments__textarea')
const titleInputOf = (composer: ParentNode) => q<HTMLInputElement>(composer, 'input.comments__title-input')
const submitOf = (composer: ParentNode) => q<HTMLButtonElement>(composer, 'button.btn--primary')
const buttonNamed = (scope: ParentNode, text: string) => all<HTMLButtonElement>(scope, 'button').find((b) => b.textContent?.trim() === text) ?? null
/** A row action (Reply / Edit / Delete) — never a composer's button. */
const action = (article: ParentNode, text: string) => all<HTMLButtonElement>(article, '.comments__action').find((b) => b.textContent?.trim() === text) ?? null

const click = (el: Element | null) => act(() => (el as HTMLElement | null)?.click())
const focus = (el: HTMLElement | null) => act(() => el?.focus())
const press = (el: Element | null, key: string, init: KeyboardEventInit = {}) =>
  act(() => void el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))

/** Native prototype setter + bubbling input event, so React's value tracker sees the change. */
function setValue(el: HTMLTextAreaElement | HTMLInputElement | null, value: string): void {
  if (el === null) throw new Error('no field')
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Let a write's read → transform → write → adopt chain settle (timers are real; only Date is faked). */
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })

/** Type into a composer (title too, when given), press its primary button, let the write land. */
async function submitVia(composer: HTMLElement, body: string, title?: string): Promise<void> {
  setValue(textareaOf(composer), body)
  if (title !== undefined) setValue(titleInputOf(composer), title)
  click(submitOf(composer))
  await flush()
}

/** The bytes the last write carried. */
const written = (): string => must(writeFile.mock.calls.at(-1), 'a write')[0].content

// ---------- render ----------

describe('CommentsSection — render', () => {
  it('threads render oldest-first by `at`, replies under their top-level parent, an orphan reply at top level', () => {
    const el = mount(THREADED)
    expect(threads(el).map((t) => bodyText(articles(t)[0]))).toEqual(['Earliest, filed last', 'Parent comment', 'Orphan reply'])
    expect(threads(el).map(repliesOf)).toEqual([[], ['First reply', 'Second reply'], []])
    // The orphan is its own root: no replies row, no reply group.
    expect(q(threads(el)[2], '.comments__replies-toggle')).toBeNull()
  })

  it('the header collapses everything below it and counts replies too', () => {
    const el = mount(THREADED)
    expect(header(el)?.getAttribute('aria-expanded')).toBe('true')
    expect(header(el)?.textContent).toBe('Comments (5)')

    click(header(el))
    expect(header(el)?.getAttribute('aria-expanded')).toBe('false')
    expect(q(el, '.comments__list')).toBeNull()
    expect(q(el, '.comments__composer')).toBeNull()
    expect(tool(el)).toBeNull()

    click(header(el))
    expect(q(el, '.comments__list')).not.toBeNull()
    expect(q(el, '.comments > .comments__composer')).not.toBeNull()
  })

  it('no count and no fold-all when there is nothing to count', () => {
    const el = mount(EMPTY)
    expect(header(el)?.textContent).toBe('Comments')
    expect(q(el, '.comments__count')).toBeNull()
    expect(tool(el)).toBeNull()
    expect(bottomComposer(el)).not.toBeNull()
  })

  it('relative stamps read against a fixed clock; the title holds the absolute local time', () => {
    const el = mount(THREADED)
    const times = all<HTMLTimeElement>(el, 'time.comments__when')
    // Document order: the earliest lone comment, the parent, its two replies, the orphan.
    expect(times.map((t) => t.textContent)).toEqual(['3 days ago', '2 days ago', 'yesterday', '12 hours ago', '23 hours ago'])
    expect(times[1].getAttribute('datetime')).toBe('2026-09-11T20:00:00Z')
    expect(times[1].title).toBe(new Date('2026-09-11T20:00:00Z').toLocaleString())
  })
})

// ---------- fold ----------

describe('CommentsSection — fold', () => {
  it('one fold-all control: Collapse all while anything is open, Expand all once every comment AND every reply group is folded', () => {
    const el = mount(THREADED)
    expect(all(el, 'button.comments__tool')).toHaveLength(1)
    expect(tool(el)?.textContent).toBe('Collapse all')

    click(tool(el))
    expect(tool(el)?.textContent).toBe('Expand all')
    expect(q(el, '.comments__body')).toBeNull()
    expect(q(el, '.comments__replies')).toBeNull()
    expect(q(el, '.comments__replies-toggle')?.getAttribute('aria-expanded')).toBe('false')
    expect(all(el, 'button.comments__fold').map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])

    click(tool(el))
    expect(tool(el)?.textContent).toBe('Collapse all')
    expect(all(el, '.comments__body')).toHaveLength(5)
    expect(all(el, 'button.comments__fold').every((b) => b.getAttribute('aria-expanded') === 'true')).toBe(true)

    // Every comment folded by hand is not "all folded" while the reply group is still open.
    all(el, 'button.comments__fold').forEach((b) => click(b))
    expect(q(el, '.comments__body')).toBeNull()
    expect(tool(el)?.textContent).toBe('Collapse all')
    click(q(el, '.comments__replies-toggle'))
    expect(tool(el)?.textContent).toBe('Expand all')
  })

  it('a comment folds to one line: the body goes, a title keeps its seat, a title-less comment shows its first line (marker stripped) only while folded', () => {
    const el = mount(TITLED)
    const [plain, titled] = articles(el)
    expect(q(plain, '.comments__summary')).toBeNull()
    expect(q(plain, '.comments__body h1')?.textContent).toBe('Heading line')
    expect(q(titled, '.comments__summary--title')?.textContent).toBe('Churn')
    expect(bodyText(titled)).toBe('Parent comment')

    click(q(plain, 'button.comments__fold'))
    expect(q(plain, 'button.comments__fold')?.getAttribute('aria-expanded')).toBe('false')
    expect(q(plain, '.comments__body')).toBeNull()
    expect(q(plain, '.comments__summary')?.textContent).toBe('Heading line')

    click(q(titled, 'button.comments__fold'))
    expect(q(titled, '.comments__body')).toBeNull()
    expect(all(titled, '.comments__summary').map((s) => s.textContent)).toEqual(['Churn'])

    click(q(plain, 'button.comments__fold'))
    expect(q(plain, '.comments__summary')).toBeNull()
    expect(q(plain, '.comments__body h1')?.textContent).toBe('Heading line')
  })

  it('the "N replies" row folds the replies and the in-card reply composer together', () => {
    const el = mount(THREADED)
    const thread = threads(el)[1]
    const toggle = q<HTMLButtonElement>(thread, 'button.comments__replies-toggle')
    expect(toggle?.textContent).toBe('2 replies')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(repliesOf(thread)).toEqual(['First reply', 'Second reply'])
    expect(q(thread, '.comments__replies > .comments__composer')).not.toBeNull()

    click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(q(thread, '.comments__replies')).toBeNull()

    click(toggle)
    expect(repliesOf(thread)).toEqual(['First reply', 'Second reply'])
    expect(q(thread, '.comments__replies > .comments__composer')).not.toBeNull()
  })
})

// ---------- composer ----------

describe('CommentsSection — composer', () => {
  it('a textarea; the title line once in use; Comment disabled while blank; ⌘Enter submits, Enter alone does not', async () => {
    const el = mount(LONE)
    const composer = bottomComposer(el)
    const textarea = textareaOf(composer)
    expect(textarea?.placeholder).toBe('Leave a comment…')
    expect(titleInputOf(composer)).toBeNull()
    expect(submitOf(composer)?.textContent).toBe('Comment')
    expect(submitOf(composer)?.disabled).toBe(true)

    focus(textarea)
    expect(titleInputOf(composer)?.placeholder).toBe('Title (optional)')
    expect(submitOf(composer)?.disabled).toBe(true)

    setValue(textarea, 'Typed')
    expect(submitOf(composer)?.disabled).toBe(false)

    press(textarea, 'Enter')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()

    press(textarea, 'Enter', { metaKey: true })
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(textarea?.value).toBe('')
  })

  it('Esc clears the draft, body and title', () => {
    const el = mount(LONE)
    const composer = bottomComposer(el)
    setValue(textareaOf(composer), 'Draft')
    setValue(titleInputOf(composer), 'Working title')

    press(textareaOf(composer), 'Escape')
    expect(textareaOf(composer)?.value).toBe('')
    expect(titleInputOf(composer)).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('submit writes addComment over the FRESH bytes, and the block adopts what landed without a watcher', async () => {
    const el = mount(LONE)
    readFile.mockResolvedValue(fileOf(FRESHER, 150))

    await submitVia(bottomComposer(el), 'New comment', 'Hello')

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [request] = writeFile.mock.calls[0]
    expect(request).toMatchObject({ path: PATH, expectedMtime: 150 })
    // The entry the disk did not have when the prop was taken is still there: fresh bytes, not the prop.
    expect(request.content).toContain('    body: Landed meanwhile\n')
    expect(request.content).toMatch(/ {2}- id: "?[0-9a-f]{8}"?\n {4}at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n {4}title: Hello\n {4}body: New comment\n---\n/)
    expect(readComments(request.content).at(-1)).toMatchObject({ id: expect.stringMatching(ID), at: expect.stringMatching(ISO), title: 'Hello', body: 'New comment' })

    // On screen from the returned content alone — no rerender, no watcher event.
    expect(articles(el).map(bodyText)).toEqual(['Parent comment', 'Landed meanwhile', 'New comment'])
    expect(header(el)?.textContent).toBe('Comments (3)')
    expect(textareaOf(bottomComposer(el))?.value).toBe('')
  })

  it('a blank title writes no title key', async () => {
    const el = mount(LONE)
    await submitVia(bottomComposer(el), 'Untitled', '   ')
    expect(written()).toMatch(/ {2}- id: "?[0-9a-f]{8}"?\n {4}at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n {4}body: Untitled\n---\n/)
    expect(readComments(written()).at(-1)).not.toHaveProperty('title')
  })
})

// ---------- reply ----------

describe('CommentsSection — reply', () => {
  it('a lone comment offers Reply: the composer opens inside the card with focus and writes reply_to', async () => {
    const el = mount(LONE)
    expect(q(el, '.comments__replies')).toBeNull()

    click(action(articles(el)[0], 'Reply'))
    const composer = must(q<HTMLElement>(el, '.comments__replies > .comments__composer'), 'reply composer')
    expect(textareaOf(composer)?.placeholder).toBe('Reply…')
    expect(document.activeElement).toBe(textareaOf(composer))

    await submitVia(composer, 'A reply')
    expect(written()).toContain('    reply_to: aaaaaaaa\n')
    expect(readComments(written()).at(-1)).toMatchObject({ reply_to: 'aaaaaaaa', body: 'A reply' })

    // Now a thread: the seat closed, the card carries its own reply row and no Reply action.
    expect(repliesOf(threads(el)[0])).toEqual(['A reply'])
    expect(q(el, 'button.comments__replies-toggle')?.textContent).toBe('1 reply')
    expect(action(articles(el)[0], 'Reply')).toBeNull()
  })

  it('a threaded card carries its own Reply… row and NO Reply action; submitting it writes reply_to the parent', async () => {
    const el = mount(THREADED)
    const thread = threads(el)[1]
    expect(all(thread, '.comments__action').filter((b) => b.textContent?.trim() === 'Reply')).toHaveLength(0)

    const composer = must(q<HTMLElement>(thread, '.comments__replies > .comments__composer'), 'thread reply composer')
    expect(composer.classList.contains('comments__composer--collapsed')).toBe(true)
    expect(textareaOf(composer)?.placeholder).toBe('Reply…')
    expect(submitOf(composer)).toBeNull()

    setValue(textareaOf(composer), 'Third reply')
    expect(composer.classList.contains('comments__composer--collapsed')).toBe(false)
    expect(submitOf(composer)?.textContent).toBe('Reply')

    click(submitOf(composer))
    await flush()
    expect(readComments(written()).at(-1)).toMatchObject({ reply_to: 'aaaaaaaa', body: 'Third reply' })
    expect(repliesOf(threads(el)[1])).toEqual(['First reply', 'Second reply', 'Third reply'])
  })
})

// ---------- edit and delete ----------

describe('CommentsSection — edit and delete', () => {
  it('Edit replaces the body with a composer prefilled with body AND title; Save writes edited and the new title', async () => {
    const el = mount(TITLED)
    const titled = articles(el)[1]

    click(action(titled, 'Edit'))
    const composer = must(q<HTMLElement>(titled, '.comments__composer'), 'edit composer')
    expect(q(titled, '.comments__body')).toBeNull()
    expect(textareaOf(composer)?.value).toBe('Parent comment')
    expect(titleInputOf(composer)?.value).toBe('Churn')

    setValue(textareaOf(composer), 'Parent comment revised')
    setValue(titleInputOf(composer), 'Churn revisited')
    click(buttonNamed(composer, 'Save'))
    await flush()

    expect(written()).toMatch(/ {4}title: Churn revisited\n {4}edited: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n {4}body: Parent comment revised\n/)
    expect(readComments(written()).find((c) => c.id === 'aaaaaaaa')).toMatchObject({ title: 'Churn revisited', body: 'Parent comment revised', edited: expect.stringMatching(ISO) })

    const after = articles(el)[1]
    expect(q(after, '.comments__composer')).toBeNull()
    expect(bodyText(after)).toBe('Parent comment revised')
    expect(q(after, '.comments__summary--title')?.textContent).toBe('Churn revisited')
    expect(q(after, '.comments__edited')?.textContent).toBe('(edited)')
  })

  it('a blank title on Save removes the title key', async () => {
    const el = mount(TITLED)
    const titled = articles(el)[1]
    click(action(titled, 'Edit'))
    const composer = must(q<HTMLElement>(titled, '.comments__composer'), 'edit composer')

    setValue(titleInputOf(composer), '')
    click(buttonNamed(composer, 'Save'))
    await flush()

    expect(written()).not.toContain('    title:')
    expect(readComments(written()).find((c) => c.id === 'aaaaaaaa')).not.toHaveProperty('title')
    expect(q(articles(el)[1], '.comments__summary--title')).toBeNull()
  })

  it('Cancel restores the body without a write', () => {
    const el = mount(TITLED)
    const titled = articles(el)[1]
    click(action(titled, 'Edit'))
    const composer = must(q<HTMLElement>(titled, '.comments__composer'), 'edit composer')
    setValue(textareaOf(composer), 'scrapped')

    click(buttonNamed(composer, 'Cancel'))
    expect(q(titled, '.comments__composer')).toBeNull()
    expect(bodyText(titled)).toBe('Parent comment')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('Delete on a parent removes its replies from the written bytes', async () => {
    const el = mount(THREADED)
    click(action(articles(threads(el)[1])[0], 'Delete'))
    await flush()

    expect(readComments(written()).map((c) => c.id)).toEqual(['cccccccc', 'dddddddd'])
    expect(threads(el).map((t) => bodyText(articles(t)[0]))).toEqual(['Earliest, filed last', 'Orphan reply'])
    expect(header(el)?.textContent).toBe('Comments (2)')
  })
})

// ---------- by ----------

describe('CommentsSection — by', () => {
  it('`by` marks the article as an agent’s and shows the raw value after the time; without it, neither', () => {
    const el = mount(AGENT)
    const [plain, agent] = articles(el)

    expect(agent.classList.contains('comments__item--agent')).toBe(true)
    const by = must(q<HTMLElement>(agent, '.comments__by'), 'by')
    expect(by.textContent).toBe('(agent)')
    const time = must(q<HTMLElement>(agent, 'time.comments__when'), 'time')
    expect(time.compareDocumentPosition(by) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(plain.classList.contains('comments__item--agent')).toBe(false)
    expect(q(plain, '.comments__by')).toBeNull()
  })
})

// ---------- shapes ----------

describe('CommentsSection — shapes', () => {
  it('a foreign `comments` value: the notice, no composer, no write on any interaction', () => {
    const el = mount(FOREIGN)
    expect(q(el, '.comments__notice')?.textContent).toContain("isn't a comment list")
    expect(q(el, '.comments__composer')).toBeNull()
    expect(q(el, '.comments__list')).toBeNull()
    expect(header(el)?.textContent).toBe('Comments')

    click(header(el))
    click(header(el))
    expect(q(el, '.comments__notice')).not.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a properties block that does not parse: the "doesn\'t parse" notice, no composer, no write', () => {
    const el = mount(INVALID)
    expect(q(el, '.comments__notice')?.textContent).toContain("doesn't parse")
    expect(q(el, '.comments__composer')).toBeNull()

    click(header(el))
    click(header(el))
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

// ---------- errors ----------

describe('CommentsSection — errors', () => {
  it('a failed write shows one alert line and keeps the draft; the block stays usable', async () => {
    const el = mount(LONE)
    writeFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const composer = bottomComposer(el)

    await submitVia(composer, 'Keep me')
    const alerts = all(el, '[role="alert"].comments__error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].textContent).toBe('Could not save the comment: disk on fire')
    expect(textareaOf(composer)?.value).toBe('Keep me')
    expect(submitOf(composer)?.disabled).toBe(false)
    expect(articles(el)).toHaveLength(1)

    click(submitOf(composer))
    await flush()
    expect(q(el, '.comments__error')).toBeNull()
    expect(articles(el).map(bodyText)).toEqual(['Parent comment', 'Keep me'])
    expect(textareaOf(composer)?.value).toBe('')
  })
})
