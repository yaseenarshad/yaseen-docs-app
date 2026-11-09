/** YAZ-4705 (6C), YAZ-4706 (6D): who a writer is, for cards the people file holds but the app cannot show, and for handles that are names on Object.prototype. Found by the checker, round 2. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CommentsSection } from './CommentsSection'
import { CommentPrefsContext } from './usePeople'
import { PEOPLE_MAX } from '@shared/people'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), shell: { openLink: vi.fn() }, vaultConfig: { read: vi.fn(), write: vi.fn(), onChange: vi.fn(() => () => undefined) } },
}))
import { api } from '../api'
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let box: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  box?.remove()
  root = null
})

const PATH = '/v/Funnel.md'
const note = (by: string) => `---\ntitle: Funnel\ncomments:\n  - id: aaaaaaaa\n    n: 1\n    at: 2026-09-11T20:00:00Z\n    by: ${by}\n    body: Hello\n---\nBody\n`

async function writerRow(vault: string, by: string, people: unknown) {
  vi.mocked(api.vaultConfig.read).mockResolvedValue(people as never)
  const content = note(by)
  vi.mocked(api.readFile).mockResolvedValue({ path: PATH, content, mtime: 1, size: content.length } as never)
  box = document.createElement('div')
  document.body.appendChild(box)
  root = createRoot(box)
  act(() =>
    root?.render(
      <CommentPrefsContext.Provider value={{ me: null, resolvedPlace: 'bottom', openProfile: () => undefined }}>
        <CommentsSection file={{ path: PATH, content }} order="oldest" onChangeOrder={() => undefined} root={vault} />
      </CommentPrefsContext.Provider>,
    ),
  )
  await act(async () => await new Promise((r) => setTimeout(r, 0)))
  const a = box.querySelector('article.comments__item') as HTMLElement
  return {
    agent: a.querySelector('.comments-avatar--agent') !== null,
    img: a.querySelector('img.comments-avatar') !== null,
    name: a.querySelector('.comments__name')?.textContent ?? null,
    edit: [...a.querySelectorAll('.comments__action')].some((b) => b.textContent === 'Edit'),
  }
}

describe('writerOf and the people file', () => {
  it('a teammate whose card is in the file but not readable (a remote picture) is still a person: no Edit (D8)', async () => {
    const row = await writerRow('/v1', 'sam', { version: 1, people: { sam: { name: 'Sam Lee', picture: 'https://example.com/p.png', updated: '2026-09-01T00:00:00Z' } } })
    expect(row.edit).toBe(false)
  })

  it('a teammate whose card has no `picture` key, or comes past PEOPLE_MAX, is a person too: initials, no Edit', async () => {
    const row = await writerRow('/v3', 'lee', { version: 1, people: { lee: { name: 'Lee', updated: '2026-09-01T00:00:00Z' } } })
    expect(row).toEqual({ agent: false, img: false, name: 'lee', edit: false })
    const many = Object.fromEntries(Array.from({ length: PEOPLE_MAX }, (_, i) => [`p${i}`, { name: `P${i}`, picture: null, updated: 't' }]))
    act(() => root?.unmount())
    box?.remove()
    const late = await writerRow('/v4', 'zed', { version: 1, people: { ...many, zed: { name: 'Zed', picture: null, updated: 't' } } })
    expect(late).toEqual({ agent: false, img: false, name: 'zed', edit: false })
  })

  it('a card under `toString` is read as a card, and `hasOwnProperty` with no card is an agent', async () => {
    const row = await writerRow('/v5', 'toString', { version: 1, people: { toString: { name: 'To String', picture: null, updated: 't' } } })
    expect(row).toEqual({ agent: false, img: false, name: 'To String', edit: false })
    act(() => root?.unmount())
    box?.remove()
    expect(await writerRow('/v6', 'hasOwnProperty', { version: 1, people: {} })).toEqual({ agent: true, img: false, name: 'hasOwnProperty', edit: true })
  })

  it('a handle that is a name on Object.prototype (`constructor`) with no card is an agent, with its own name', async () => {
    const row = await writerRow('/v2', 'constructor', { version: 1, people: {} })
    expect(row).toEqual({ agent: true, img: false, name: 'constructor', edit: true })
  })
})
