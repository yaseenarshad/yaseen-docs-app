import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveInlineCopyPath } from './inlinePath'

const { readFile } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<{ path: string; content: string; mtime: number; size: number }>>(),
}))

vi.mock('../api', () => ({ api: { readFile } }))

afterEach(() => {
  readFile.mockReset()
})

describe('resolveInlineCopyPath', () => {
  it('resolves card and drawing inline refs to <page>:<1-based line>', async () => {
    const content = [
      '---',
      'title: Page',
      '---',
      '',
      '```card',
      'Front',
      '```',
      '<!-- card: WIKI-42 -->',
      '',
      '```excalidraw',
      '{"elements":[]}',
      '```',
    ].join('\n')
    readFile.mockResolvedValue({ path: '/v/Page.md', content, mtime: 1, size: content.length })

    await expect(resolveInlineCopyPath({ kind: 'card', page: '/v/Page.md', id: 'WIKI-42' })).resolves.toBe('/v/Page.md:5')
    await expect(resolveInlineCopyPath({ kind: 'drawing', page: '/v/Page.md', index: 0 })).resolves.toBe('/v/Page.md:10')
    await expect(resolveInlineCopyPath({ kind: 'card', page: '/v/Page.md', id: 'MISSING' }, 0)).resolves.toBe('/v/Page.md:5')
    expect(readFile).toHaveBeenCalledWith('/v/Page.md')
  })

  it('falls back gracefully to ref.page when api.readFile rejects', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'))
    await expect(resolveInlineCopyPath({ kind: 'card', page: '/v/Gone.md', id: 'WIKI-1' })).resolves.toBe('/v/Gone.md')
    await expect(resolveInlineCopyPath({ kind: 'drawing', page: '/v/Gone.md', index: 0 })).resolves.toBe('/v/Gone.md')
  })
})
