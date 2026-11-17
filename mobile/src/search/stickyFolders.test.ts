import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { MAC_SIDEBAR_DEFAULTS, sidebarLook } from './sidebarLook'
import { stuckRows, treeShape } from './stickyFolders'

/**
 * YAZ-5506: the stack of stuck folders in Search's tree, worked out from the drawn rows (the Mac sidebar's nested sticky
 * rows, YAZ-3440 D1, D2). Rows are 44 px; `y` is how far the list has scrolled past the top.
 */
const H = 44

/** A chain of `depth` open folders, each holding the next and then `files` pages. */
function chain(depth: number, files = 3): { depth: number; open?: boolean; name: string }[] {
  const rows: { depth: number; open?: boolean; name: string }[] = []
  const walk = (d: number) => {
    if (d === depth) return
    rows.push({ depth: d, open: true, name: `F${d}` })
    walk(d + 1)
    for (let i = 1; i <= files; i++) rows.push({ depth: d + 1, name: `F${d}.${i}` })
  }
  walk(0)
  return rows
}
const names = (rows: { depth: number; open?: boolean; name: string }[], y: number, cap = 7) => stuckRows(treeShape(rows), y, H, cap).map((s) => rows[s.index].name)

describe('the Mac sidebar settings Search reads (YAZ-5506)', () => {
  it("are the Mac's defaults, read through one function: 7 sticky levels; guide lines on hover, plain", () => {
    for (const key of Object.keys(MAC_SIDEBAR_DEFAULTS) as (keyof typeof MAC_SIDEBAR_DEFAULTS)[]) expect([key, MAC_SIDEBAR_DEFAULTS[key]]).toEqual([key, DEFAULT_SETTINGS[key]])
    expect(Object.keys(MAC_SIDEBAR_DEFAULTS).sort()).toEqual(['sidebarLineStyle', 'sidebarLines', 'sidebarStickyLevels', 'sidebarThreadColor'])
    expect(sidebarLook()).toEqual({ sidebarStickyLevels: 7, sidebarLines: 'hover', sidebarLineStyle: 'plain', sidebarThreadColor: null })
  })
})

describe('the tree shape', () => {
  it('knows each row’s parent and the last row inside each folder', () => {
    const shape = treeShape(chain(2, 1))
    // F0, F1, F1.1, F0.1
    expect([...shape.parent]).toEqual([-1, 0, 1, 0])
    expect([...shape.end]).toEqual([3, 2, 2, 3])
  })
})

describe('the stack of stuck folders', () => {
  it('nothing sticks while the list’s top is in view', () => {
    expect(names(chain(3), 0)).toEqual([])
    expect(names(chain(3), -20)).toEqual([])
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('a chain %i folders deep, scrolled to its deepest pages: every level sticks, up to the cap of 7', (depth) => {
    const rows = chain(depth)
    // The first page of the deepest folder at the top edge, under the stack.
    const first = rows.findIndex((r) => r.name === `F${depth - 1}.1`)
    const y = (first - Math.min(depth, 7)) * H
    const stack = stuckRows(treeShape(rows), y + 1, H, 7)
    expect(stack.map((s) => rows[s.index].name)).toEqual(Array.from({ length: Math.min(depth, 7) }, (_, d) => `F${d}`))
    // One row apart from the top, the shallower first.
    expect(stack.map((s) => s.top)).toEqual(stack.map((_, d) => d * H))
  })

  it('the cap cuts the stack: 3 levels', () => {
    const rows = chain(6)
    expect(names(rows, 10 * H, 3)).toEqual(['F0', 'F1', 'F2'])
  })

  it('a folder leaves with its last row: pushed up, then gone; its parent stays', () => {
    // F0 holds F1 (which holds 3 pages) and then 3 pages: rows F0, F1, F1.1, F1.2, F1.3, F0.1, F0.2, F0.3.
    const rows = [...chain(2, 3)]
    const shape = treeShape(rows)
    // F1's last row (index 4) under F1's slot (44): F1 at its slot.
    expect(stuckRows(shape, 2 * H, H, 7).map((s) => [rows[s.index].name, s.top])).toEqual([
      ['F0', 0],
      ['F1', H],
    ])
    // F1's last row 10 px up into F1's slot: F1 pushed up 10 px.
    expect(stuckRows(shape, 3 * H + 10, H, 7).map((s) => [rows[s.index].name, s.top])).toEqual([
      ['F0', 0],
      ['F1', H - 10],
    ])
    // F1's rows all gone: F0 alone.
    expect(names(rows, 4 * H + 1)).toEqual(['F0'])
    // The list's end: F0's last row pushes F0 up.
    expect(stuckRows(shape, 7 * H + 5, H, 7).map((s) => [rows[s.index].name, s.top])).toEqual([['F0', -5]])
  })

  it('a closed folder, and an open folder with nothing in it, never stick', () => {
    const rows = [{ depth: 0, open: false, name: 'shut' }, { depth: 0, open: true, name: 'empty' }, { depth: 0, name: 'page' }, { depth: 0, name: 'page2' }]
    expect(names(rows, H + 5)).toEqual([])
    expect(names(rows, 5)).toEqual([])
  })

  it('a folder still below its slot does not stick; right under its parent, it sticks with it', () => {
    const rows = [
      { depth: 0, open: true, name: 'A' },
      { depth: 1, name: 'A.page1' },
      { depth: 1, name: 'A.page2' },
      { depth: 1, open: true, name: 'B' },
      { depth: 2, name: 'B.page' },
      { depth: 2, name: 'B.page2' },
    ]
    expect(names(rows, 1)).toEqual(['A'])
    expect(names(rows, 2 * H)).toEqual(['A'])
    expect(names(rows, 2 * H + 1)).toEqual(['A', 'B'])
    // A chain of open folders, one right under the other: all stick at the first pixel.
    expect(names(chain(3), 1)).toEqual(['F0', 'F1', 'F2'])
  })

  // timing test: up to 3 tries so a busy CI machine doesn't fail it (YAZ-4965); still fails if slow every time
  it('stays cheap on 1,300+ rows: one shape, then each scroll looks at a few rows', { retry: 2 }, () => {
    const rows = Array.from({ length: 60 }, (_, k) => chain(8, 2).map((r) => ({ ...r, name: `${k}:${r.name}` }))).flat()
    expect(rows.length).toBeGreaterThan(1300)
    const shape = treeShape(rows)
    const start = performance.now()
    let stuck = 0
    for (let y = 1; y < rows.length * H; y += 7) stuck += stuckRows(shape, y, H, 7).length
    expect(stuck).toBeGreaterThan(0)
    // About 8,000 scroll steps: well under a millisecond each.
    expect(performance.now() - start).toBeLessThan(400)
  })
})

describe('the stuck rows’ look (treeLook.css), the Mac’s (app.css `.tree__row--sticky`)', () => {
  const css = readFileSync(new URL('./treeLook.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  const body = (selector: string) => new RegExp(`${selector.replace(/[.()[\]]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  it('the layer sticks flush at the scroller’s top edge: its top takes back the screen’s top padding', () => {
    const pad = /\.screen \{[^}]*padding: (\d+)px/.exec(styles)?.[1]
    expect(body('.tree__stuck')).toMatch(new RegExp(`top: -${pad}px;`))
    expect(body('.tree__stuck')).toMatch(/position: sticky;/)
    expect(body('.tree__stuck')).toMatch(/height: 0;/)
  })
  it('a stuck row: square, opaque in the screen’s colour, the thin line under it', () => {
    const row = body('.search .tree__stuck .tree__row--stuck')
    expect(row).toMatch(/position: absolute;/)
    expect(row).toMatch(/background: var\(--bg\);/)
    expect(row).toMatch(/box-shadow: 0 1px 0 var\(--border\);/)
    expect(row).toMatch(/border-radius: 0;/)
  })
})

// YAZ-5507: the guide lines (`guideLines.ts` says when they show).
describe('where they are drawn (treeLook.css), the Mac’s (app.css `.tree[role=group]::before`)', () => {
  const css = readFileSync(new URL('./treeLook.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const mac = readFileSync(new URL('../../../client/src/app.css', import.meta.url), 'utf8')
  const line = /\.search \.tree > li > \.tree__row::before \{([^}]*)\}/.exec(css)?.[1] ?? ''
  it('one 1 px grey line for each level above the row, 14 px apart, the first at 15 px: the chevron centres', () => {
    // The Mac: a row is indented 8 + depth × 14 px, its chevron 14 px wide; a level's line at depth × 14 + 1 px.
    expect(mac).toMatch(/left: calc\(var\(--tree-depth\) \* 14px \+ 1px\);/)
    expect(line).toMatch(/left: 15px;/)
    expect(line).toMatch(/width: calc\(var\(--tree-depth, 0\) \* 14px\);/)
    expect(line).toMatch(/background: repeating-linear-gradient\(to right, var\(--border\) 0 1px, transparent 1px 14px\);/)
    expect(line).toMatch(/top: 0;[\s\S]*bottom: 0;/)
    expect(line).toMatch(/pointer-events: none;/)
    expect(line).toMatch(/opacity: 0;/)
  })
  it('they show by `data-lines` (and `data-touch` for "hover") on the list, never on a stuck row', () => {
    expect(css).toMatch(/\.tree\[data-lines='always'\] > li > \.tree__row::before,\s*\.tree\[data-lines='hover'\]\[data-touch\] > li > \.tree__row::before \{\s*opacity: 1;/)
    // Only the list's own rows (`.tree > li >`): the stuck copies stand in their layer, not in the list.
    expect(css).not.toMatch(/tree__row--stuck::before/)
    expect(/\.tree__stuck \{([^}]*)\}/.exec(css)?.[1]).toMatch(/z-index: 2;/)
  })
})
