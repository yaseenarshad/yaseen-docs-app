/**
 * The search results as a tree (YAZ-2620 D1/D2): the Files tree cut down to the matched rows and
 * the folders that lead to them. Pure — the Sidebar's own behaviour around it (the folds, the
 * keys, the limit line) is in Sidebar.test.tsx.
 */
import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { searchTree } from './searchTree'

const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
const dir = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })

/** Dirs lead each level, as main sorts one: two branches, a folder beside a note of its name, a note at the root. */
const TREE: TreeNode[] = [
  dir('/v/Clients', [dir('/v/Clients/Acme', [file('/v/Clients/Acme/Call.md'), file('/v/Clients/Acme/Plan.md')]), file('/v/Clients/Index.md')]),
  dir('/v/Transcripts', [dir('/v/Transcripts/Old', [file('/v/Transcripts/Old/Jan.md')]), file('/v/Transcripts/Feb.md')]),
  file('/v/Root.md'),
]

const cutOf = (...hits: string[]) => searchTree(TREE, new Set(hits), new Set())
/** The cut with the folders `full` showing all (YAZ-2662 D6). */
const cutAll = (full: string[], ...hits: string[]) => searchTree(TREE, new Set(hits), new Set(full))
/** The cut as indented paths, so a whole shape reads at a glance. */
const shape = (nodes: readonly TreeNode[], depth = 0): string[] =>
  nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.path.slice('/v/'.length)}`, ...(n.type === 'dir' ? shape(n.children, depth + 1) : [])])

describe('searchTree (YAZ-2620)', () => {
  it('S1: a deep match shows at its place, below its parent folders — open, and none of them a match', () => {
    const cut = cutOf('/v/Clients/Acme/Plan.md')
    expect(shape(cut.nodes)).toEqual(['Clients', '  Clients/Acme', '    Clients/Acme/Plan.md'])
    expect(cut.open).toEqual(new Set(['/v/Clients', '/v/Clients/Acme']))
    expect(cut.order).toEqual(['/v/Clients/Acme/Plan.md'])
  })

  it('S2: a matched folder with no match inside is CLOSED and keeps all it holds (D2)', () => {
    const cut = cutOf('/v/Transcripts')
    expect(shape(cut.nodes)).toEqual(['Transcripts', '  Transcripts/Old', '    Transcripts/Old/Jan.md', '  Transcripts/Feb.md'])
    expect(cut.nodes[0]).toBe(TREE[1]) // the folder as the tree holds it: nothing was copied
    expect(cut.open.size).toBe(0)
    expect(cut.order).toEqual(['/v/Transcripts'])
  })

  it('S3: a matched folder with matches inside is open, to those matches and their parents only', () => {
    const cut = cutOf('/v/Transcripts', '/v/Transcripts/Old/Jan.md')
    expect(shape(cut.nodes)).toEqual(['Transcripts', '  Transcripts/Old', '    Transcripts/Old/Jan.md'])
    expect(cut.open).toEqual(new Set(['/v/Transcripts', '/v/Transcripts/Old']))
    expect(cut.order).toEqual(['/v/Transcripts', '/v/Transcripts/Old/Jan.md'])
  })

  it('S4: a match at the vault root is one row at depth 0, with no parent', () => {
    const cut = cutOf('/v/Root.md')
    expect(shape(cut.nodes)).toEqual(['Root.md'])
    expect(cut.open.size).toBe(0)
  })

  it('S5: no match is no rows; a hit the tree does not hold is no row either', () => {
    expect(cutOf()).toEqual({ nodes: [], open: new Set(), order: [] })
    expect(cutOf('/v/Gone.md').nodes).toEqual([])
  })

  it('`order` is the matches top to bottom as the tree draws them — a folder before what it holds, whatever order the hits came in', () => {
    const cut = cutOf('/v/Root.md', '/v/Transcripts/Feb.md', '/v/Clients/Acme', '/v/Clients/Index.md', '/v/Clients/Acme/Call.md')
    expect(cut.order).toEqual(['/v/Clients/Acme', '/v/Clients/Acme/Call.md', '/v/Clients/Index.md', '/v/Transcripts/Feb.md', '/v/Root.md'])
    expect(shape(cut.nodes)).toEqual(['Clients', '  Clients/Acme', '    Clients/Acme/Call.md', '  Clients/Index.md', 'Transcripts', '  Transcripts/Feb.md', 'Root.md'])
    expect(TREE[0].type === 'dir' && TREE[0].children[0].type === 'dir' && TREE[0].children[0].children).toHaveLength(2) // the tree itself is never cut
  })
})

describe('searchTree: a folder that shows all (YAZ-2662 D6)', () => {
  it('S46, S47: it keeps each row that it holds — a folder inside it that leads to a match stays as cut, open; one that leads to none is the tree\'s own node, closed', () => {
    const cut = cutAll(['/v/Clients'], '/v/Clients', '/v/Clients/Acme/Plan.md')
    expect(shape(cut.nodes)).toEqual(['Clients', '  Clients/Acme', '    Clients/Acme/Plan.md', '  Clients/Index.md'])
    expect(cut.open).toEqual(new Set(['/v/Clients', '/v/Clients/Acme']))
    const old = cutAll(['/v/Transcripts'], '/v/Transcripts/Feb.md')
    expect(shape(old.nodes)).toEqual(['Transcripts', '  Transcripts/Old', '    Transcripts/Old/Jan.md', '  Transcripts/Feb.md'])
    expect(old.open).toEqual(new Set(['/v/Transcripts']))
    expect(old.nodes[0].type === 'dir' && old.nodes[0].children[0]).toBe(TREE[1].type === 'dir' && TREE[1].children[0])
  })

  it('S48: `order` holds each row below it, a match or not, at its place in the tree', () => {
    expect(cutAll(['/v/Transcripts'], '/v/Clients/Index.md', '/v/Transcripts/Feb.md', '/v/Root.md').order).toEqual(['/v/Clients/Index.md', '/v/Transcripts/Old', '/v/Transcripts/Old/Jan.md', '/v/Transcripts/Feb.md', '/v/Root.md'])
  })

  it('S52: a folder inside it shows all too — one that leads to no match is the tree\'s own node, open', () => {
    const cut = cutAll(['/v/Transcripts', '/v/Transcripts/Old'], '/v/Transcripts')
    expect(shape(cut.nodes)).toEqual(['Transcripts', '  Transcripts/Old', '    Transcripts/Old/Jan.md', '  Transcripts/Feb.md'])
    expect(cut.open).toEqual(new Set(['/v/Transcripts', '/v/Transcripts/Old']))
  })

  it('S54: a folder with nothing in it is open, with no row', () => {
    const cut = searchTree([dir('/v/Empty')], new Set(['/v/Empty']), new Set(['/v/Empty']))
    expect([shape(cut.nodes), cut.open]).toEqual([['Empty'], new Set(['/v/Empty'])])
  })

  it('a folder that the search does not draw is not drawn because it shows all', () => {
    expect(shape(cutAll(['/v/Clients', '/v/Clients/Acme'], '/v/Root.md').nodes)).toEqual(['Root.md'])
  })
})
