import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uniteCardLines } from '@shared/cardMerge'
import { mergePageComments, pageRest } from '@shared/commentMerge'
import { mergeLinesApart } from '@shared/lineMerge'

/** git's own three-way line merge (as the Mac's rebase and `lineMerge` run it); null on a conflict. */
export function gitMerge(base: string, theirs: string, mine: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'check-writes-'))
  try {
    const [b, t, m] = ['base', 'theirs', 'mine'].map((n) => join(dir, n))
    writeFileSync(b, base)
    writeFileSync(t, theirs)
    writeFileSync(m, mine)
    try {
      return execFileSync('git', ['merge-file', '-p', '--quiet', t, b, m], { encoding: 'utf8' })
    } catch {
      return null
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The Mac's sync of one page when it has a local commit (`mine`) and the phone's commit is on GitHub (`theirs`):
 * git's rebase merge first; on a conflict, `resolve.ts`'s `settle` for a page (card rule, comments by id, the rest by
 * line, else D9: a conflict copy).
 */
export function macMerge(base: string, theirs: string, mine: string): { text: string; copy?: string; how: 'git' | 'settle' | 'keep-both' } {
  const clean = gitMerge(base, theirs, mine)
  if (clean !== null) return { text: clean, how: 'git' }
  const [t, m] = uniteCardLines(base, theirs, mine)
  let merged = mergePageComments(base, t, m)
  if (merged?.copy !== undefined) {
    const [rb, rt, rm] = [pageRest(base), pageRest(t), pageRest(m)]
    // As `resolve.ts` settles it: git's line merge, then edits on different lines apart (YAZ-5515 X2).
    const lined = gitMerge(rb, rt, rm) ?? mergeLinesApart(rb, rt, rm)
    if (lined !== null) merged = mergePageComments(base, t, m, () => lined)
  }
  if (merged === null) return { text: theirs, copy: mine, how: 'keep-both' }
  return { text: merged.text, ...(merged.copy !== undefined && { copy: merged.copy }), how: 'settle' }
}
