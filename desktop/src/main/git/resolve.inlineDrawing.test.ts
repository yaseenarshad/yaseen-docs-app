/**
 * YAZ-6142, against REAL git: an inline ```` ```excalidraw ```` block edited on two Macs merges
 * shape-by-shape (`shared/inlineDrawingMerge.ts` + `shared/boardMerge.ts`) before the page's line
 * merge, so both Macs' shapes survive in one `.md` file with zero conflict markers and zero
 * conflict copy. Malformed JSON never throws and falls back safely.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { splitFrontmatter } from '@shared/frontmatter'
import { findInlineDrawings } from '@shared/inlineDrawing'
import { uniteInlineDrawings } from '@shared/inlineDrawingMerge'
import { makeTwoMachines, REAL_GIT_TIMEOUT_MS, type Machine } from './gitFixture'
import { syncPass } from './sync'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const shape = (id: string, type: string, x: number, updated = 100) => ({
  id,
  type,
  x,
  y: 0,
  width: 100,
  height: 60,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  updated,
})

const scene = (...elements: Record<string, unknown>[]) =>
  JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} })

const drawingBlock = (json: string, line = '<!-- drawing: title "Flow", 640x360 locked -->') =>
  `\`\`\`excalidraw\n${json}\n\`\`\`\n${line}\n`

const page = (block: string, top = 'Intro.', bottom = 'End.') =>
  `---\nid: YAZ-1\ntitle: Notes\n---\n# Notes\n\n${top}\n\n${block}\n${bottom}\n`

const copies = (m: Machine) => readdirSync(m.root).filter((f) => f.includes('(conflict'))

function vault(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(root, p).split(path.sep).join('/')] = readFileSync(p, 'utf8')
    }
  }
  walk(root)
  return out
}

async function meet(files: Record<string, string>, sam: Record<string, string>, me: Record<string, string>) {
  const pair = await makeTwoMachines(files)
  cleanups.push(pair.cleanup)
  const { a, b } = pair
  for (const [rel, text] of Object.entries(sam)) await b.write(rel, text)
  for (const [rel, text] of Object.entries(me)) await a.write(rel, text)
  expect((await syncPass(b.root)).state).toBe('synced')
  const status = await syncPass(a.root)
  expect(status.state).toBe('synced')
  expect((await syncPass(b.root)).state).toBe('synced')
  expect(vault(b.root)).toEqual(vault(a.root))
  expect(await a.git('status', '--porcelain')).toBe('')
  return { a, b, status }
}

describe('uniteInlineDrawings (pure)', () => {
  it('merges shape additions and 3-way merges title/options without throwing', () => {
    const base = page(drawingBlock(scene(shape('base1', 'rectangle', 0)), '<!-- drawing: 640x360 locked -->'))
    const theirs = page(drawingBlock(scene(shape('base1', 'rectangle', 0), shape('rectB', 'rectangle', 200)), '<!-- drawing: title "Renamed", 640x360 locked -->'))
    const mine = page(drawingBlock(scene(shape('base1', 'rectangle', 0), shape('arrowA', 'arrow', 400)), '<!-- drawing: 640x360 locked -->'))

    const [t, m] = uniteInlineDrawings(base, theirs, mine)
    expect(t).toBe(m)
    const blocks = findInlineDrawings(splitFrontmatter(t).body)
    expect(blocks).toHaveLength(1)
    const parsed = JSON.parse(blocks[0]!.json) as { elements: Array<{ id: string }>; files: Record<string, unknown> }
    expect(parsed.elements.map((e) => e.id)).toEqual(['base1', 'rectB', 'arrowA'])
    expect(parsed.files).toEqual({})
    expect(blocks[0]!.drawingLine).toBe('<!-- drawing: title "Renamed", 640x360 locked -->')
  })

  it('never throws on malformed JSON and returns original inputs unchanged', () => {
    const base = page(drawingBlock(scene(shape('base1', 'rectangle', 0))))
    const theirs = page(drawingBlock('{not valid json'))
    const mine = page(drawingBlock(scene(shape('base1', 'rectangle', 0), shape('arrowA', 'arrow', 400))))
    expect(() => uniteInlineDrawings(base, theirs, mine)).not.toThrow()
    expect(uniteInlineDrawings(base, theirs, mine)).toEqual([theirs, mine])
  })
})

describe('sync merges conflicting inline Excalidraw blocks shape-by-shape (YAZ-6142)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('two Macs add different shapes to the same inline drawing: both shapes survive with zero conflict markers and no copy', async () => {
    const base = page(drawingBlock(scene(shape('base1', 'rectangle', 0))))
    const sam = page(drawingBlock(scene(shape('base1', 'rectangle', 0), shape('rectB', 'rectangle', 180))), 'Intro (Sam).', 'End.')
    const me = page(drawingBlock(scene(shape('base1', 'rectangle', 0), shape('arrowA', 'arrow', 360))), 'Intro.', 'End (Me).')

    const { a, status } = await meet({ 'notes.md': base }, { 'notes.md': sam }, { 'notes.md': me })
    const result = a.read('notes.md')
    expect(result).not.toContain('<<<<<<<')
    expect(result).toContain('Intro (Sam).')
    expect(result).toContain('End (Me).')
    expect(copies(a)).toEqual([])
    expect(status.merged?.[0]?.copy).toBeUndefined()

    const blocks = findInlineDrawings(splitFrontmatter(result).body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.drawingLine).toBe('<!-- drawing: title "Flow", 640x360 locked -->')
    const parsed = JSON.parse(blocks[0]!.json) as { elements: Array<{ id: string }>; files: Record<string, unknown> }
    expect(parsed.elements.map((e) => e.id).sort()).toEqual(['arrowA', 'base1', 'rectB'])
    expect(parsed.files).toEqual({})
  })

  it('malformed JSON in an inline drawing block never throws and falls back safely to conflict copy', async () => {
    const base = page(drawingBlock(scene(shape('base1', 'rectangle', 0))))
    const sam = page(drawingBlock('{corrupt json from remote'))
    const me = page(drawingBlock(scene(shape('base1', 'rectangle', 0), shape('arrowA', 'arrow', 360))))

    const { a } = await meet({ 'notes.md': base }, { 'notes.md': sam }, { 'notes.md': me })
    expect(a.read('notes.md')).toContain('{corrupt json from remote')
    expect(copies(a)).toHaveLength(1)
  })
})
