/** YAZ-4615 item 12 (subissue 2B): the comment block reads the comment list ONCE for each content, not on every render. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readCommentsAndShape } from '@shared/comments'
import { CommentsSection } from './CommentsSection'

vi.mock('@shared/comments', async (importOriginal) => {
  const real = await importOriginal<typeof import('@shared/comments')>()
  return { ...real, readCommentsAndShape: vi.fn(real.readCommentsAndShape) }
})
vi.mock('../api', () => ({ api: { readFile: vi.fn(), writeFile: vi.fn(), shell: { openLink: vi.fn() } } }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const reads = vi.mocked(readCommentsAndShape)
const page = (body: string) => `---\ntitle: Plan\ncomments:\n  - id: aaaaaaaa\n    n: 1\n    at: 2026-09-11T20:00:00Z\n    body: ${body}\n---\nBody\n`

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
})

describe('CommentsSection: one parse per content', () => {
  it('a fold, a new order or a re-render with the same content parses nothing; new content parses once', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const render = (content: string, order: 'oldest' | 'newest' = 'oldest') =>
      act(() => root?.render(<CommentsSection file={{ path: '/v/plan.md', content }} order={order} onChangeOrder={() => undefined} />))
    render(page('First'))
    const afterMount = reads.mock.calls.length
    expect(afterMount).toBe(1)

    render(page('First'))
    render(page('First'), 'newest')
    act(() => host?.querySelector<HTMLButtonElement>('button.comments__header')?.click())
    act(() => host?.querySelector<HTMLButtonElement>('button.comments__header')?.click())
    expect(reads.mock.calls.length).toBe(afterMount)

    render(page('Second'))
    expect(reads.mock.calls.length).toBe(afterMount + 1)
  })
})
