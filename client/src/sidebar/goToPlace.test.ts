/**
 * ⌘D's place and the New… box's folder against one vault's tree (YAZ-3556 D3, D9): each kind of place, a path the
 * vault does not have, and "Default location for new notes" with its folder missing.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type TreeNode } from '@shared/types'
import { newItemFolder, placeRel, resolveGoTo } from './goToPlace'

const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
const TREE = [folder('/v/Projects', [folder('/v/Projects/Alpha', [note('/v/Projects/Alpha/plan.md')])]), note('/v/top.md')]

describe('resolveGoTo (YAZ-3556 D9)', () => {
  it('a tab is the tab; a folder and a file are their paths in the vault; the root is a folder', () => {
    expect(resolveGoTo({ kind: 'tab', tab: 'recents' }, '/v', TREE)).toEqual({ kind: 'tab', tab: 'recents' })
    expect(resolveGoTo({ kind: 'folder', path: 'Projects/Alpha' }, '/v', TREE)).toEqual({ kind: 'folder', path: '/v/Projects/Alpha' })
    expect(resolveGoTo({ kind: 'folder', path: '' }, '/v', TREE)).toEqual({ kind: 'folder', path: '/v' })
    expect(resolveGoTo({ kind: 'file', path: 'Projects/Alpha/plan.md' }, '/v', TREE)).toEqual({ kind: 'file', path: '/v/Projects/Alpha/plan.md' })
  })

  it('a path the vault does not have is missing — and so is a folder set as a file, and a file set as a folder', () => {
    expect(resolveGoTo({ kind: 'folder', path: 'Gone' }, '/v', TREE)).toEqual({ kind: 'missing', rel: 'Gone', folder: true })
    expect(resolveGoTo({ kind: 'file', path: 'gone.md' }, '/v', TREE)).toEqual({ kind: 'missing', rel: 'gone.md', folder: false })
    expect(resolveGoTo({ kind: 'file', path: 'Projects' }, '/v', TREE).kind).toBe('missing')
    expect(resolveGoTo({ kind: 'folder', path: 'top.md' }, '/v', TREE).kind).toBe('missing')
  })
})

describe('newItemFolder (YAZ-3556 D3)', () => {
  const at = (newNoteLocation: 'root' | 'current' | 'folder', newNoteFolder = '') => ({ ...DEFAULT_SETTINGS, newNoteLocation, newNoteFolder })

  it('"Default location for new notes": the vault folder, the folder of the page on show, or the folder set', () => {
    expect(newItemFolder(at('root'), '/v', '/v/Projects/Alpha/plan.md', TREE)).toEqual({ dir: '/v', missing: null })
    expect(newItemFolder(at('current'), '/v', '/v/Projects/Alpha/plan.md', TREE)).toEqual({ dir: '/v/Projects/Alpha', missing: null })
    // No page on show (the blank tab), or a page of another vault: the root.
    expect(newItemFolder(at('current'), '/v', null, TREE)).toEqual({ dir: '/v', missing: null })
    expect(newItemFolder(at('current'), '/v', '/w/x.md', TREE)).toEqual({ dir: '/v', missing: null })
    expect(newItemFolder(at('folder', 'Projects'), '/v', null, TREE)).toEqual({ dir: '/v/Projects', missing: null })
  })

  it('a set folder this vault does not have: the root, and its name to say so', () => {
    expect(newItemFolder(at('folder', 'Inbox'), '/v', null, TREE)).toEqual({ dir: '/v', missing: 'Inbox' })
  })

  it('placeRel is the path in the vault, "" for the root', () => {
    expect([placeRel('/v', '/v'), placeRel('/v', '/v/a/b'), placeRel('/v', '/vx/a')]).toEqual(['', 'a/b', '/vx/a'])
  })
})
