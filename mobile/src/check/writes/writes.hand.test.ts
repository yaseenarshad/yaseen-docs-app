// check-writes (YAZ-5512, YAZ-5515): hand cases of the overnight writes check for C1 (N7), S1 (N10) and the Mac merge (N9). Made-up pages only.
// The cases for the other bugs of that check (N1 to N6, N8: W1, W2, W3, T1, T2) live with the check in
// `.claude/check5-tests-keep/check-writes/` until their own fixes land.
import { splitFrontmatter } from '@shared/frontmatter'
import { describe, expect, it } from 'vitest'
import { applyOps } from '../../answers/ops'
import { applyComment } from '../../comments/write'
import { macMerge } from './macMerge.testing'

const card = (id: string, line = `<!-- card: ${id} -->`) => `\`\`\`card\nQ ${id}\n\`\`\`\n${line}\n`
const rv = (m: number) => ({ at: `2026-11-14T07:${String(m).padStart(2, '0')}Z`, rating: 'good' as const })

describe('check-writes: nasty cases', () => {
  it('N7 [comments] a page with a BOM and front matter: the comment goes INTO its block, not in a second block before the BOM', () => {
    const page = '﻿---\ntitle: Plan\n---\n# Plan\n'
    const r = applyComment(page, { id: 'pho00001', at: '2026-11-14T06:00:00Z', by: 'yaseen', body: 'Hi' })
    expect(r.kind).not.toBe('refused')
    const out = (r as { content: string }).content
    expect.soft(out.startsWith('﻿---\ntitle: Plan\n'), JSON.stringify(out)).toBe(true)
    expect.soft(out.match(/^﻿?---$/gm)?.length ?? 0, 'one block: two fence lines').toBe(2)
  })

  it('N9 [answers + Mac merge] the mixed-line-end answer then meets a Mac edit far away: no conflict copy', () => {
    const base = '# A\r\n\r\nPasted\r\n\n```card\nQ\n```\n<!-- card: NC-1 -->\n\nfar\nfar\nfar\nend line\n'
    const phone = applyOps(base, [{ kind: 'review', id: 'NC-1', review: rv(1) }]).content
    const mac = base.replace('end line', 'end line edited')
    const m = macMerge(base, phone, mac)
    expect.soft(m.copy, m.how).toBeUndefined()
  })

  it('N10 [all writes] an empty front matter block "---\\n---" and a later "---" line: the card below is still found, the comment still added', () => {
    const page = `---\n---\n# A\n\nIntro\n\n---\n\n${card('NC-1')}`
    expect.soft(splitFrontmatter(page).frontmatter, 'the block is only the two fence lines').toBe('---\n---\n')
    expect.soft(applyComment(page, { id: 'pho00001', at: '2026-11-14T06:00:00Z', by: 'y', body: 'x' }).kind).toBe('added')
    const card2 = `---\n---\n# A\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n<!-- card: NC-1 -->\n`
    expect.soft(applyOps(card2, [{ kind: 'review', id: 'NC-1', review: rv(1) }]).lost, 'a card file whose block was emptied').toEqual([])
  })
})
