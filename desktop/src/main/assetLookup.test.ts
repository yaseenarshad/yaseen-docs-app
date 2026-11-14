import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeAssetResolver, nameOrderCi } from '@shared/assetLookup'
import { resolveAsset } from './fs/assets'
import { vaultFiles } from './fs/fsUtils'

/**
 * YAZ-5068 (2B, "the asset lookup by the shortest-path rule"): the phone has a list of the vault's files (a GitHub tree),
 * not a disk. `makeAssetResolver` answers from that list by the same rule the Mac's `resolveAsset` walks the disk by:
 * page-relative, then root-relative, then the shortest path (breadth first, names in `nameOrderCi` order, dot-entries
 * and `node_modules` skipped, the name in any case).
 */
const FILES = [
  'pic.png',
  'Deep/pic.png',
  'aa/dup.png',
  'bb/dup.png',
  'AB/dup2.png',
  'ab2/dup2.png',
  'aa/deeper/shallow.png',
  'bb/shallow.png',
  'zz/Case.PNG',
  'yy/deep/case.png',
  '.obsidian/hidden.webp',
  'node_modules/x/inmods.png',
  'cc/.dot.png',
  'Pages/Page.md',
  'Pages/img/local.png',
  'img/local.png',
  'b/c/d/e.png',
  'a/z/e.png',
  'a/y/q/e.png',
]

const TARGETS: [string, string?][] = [
  ['pic.png'],
  ['dup.png'],
  ['dup.png', 'bb'],
  ['./dup.png', 'bb'],
  ['../bb/dup.png', 'aa'],
  ['../../escape.png', 'aa'],
  ['../dup.png', 'aa'],
  ['bb/dup.png'],
  ['aa/dup.png', 'bb'],
  ['no-such-dir/shallow.png'],
  ['shallow.png'],
  ['case.png'],
  ['CASE.png'],
  ['dup2.png'],
  ['hidden.webp'],
  ['inmods.png'],
  ['.dot.png'],
  ['local.png'],
  ['img/local.png', 'Pages'],
  ['img/local.png'],
  ['e.png'],
  ['missing.png'],
  ['aa'],
  [''],
]

describe('the asset lookup from a file list (YAZ-5068)', () => {
  const resolve = makeAssetResolver(FILES)

  it('follows Obsidian`s order: page-relative, root-relative, then the shortest path', () => {
    expect(resolve('dup.png', 'bb')).toBe('bb/dup.png')
    expect(resolve('../bb/dup.png', 'aa')).toBe('bb/dup.png')
    expect(resolve('aa/dup.png', 'bb')).toBe('aa/dup.png')
    expect(resolve('img/local.png', 'Pages')).toBe('Pages/img/local.png')
    expect(resolve('img/local.png')).toBe('img/local.png')
    expect(resolve('dup.png')).toBe('aa/dup.png')
    expect(resolve('shallow.png')).toBe('bb/shallow.png')
    expect(resolve('no-such-dir/shallow.png')).toBe('bb/shallow.png')
    expect(resolve('e.png')).toBe('a/z/e.png')
    expect(resolve('CASE.png')).toBe('zz/Case.PNG')
  })

  it('never finds a dot-entry or `node_modules`, never leaves the vault, and answers null for a miss', () => {
    expect(resolve('hidden.webp')).toBeNull()
    expect(resolve('inmods.png')).toBeNull()
    expect(resolve('.dot.png')).toBeNull()
    expect(resolve('../../escape.png', 'aa')).toBeNull()
    expect(resolve('missing.png')).toBeNull()
    expect(resolve('aa')).toBeNull()
    expect(resolve('')).toBeNull()
  })

  it('`nameOrderCi` is the order the Mac sorts a folder by (`byNameCi`)', () => {
    expect(['b', 'A', 'a2', 'C'].sort(nameOrderCi)).toEqual(['A', 'a2', 'b', 'C'])
  })

  describe('gives the answer the Mac`s disk walk gives, on the same tree', () => {
    let root: string
    beforeAll(async () => {
      root = await mkdtemp(path.join(tmpdir(), 'asset-lookup-'))
      for (const f of FILES) {
        await mkdir(path.dirname(path.join(root, f)), { recursive: true })
        await writeFile(path.join(root, f), 'x')
      }
    })
    afterAll(() => rm(root, { recursive: true, force: true }))

    it('for each target, with and without a page folder', async () => {
      // The phone's list is the vault's files, as a tree listing gives them (dot-entries too: the rule skips them).
      const listed: string[] = []
      for await (const f of vaultFiles(root)) listed.push(path.relative(root, f.full).split(path.sep).join('/'))
      const fromList = makeAssetResolver([...listed, '.obsidian/hidden.webp', 'node_modules/x/inmods.png', 'cc/.dot.png'])
      for (const [target, from] of TARGETS) {
        const onDisk = await resolveAsset(root, target, from)
        const want = onDisk === null ? null : path.relative(root, onDisk).split(path.sep).join('/')
        expect([target, from, fromList(target, from)]).toEqual([target, from, want])
      }
    })
  })
})
