/**
 * Unit tests for `carryCrossVaultAssets` (YAZ-1708): cross-vault copy & cut carry page images,
 * inline Excalidraw `assets/` images, and standalone `.excalidraw`/`.drawio` embeds (stripping
 * board IDs and carrying `picturesOut` assets), with clash handling (skip identical bytes,
 * rename + rewrite link only on real clash) and no-op for same-vault copies.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { carryCrossVaultAssets } from './carryAssets'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function makeVaultPair() {
  const base = await mkdtemp(path.join(tmpdir(), 'yd-carry-'))
  dirs.push(base)
  const srcRoot = path.join(base, 'vault-a')
  const dstRoot = path.join(base, 'vault-b')
  await mkdir(srcRoot, { recursive: true })
  await mkdir(dstRoot, { recursive: true })
  return { srcRoot, dstRoot }
}

async function seed(root: string, rel: string, data: string | Buffer): Promise<string> {
  const full = path.join(root, rel)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, data)
  return full
}

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02])

const INLINE_SCENE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'yaseen-docs',
  elements: [{ id: 'img1', type: 'image', fileId: 'inlineimg1', isDeleted: false }],
  appState: {},
  files: {},
})

const STANDALONE_BOARD = JSON.stringify(
  {
    yaseendraw: { createdAt: 1, updatedAt: 2, id: 'YAZ-99', formerIds: ['OLD-1'], pictures: 'assets' },
    type: 'excalidraw',
    version: 2,
    source: 'yaseen-docs',
    elements: [{ id: 'img2', type: 'image', fileId: 'boardimg2', isDeleted: false }],
    appState: {},
    files: {},
  },
  null,
  2,
)

describe('carryCrossVaultAssets (YAZ-1708)', () => {
  it('carries page images, inline excalidraw assets, and standalone .excalidraw embeds (dropping board ID & carrying picturesOut assets) across vaults', async () => {
    const { srcRoot, dstRoot } = await makeVaultPair()
    const md = [
      '# Note',
      '',
      '![Hero](assets/images/hero.png)',
      '',
      '![[Sketch.excalidraw|640x360 locked]]',
      '',
      '```excalidraw',
      INLINE_SCENE,
      '```',
      '',
    ].join('\n')

    const srcPage = await seed(srcRoot, 'notes/Page.md', md)
    await seed(srcRoot, 'assets/images/hero.png', PNG_A)
    await seed(srcRoot, 'assets/inlineimg1.png', PNG_A)
    await seed(srcRoot, 'assets/boardimg2.png', PNG_B)
    await seed(srcRoot, 'notes/Sketch.excalidraw', STANDALONE_BOARD)

    // Simulate paste into dstRoot (works identically for copy and cut since `from` is srcPage).
    const dstPage = await seed(dstRoot, 'inbox/Page.md', md)

    await carryCrossVaultAssets([{ from: srcPage, to: dstPage, kind: 'file' }], dstRoot, [srcRoot, dstRoot])

    expect(await readFile(path.join(dstRoot, 'assets/images/hero.png'))).toEqual(PNG_A)
    expect(await readFile(path.join(dstRoot, 'assets/inlineimg1.png'))).toEqual(PNG_A)
    expect(await readFile(path.join(dstRoot, 'assets/boardimg2.png'))).toEqual(PNG_B)
    expect(existsSync(path.join(dstRoot, 'notes/Sketch.excalidraw'))).toBe(true)

    const copiedBoard = JSON.parse(await readFile(path.join(dstRoot, 'notes/Sketch.excalidraw'), 'utf8')) as {
      yaseendraw: Record<string, unknown>
    }
    expect(copiedBoard.yaseendraw.id).toBeUndefined()
    expect(copiedBoard.yaseendraw.formerIds).toBeUndefined()
    // Source assets remain untouched (never deleted even on cut).
    expect(existsSync(path.join(srcRoot, 'assets/inlineimg1.png'))).toBe(true)
    // No clash -> markdown untouched.
    expect(await readFile(dstPage, 'utf8')).toBe(md)
  })

  it('skips identical bytes without renaming, and renames + rewrites links on differing-byte clashes', async () => {
    const { srcRoot, dstRoot } = await makeVaultPair()
    const md = [
      '![Same](assets/images/same.png)',
      '![Diff](assets/images/diff.png)',
      '![[Sketch.excalidraw|locked]]',
      '',
    ].join('\n')

    const srcPage = await seed(srcRoot, 'Page.md', md)
    await seed(srcRoot, 'assets/images/same.png', PNG_A)
    await seed(srcRoot, 'assets/images/diff.png', PNG_A)
    await seed(srcRoot, 'Sketch.excalidraw', STANDALONE_BOARD)

    // Pre-populate destination with identical `same.png`, differing `diff.png`, and differing `Sketch.excalidraw`.
    await seed(dstRoot, 'assets/images/same.png', PNG_A)
    await seed(dstRoot, 'assets/images/diff.png', PNG_B)
    await seed(dstRoot, 'Sketch.excalidraw', '{"type":"excalidraw","elements":[]}')

    const dstPage = await seed(dstRoot, 'Page.md', md)
    await carryCrossVaultAssets([{ from: srcPage, to: dstPage, kind: 'file' }], dstRoot, [srcRoot, dstRoot])

    // Identical bytes: no `-2` file created.
    expect(existsSync(path.join(dstRoot, 'assets/images/same-2.png'))).toBe(false)
    // Differing bytes: copied to `-2` and original destination file left untouched.
    expect(await readFile(path.join(dstRoot, 'assets/images/diff.png'))).toEqual(PNG_B)
    expect(await readFile(path.join(dstRoot, 'assets/images/diff-2.png'))).toEqual(PNG_A)
    expect(existsSync(path.join(dstRoot, 'Sketch-2.excalidraw'))).toBe(true)

    const rewritten = await readFile(dstPage, 'utf8')
    expect(rewritten).toContain('![Same](assets/images/same.png)')
    expect(rewritten).toContain('![Diff](assets/images/diff-2.png)')
    expect(rewritten).toContain('![[Sketch-2.excalidraw|locked]]')
  })

  it('does nothing extra for same-vault copy and never throws on missing assets', async () => {
    const { srcRoot, dstRoot } = await makeVaultPair()
    const md = '![Missing](assets/images/missing.png)\n![[Present.png]]\n'
    const srcPage = await seed(srcRoot, 'Page.md', md)
    await seed(srcRoot, 'Present.png', PNG_A)
    const sameVaultCopy = await seed(srcRoot, 'Page copy.md', md)

    await carryCrossVaultAssets([{ from: srcPage, to: sameVaultCopy, kind: 'file' }], srcRoot, [srcRoot, dstRoot])
    expect(existsSync(path.join(srcRoot, 'Present-2.png'))).toBe(false)

    // Cross-vault with one missing asset + one present asset: never throws and still carries present asset.
    const dstPage = await seed(dstRoot, 'Page.md', md)
    await expect(
      carryCrossVaultAssets([{ from: srcPage, to: dstPage, kind: 'file' }], dstRoot, [srcRoot, dstRoot]),
    ).resolves.toBeUndefined()
    expect(await readFile(path.join(dstRoot, 'Present.png'))).toEqual(PNG_A)
  })
})
