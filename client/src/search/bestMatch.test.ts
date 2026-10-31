import { describe, expect, it } from 'vitest'
import { holdsId } from '@shared/noteId'
import type { TreeNode } from '@shared/types'
import { readNeedle } from '../links/completion'
import { bestScores, matchScore } from './bestMatch'
import type { SearchCandidate } from './searchCandidates'

const row = (path: string, name: string, id?: string): SearchCandidate => ({ kind: 'file', name, lower: name.toLowerCase(), label: name, path, folder: '', ...(id !== undefined && { id }) })
const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
const dir = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })

describe('matchScore (YAZ-3511 D12)', () => {
  it('1 the same name, 2 starts with, 3 holds (edge case 28); 4 a word match, 5 a joined match (YAZ-3748 D2)', () => {
    const plan = readNeedle('plan')
    expect(matchScore(row('/v/a.md', 'Plan'), plan, null)).toBe(1)
    expect(matchScore(row('/v/b.md', 'Plan B'), plan, null)).toBe(2)
    expect(matchScore(row('/v/c.md', 'Project plan'), plan, null)).toBe(3)
    const log = readNeedle('working log')
    expect(matchScore(row('/v/d.md', 'Working-Log'), log, null)).toBe(4)
    expect(matchScore(row('/v/e.md', 'Yaseen-Eval-Work-Workinglog'), log, null)).toBe(5)
  })

  it('0 only for an ID the text holds: "12 rules" with no ID does not beat YAZ-12 (edge case 32)', () => {
    const holds = holdsId('YAZ-12')
    expect(matchScore(row('/v/s.md', 'Sprint review', 'YAZ-12'), readNeedle('YAZ-12'), holds)).toBe(0)
    expect(matchScore(row('/v/r.md', 'yaz-12 rules'), readNeedle('YAZ-12'), holds)).toBe(2)
  })
})

describe('bestScores (YAZ-3511 D12)', () => {
  it('a note takes the best of its rows; a folder the best inside it; a folder the cut did not open is not walked (edge cases 30, 33)', () => {
    const results = [row('/v/Docs/n.md', 'Project plan'), row('/v/Docs/n.md', 'plan'), row('/v/m.md', 'Plan B'), { ...row('/v/Big', 'Plans'), kind: 'dir' as const }]
    const cut = [dir('/v/Docs', [file('/v/Docs/n.md')]), file('/v/m.md'), dir('/v/Big', [file('/v/Big/x.md')])]
    const scores = bestScores(results, 'plan', cut, new Set(['/v/Docs']))
    expect(Object.fromEntries(scores)).toEqual({ '/v/Docs/n.md': 1, '/v/Docs': 1, '/v/m.md': 2, '/v/Big': 2 })
  })
})
