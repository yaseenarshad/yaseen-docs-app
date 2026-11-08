/**
 * S39 (YAZ-4596): a folder page whose Page tab holds a long document keeps its settings writes fast. A settings write is
 * the whole `folder_settings` block, rewritten into the `.folder.md` that also holds the Page body (YAZ-4584 D38): the
 * real `writeFolderSettings` over an in-memory disk, with a 34k-character body under the frontmatter.
 */
import { describe, expect, it, vi } from 'vitest'
import { splitFrontmatter } from '@shared/frontmatter'
import { budgetMs, median } from '../test-perf'
import type { FolderSettings } from './folderSettings'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { api } from '../api'
import { writeFolderSettings } from './folderSettings'

const PATH = '/vault/Projects/.folder.md'

/** A Page body of about 34k characters: headings, bullets and paragraphs, as a long folder document has. */
function body(): string {
  const parts: string[] = []
  for (let i = 0; parts.join('').length < 34_000; i++)
    parts.push(`## Section ${i}\n\n- a point about item ${i} with a [[Link ${i}]]\n  - a child line under it\n\nA paragraph of plain words that runs on for a while, number ${i}.\n\n`)
  return parts.join('')
}

describe('a settings write on a `.folder.md` with a 34k-character Page body (YAZ-4596 S39)', () => {
  it('reads once, writes once, keeps the body byte for byte, and takes under 5 ms (the median)', async () => {
    const page = body()
    expect(page.length).toBeGreaterThanOrEqual(34_000)
    let disk = { content: `---\nfolder_settings:\n  views:\n    - type: page\n      name: Page\n---\n${page}`, mtime: 1 }
    vi.mocked(api.readFile).mockImplementation(async (path) => ({ path, ...disk, size: disk.content.length }))
    vi.mocked(api.writeFile).mockImplementation(async ({ path, content }) => {
      disk = { content, mtime: disk.mtime + 1 }
      return { path, mtime: disk.mtime, size: content.length }
    })
    const settings = (i: number): FolderSettings => ({
      columns: { status: { kind: 'select', options: ['a', 'b', 'c'] } },
      views: [{ type: 'page', name: 'Page' }, { type: 'table', name: 'Table', order: ['file.name', 'note.status'], sort: [{ property: 'note.status', direction: i % 2 ? 'ASC' : 'DESC' }] }],
      problems: [],
    })

    // Each write's base is the block on disk before it, as the page heard it. Warm up from the file's first block.
    await writeFolderSettings(PATH, settings(0), { columns: {}, views: [{ type: 'page', name: 'Page' }], problems: [] })
    vi.mocked(api.readFile).mockClear()
    vi.mocked(api.writeFile).mockClear()
    const ms: number[] = []
    for (let i = 1; i <= 15; i++) {
      const start = performance.now()
      await writeFolderSettings(PATH, settings(i), settings(i - 1))
      ms.push(performance.now() - start)
    }
    console.log(`settings write, 34k body: median ${median(ms).toFixed(2)} ms, worst ${Math.max(...ms).toFixed(2)} ms`)
    // Counts first: each write is one read and one write, and the body is never touched.
    expect(api.readFile).toHaveBeenCalledTimes(15)
    expect(api.writeFile).toHaveBeenCalledTimes(15)
    expect(splitFrontmatter(disk.content).body).toBe(page)
    expect(disk.content).toContain('direction: ASC') // the last write (15) landed
    expect(median(ms)).toBeLessThan(budgetMs(5))
  })
})
