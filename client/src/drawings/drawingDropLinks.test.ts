/**
 * YAZ-3943 4D: pages dragged from the sidebar onto a board. Each page is the link a paste of its path makes, a folder
 * gives none, and a drop from outside the window's vaults is not the host's.
 */
import { describe, expect, it, vi } from 'vitest'
import type { TreeNode } from '@shared/types'
import { fetchTree } from '../lib/treeFeed'
import { createWikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import { drawingDropLinks, drawingPasteLink } from './drawingLinks'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { tree: vi.fn() },
}))

import { api } from '../api'

const file = (path: string, kind: 'markdown' | 'drawing' | 'text'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1 })
const dir = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })

describe('drawingDropLinks', () => {
  const candidates = createWikilinkCandidateSource()
  candidates.update([
    { name: 'Growth plan', insert: 'DEM-1', label: 'Growth plan', path: '/vault/Growth plan.md' },
    { name: 'Plan.excalidraw', insert: 'DEM-5', label: 'Plan.excalidraw', path: '/vault/Boards/Plan.excalidraw' },
    { name: 'app.ts', insert: 'Code/app.ts', label: 'app.ts', path: '/vault/Code/app.ts' },
    { name: 'Boards', insert: 'Boards', label: 'Boards (folder)', path: '/vault/Boards' },
  ])
  const linkOf = (path: string) => drawingPasteLink(path, '/vault', '/vault/Board.excalidraw', candidates)

  it('one page makes one link; three pages make three, in the order dropped; a folder makes none', async () => {
    vi.mocked(api.tree).mockResolvedValueOnce({ root: '/vault', tree: [file('/vault/Growth plan.md', 'markdown'), dir('/vault/Boards', [file('/vault/Boards/Plan.excalidraw', 'drawing')]), dir('/vault/Code', [file('/vault/Code/app.ts', 'text')])], generatedAt: 1 })
    await fetchTree('/vault')
    expect(drawingDropLinks(['/vault/Growth plan.md'], ['/vault'], linkOf)).toEqual(['[[DEM-1]]'])
    expect(drawingDropLinks(['/vault/Boards/Plan.excalidraw', '/vault/Growth plan.md', '/vault/Code/app.ts'], ['/vault'], linkOf)).toEqual(['[[DEM-5]]', '[[DEM-1]]', '[[Code/app.ts]]'])
    expect(drawingDropLinks(['/vault/Boards'], ['/vault'], linkOf)).toEqual([])
  })

  it('a drop from Finder, or one with no path, is not the host\'s: the engine goes on as before', () => {
    expect(drawingDropLinks(['/Users/me/Desktop/pages.md'], ['/vault'], linkOf)).toBeNull()
    expect(drawingDropLinks(['/vault/Growth plan.md', '/elsewhere/a.md'], ['/vault'], linkOf)).toBeNull()
    expect(drawingDropLinks([], ['/vault'], linkOf)).toBeNull()
  })
})
