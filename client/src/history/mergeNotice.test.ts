import { describe, expect, it } from 'vitest'
import { mergeNotice } from './mergeNotice'

describe('mergeNotice (YAZ-1897 D4, YAZ-3039)', () => {
  it('names the board and who made the other side', () => {
    expect(mergeNotice([{ path: 'plans/Roadmap.excalidraw', author: 'Sam', clashes: 0 }])).toEqual({ text: 'Merged Sam\'s changes into “Roadmap”.', firstBoard: 'plans/Roadmap.excalidraw' })
  })

  it('counts boards and says "kept the newest" only when shapes clashed', () => {
    const n = mergeNotice([
      { path: 'a.excalidraw', author: 'Sam', clashes: 1 },
      { path: 'b.excalidraw', author: 'Sam', clashes: 2 },
    ])
    expect(n.text).toBe("Merged Sam's changes into 2 drawings · 3 shapes edited on both — kept the newest.")
    expect(mergeNotice([{ path: 'a.excalidraw', author: 'Sam', clashes: 1 }]).text).toContain('1 shape edited on both')
  })

  it('says where our copy went when both were kept, and offers no board to open for it alone', () => {
    const n = mergeNotice([{ path: 'Flow.drawio', author: 'Sam', clashes: 0, copy: 'Flow (conflict, 2026-09-23).drawio' }])
    expect(n).toEqual({ text: '“Flow” changed on both computers — your copy is saved as “Flow (conflict, 2026-09-23)”.', firstBoard: null })
  })

  it('falls back to "the other computer" when several people were merged', () => {
    expect(mergeNotice([
      { path: 'a.excalidraw', author: 'Sam', clashes: 0 },
      { path: 'b.excalidraw', author: 'Ana', clashes: 0 },
    ]).text).toBe("Merged the other computer's changes into 2 drawings.")
  })
  it('names a merged page by its title, not its ID-vault file name, in each line (YAZ-4615)', () => {
    expect(mergeNotice([
      { path: 'Plans/plan-yaz-12.md', author: 'Sam', clashes: 0, kind: 'page', title: 'Launch plan', renumbered: [{ from: '#2', to: '#3' }] },
    ]).text).toBe("Merged Sam's comments into “Launch plan”. Your comment #2 on “Launch plan” is now #3.")
    expect(mergeNotice([
      { path: 'Plans/.folder.md', author: 'Sam', clashes: 0, kind: 'page', title: 'Plans', copy: 'Plans/folder (conflict, 2026-11-08).md' },
    ]).text).toBe('“Plans” changed on both computers — your copy is saved as “folder (conflict, 2026-11-08)”.')
  })

  it('falls back to the file name when sync sent no title', () => {
    expect(mergeNotice([{ path: 'plan.md', author: 'Sam', clashes: 0, kind: 'page' }]).text).toBe("Merged Sam's comments into “plan”.")
  })
})
