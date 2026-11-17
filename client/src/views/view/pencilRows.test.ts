/**
 * Every menu row that changes a name wears the pencil (YAZ-5770). The rows live in data builders and in JSX menus,
 * so the sources are read as text: each row's own text, from its marker to the end of its row, holds `PencilIcon`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = path.join(__dirname, '..', '..')

/** [file, the row's marker, how far the row runs after it]. A JSX row's pencil stands just before its words. */
const ROWS: [string, string, 'after' | 'before'][] = [
  ['sidebar/menuSections.ts', "id: 'rename', label: 'Rename'", 'after'],
  ['sidebar/FocusFolderList.tsx', "id: 'focus-folder-rename'", 'after'],
  ['sidebar/SessionList.tsx', "id: 'rename-session'", 'after'],
  ['sidebar/vaultMenuSections.ts', "id: 'rename', label: 'Set display name'", 'after'],
  ['sidebar/vaultMenuSections.ts', "id: 'rename-set'", 'after'],
  ['tabs/TabMenu.tsx', "id: 'rename', label: 'Set display name'", 'after'],
  ['tabs/TabMenu.tsx', "id: 'rename-file'", 'after'],
  ['explore/exploreMenu.tsx', "id: 'rename-file'", 'after'],
  ['views/view/TableHeaderMenu.tsx', 'Rename column…', 'before'],
  ['editor/FrontmatterPanel.tsx', 'Rename…</span>', 'before'],
]

describe('the rename rows (YAZ-5770)', () => {
  it('each row that changes a name has the pencil icon', () => {
    const missing = ROWS.filter(([file, marker, side]) => {
      const text = readFileSync(path.join(src, file), 'utf8')
      // A JSX row's words can also stand in a comment above it, so its row is the last one.
      const at = side === 'after' ? text.indexOf(marker) : text.lastIndexOf(marker)
      if (at < 0) return true
      const row = side === 'after' ? text.slice(at, text.indexOf('onSelect', at)) : text.slice(Math.max(0, at - 80), at)
      return !row.includes('PencilIcon')
    })
    expect(missing).toEqual([])
  })
})
