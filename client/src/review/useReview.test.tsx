/**
 * `useReview` (YAZ-2322): the Inbox count and one review session, against scenario table C of the
 * decision record. The index is a fake source rebuilt from an in-memory vault after every write;
 * `transformFile` is mocked to apply the real transforms to that vault.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { DEFAULT_REVIEW_SETTINGS as S, REVIEWS_KEY, addReview, reviewEntries, reviewsOf, textFingerprint, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useReview, type ReviewApi } from './useReview'

const DAY = 86_400_000
const NOW = new Date(2026, 5, 15, 9, 0).getTime()
const ROOT = '/vault'

/** path → { content, mtime }: the vault the fake index is scanned from. */
let vault = new Map<string, { content: string; mtime: number }>()
let records: IndexRecord[] = []
let listeners: Array<() => void> = []
const source = {
  get records() {
    return records
  },
  subscribe(l: () => void) {
    listeners.push(l)
    return () => (listeners = listeners.filter((x) => x !== l))
  },
}

function scan(path: string, { content, mtime }: { content: string; mtime: number }): IndexRecord {
  const { frontmatter, body } = splitFrontmatter(content)
  const { properties, error } = parseFrontmatter(frontmatter)
  const reviews = reviewEntries(properties[REVIEWS_KEY])
  delete properties[REVIEWS_KEY]
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice(ROOT.length + 1, Math.max(ROOT.length + 1, path.lastIndexOf('/')))
  return { path, name, basename: name.replace(/\.md$/, ''), folder, ext: 'md', size: content.length, ctime: 0, mtime, properties, ...(error !== undefined && { frontmatterError: error }), aliases: [], tags: [], links: [], embeds: [], ...(reviews.length > 0 && { reviews }), text: textFingerprint(body) }
}

/** What the watcher does after a write: a fresh snapshot, then every subscriber woken. */
function reindex(): void {
  records = [...vault].map(([path, file]) => scan(path, file)).sort((a, b) => (a.path < b.path ? -1 : 1))
  listeners.forEach((l) => l())
}

const put = (name: string, daysOld: number, content = `Body of ${name}.\n`): void => {
  vault.set(`${ROOT}/${name}`, { content, mtime: NOW - daysOld * DAY })
}

let failWrites = false
vi.mock('../views/writeProperty', () => ({
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const file = vault.get(path)
    if (failWrites || file === undefined) throw new Error('cannot write')
    const content = transform(file.content)
    if (content !== file.content) vault.set(path, { content, mtime: Date.now() })
    return { mtime: Date.now(), content }
  }),
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let review: ReviewApi
const notices: string[] = []
const onNotice = (text: string): void => void notices.push(text)

function Probe({ settings }: { settings: ReviewSettings }) {
  review = useReview(ROOT, source, settings, onNotice)
  return null
}

async function mount(settings: ReviewSettings = S): Promise<void> {
  reindex()
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe settings={settings} />))
}

/** An answer, then the index catching up with the file it wrote. */
const answer = async (act_: () => unknown): Promise<void> => {
  await act(async () => {
    await act_()
  })
  await act(async () => reindex())
}

const shown = (): string | undefined => review.session?.path?.slice(ROOT.length + 1)
const logOf = (name: string): number => reviewsOf(vault.get(`${ROOT}/${name}`)?.content ?? '').length

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vault = new Map()
  listeners = []
  notices.length = 0
  failWrites = false
  put('old.md', 90)
  put('older.md', 120)
  put('fresh.md', 2)
  put('off.md', 200, '---\nreview: false\n---\nOff.\n')
  put('notes/deep.md', 45)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('the Inbox count', () => {
  it('is how many notes are due now', async () => {
    await mount()
    expect(review.dueCount).toBe(3)
    expect(review.session).toBeNull()
  })

  it('follows the index and the settings', async () => {
    await mount()
    put('fresh.md', 31)
    await act(async () => reindex())
    expect(review.dueCount).toBe(4)
    await act(async () => root?.render(<Probe settings={{ ...S, baseDays: 100 }} />))
    expect(review.dueCount).toBe(1)
  })

  it('is right after midnight with no file changing', async () => {
    put('tomorrow.md', 28.5) // due at 21:00 tomorrow
    await mount()
    expect(review.dueCount).toBe(3)
    await act(async () => vi.advanceTimersByTime(16 * 3_600_000)) // 01:00 the next day
    expect(review.dueCount).toBe(4)
  })
})

describe('a session', () => {
  it('starts on the most overdue note and names itself', async () => {
    await mount()
    act(() => review.start())
    expect(review.session).toEqual({ label: 'Inbox', path: `${ROOT}/older.md`, position: 1, total: 3, canUndo: false })
  })

  it('"Still relevant" writes one review and shows the next note', async () => {
    await mount()
    act(() => review.start())
    await answer(() => review.keep())
    expect(logOf('older.md')).toBe(1)
    expect(shown()).toBe('old.md')
    expect(review.session).toMatchObject({ position: 2, total: 3, canUndo: true })
    expect(review.dueCount).toBe(2)
  })

  it('Skip writes nothing and brings the note back after the others', async () => {
    await mount()
    act(() => review.start())
    act(() => review.skip())
    expect(logOf('older.md')).toBe(0)
    expect(shown()).toBe('old.md')
    expect(review.session?.position).toBe(1)
    await answer(() => review.keep())
    await answer(() => review.keep())
    expect(shown()).toBe('older.md')
    expect(review.session?.position).toBe(3)
  })

  it('Undo removes the review just written and shows that note again', async () => {
    await mount()
    act(() => review.start())
    await answer(() => review.keep())
    await answer(() => review.undo())
    expect(logOf('older.md')).toBe(0)
    expect(splitFrontmatter(vault.get(`${ROOT}/older.md`)?.content ?? '').body).toBe('Body of older.md.\n')
    expect(shown()).toBe('older.md')
    expect(review.session).toMatchObject({ position: 1, canUndo: false })
  })

  it('ends on nothing left, and stays open until closed', async () => {
    await mount()
    act(() => review.start())
    for (let i = 0; i < 3; i++) await answer(() => review.keep())
    expect(review.session).toMatchObject({ path: null, total: 3 })
    expect(review.dueCount).toBe(0)
    act(() => review.close())
    expect(review.session).toBeNull()
  })

  it('opens on nothing when nothing is due', async () => {
    vault = new Map()
    put('fresh.md', 2)
    await mount()
    act(() => review.start())
    expect(review.session).toMatchObject({ path: null, total: 0 })
  })

  it('a folder session takes that folder and its subfolders, and is named after it', async () => {
    put('notes/a.md', 60)
    put('notes-old/b.md', 60)
    await mount()
    act(() => review.start('notes'))
    expect(review.session).toMatchObject({ label: 'notes', total: 2 })
  })

  it('keeps the note showing while it is edited, though the edit makes it no longer due', async () => {
    await mount()
    act(() => review.start())
    vault.set(`${ROOT}/older.md`, { content: 'Rewritten.\n', mtime: NOW })
    await act(async () => reindex())
    expect(shown()).toBe('older.md')
    await answer(() => review.keep())
    expect(reviewsOf(vault.get(`${ROOT}/older.md`)?.content ?? '')[0].text).toBe(textFingerprint('Rewritten.\n'))
  })

  it('passes over a note that was deleted, turned off or reviewed elsewhere before its turn', async () => {
    put('third.md', 80)
    await mount()
    act(() => review.start()) // older, old, third, notes/deep
    vault.delete(`${ROOT}/old.md`)
    vault.set(`${ROOT}/third.md`, { content: addReview('Body of third.md.\n', new Date(NOW).toISOString()), mtime: NOW })
    await act(async () => reindex())
    await answer(() => review.keep())
    expect(shown()).toBe('notes/deep.md')
    expect(review.session?.position).toBe(4)
  })

  it('a write that fails says why and passes over the note', async () => {
    await mount()
    act(() => review.start())
    failWrites = true
    await answer(() => review.keep())
    expect(notices).toHaveLength(1)
    expect(logOf('older.md')).toBe(0)
    expect(shown()).toBe('old.md')
    expect(review.session?.canUndo).toBe(false)
  })

  it('does not take in a note that falls due while it is open', async () => {
    await mount()
    act(() => review.start())
    put('fresh.md', 31)
    await act(async () => reindex())
    expect(review.dueCount).toBe(4)
    expect(review.session?.total).toBe(3)
  })
})

describe('turning review on or off', () => {
  it('reports a note\'s state, and null for a path that is not a note', async () => {
    await mount()
    expect(review.inReview(`${ROOT}/old.md`)).toBe(true)
    expect(review.inReview(`${ROOT}/off.md`)).toBe(false)
    expect(review.inReview(`${ROOT}/notes`)).toBeNull()
  })

  it('off takes the note out of the count; on puts it back in review', async () => {
    await mount()
    await answer(() => review.setInReview(`${ROOT}/old.md`, false))
    expect(vault.get(`${ROOT}/old.md`)?.content).toContain('review: false')
    expect(review.dueCount).toBe(2)
    await answer(() => review.setInReview(`${ROOT}/off.md`, true))
    expect(review.inReview(`${ROOT}/off.md`)).toBe(true)
  })

  it('a write that fails says why', async () => {
    await mount()
    failWrites = true
    await answer(() => review.setInReview(`${ROOT}/old.md`, false))
    expect(notices).toHaveLength(1)
  })
})
