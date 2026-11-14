// THE NO-DROP RULE (YAZ-4998): no step empties a card's history, or drops a review, unless each review it holds is on
// the card that keeps the ID, or is written onto it in the same step. ONE rule (`settleCardCopy`, `@shared/cardLine`)
// for BOTH paths: the editor's copy rule (a paste, a cut and paste, a drag, an Alt-drag duplicate) and the index's ID
// sweep. This table runs both, in different orders, with an agent's older copy of the card on the page or not.
//
// The sweep is the main process's REAL sweep (`desktop/src/main/vaultIndex/idSweep.ts`) on a real temp vault: the
// editor saves the page, the sweep writes the file, and the open page takes the file back as the app does
// (`applyExternalMarkdown`).
import { mkdtempSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { redo, undo } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cardIdOf, cardReviewsOf, formatCardLine, isCardNext, pageCards, settleCardCopy, withCardNext, type CardLine } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { IDS_FILE } from '@shared/pageId'
import type { IndexRecord } from '@shared/types'
import { removeVault } from '../../../../desktop/src/main/fs/testFixture'
import { writeConfig } from '../../../../desktop/src/main/vaultConfig'
import { sweepIds } from '../../../../desktop/src/main/vaultIndex/idSweep'
import { scanFile } from '../../../../desktop/src/main/vaultIndex/scan'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { applyExternalMarkdown } from '../external/applyExternalMarkdown'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { isCardNode, cardLineOf } from './cardBlockLine'

// The vault's door keeps this Mac's ID in the app data folder: a temp one, never the real one (`desktop/src/test-setup.ts`).
process.env.YASEEN_DOCS_USER_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'mdapp-userdata-'))

const FRONT = '---\nid: WIKI-1\n---\n'
const FULL = 'WIKI-9, 2026-11-01T09:00Z good, 2026-11-07T09:00Z good'
const card = (text: string, line: string) => `\`\`\`card\n${text}\n---\nA\n\`\`\`\n<!-- card: ${line} -->\n`

/** The agent's older copy of the card, written above the original (not swept yet). */
const AGENTS = {
  none: null,
  'agent copy, same text, older line': card('Q', 'WIKI-9, 2026-11-01T09:00Z good'),
  'agent copy, another text, older line': card('Q, reworded', 'WIKI-9, 2026-11-01T09:00Z good'),
  // A git "keep both": the other Mac's line holds a review the original does not.
  'agent copy, same text, a review the original lacks': card('Q', 'WIKI-9, 2026-11-01T09:00Z good, 2026-11-09T09:00Z hard'),
} as const

type Op = 'paste' | 'cutPaste' | 'drag' | 'duplicate' | 'sweep' | 'agent' | 'undoRedo'

/** The sequences: each runs with each agent case. The first is YAZ-4998 as filed. */
const SEQUENCES: Op[][] = [
  ['cutPaste'],
  ['cutPaste', 'sweep'],
  ['cutPaste', 'undoRedo', 'sweep'],
  ['sweep', 'cutPaste', 'sweep'],
  ['paste', 'sweep'],
  ['paste', 'cutPaste', 'sweep'],
  ['drag', 'sweep'],
  ['duplicate', 'sweep'],
  ['duplicate', 'drag', 'cutPaste', 'sweep'],
  ['sweep', 'paste', 'drag', 'sweep'],
  ['cutPaste', 'paste', 'sweep', 'duplicate', 'sweep'],
  ['paste', 'agent', 'cutPaste', 'sweep'],
  ['sweep', 'agent', 'duplicate', 'cutPaste', 'sweep'],
]

let root: string
const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-nodrop-'))
  await writeConfig(root, IDS_FILE, { enabled: true, letters: 'WIKI' })
})
afterEach(async () => {
  while (mounted.length > 0) {
    const c = mounted.pop()!
    await c.crepe.destroy()
    c.root.remove()
  }
  await removeVault(root)
})

const reviewKey = (r: { at: string; rating: string }) => `${r.at} ${r.rating}`
/** Every review the page's cards hold, each card's list kept apart. */
const reviewsOn = (body: string): string[][] => pageCards(body).map((c) => cardReviewsOf(c.line).map(reviewKey))
const reviewSet = (body: string) => new Set(reviewsOn(body).flat())

/** The editor's cards, in page order. */
function cardsOf(view: EditorView): Array<{ pos: number; node: ProseNode; line: CardLine }> {
  const cards: Array<{ pos: number; node: ProseNode; line: CardLine }> = []
  view.state.doc.descendants((node, pos) => {
    if (isCardNode(node)) {
      cards.push({ pos, node, line: cardLineOf(node) })
      return false
    }
    return !node.isTextblock
  })
  return cards
}

/** "The original": the card with the most reviews (the last of a tie). */
function original(view: EditorView) {
  const cards = cardsOf(view)
  return cards.reduce((best, c) => (cardReviewsOf(c.line).length >= cardReviewsOf(best.line).length ? c : best), cards[0])
}

const tick = () => new Promise((r) => setTimeout(r, 0))

async function open(agent: string | null) {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [], true, ['WIKI'])
  const el = document.createElement('div')
  document.body.appendChild(el)
  const body = `${agent ?? ''}${agent === null ? '' : '\n'}${card('Q', FULL)}\nOutro\n`
  let next = 100
  const file = path.join(root, 'deck.md')
  const crepe = createCrepe({ root: el, defaultValue: body, wikilinks: source, cards: { path: file, mintId: () => Promise.resolve(`WIKI-${next++}`) } })
  await crepe.create()
  mounted.push({ crepe, root: el })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  return { crepe, view, file }
}

/** One step. Returns the page's body after it (the editor's save, or the file the sweep wrote). */
async function run(op: Op, crepe: Crepe, view: EditorView, file: string, agentCard: string): Promise<string> {
  const end = () => view.state.doc.content.size
  if (op === 'paste' || op === 'duplicate') {
    // A copy of the original, inserted at the end: a paste, or an Alt-drag (a drop with no delete).
    view.dispatch(view.state.tr.insert(end(), original(view).node).setMeta('uiEvent', op === 'paste' ? 'paste' : 'drop'))
  } else if (op === 'cutPaste') {
    // TWO dispatches: the cut, then the paste lower in the page.
    const { pos, node } = original(view)
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize).setMeta('uiEvent', 'cut'))
    view.dispatch(view.state.tr.insert(end(), node).setMeta('uiEvent', 'paste'))
  } else if (op === 'drag') {
    // ONE dispatch: the card lands at the end and leaves its place.
    const { pos, node } = original(view)
    view.dispatch(view.state.tr.insert(end(), node).delete(pos, pos + node.nodeSize).setMeta('uiEvent', 'drop'))
  } else if (op === 'undoRedo') {
    // ⌘Z, then ⇧⌘Z: the paste and the union it wrote come back together.
    undo(view.state, view.dispatch)
    await tick()
    redo(view.state, view.dispatch)
  } else if (op === 'agent') {
    // An agent rewrites the page and puts its older copy of the card on top (an outside write).
    applyExternalMarkdown(crepe, agentCard + '\n' + getMarkdownForSave(crepe))
  } else {
    // The page saves; the index scans it; the sweep runs; the open page takes the file back.
    await writeFile(file, FRONT + getMarkdownForSave(crepe))
    const records = new Map<string, IndexRecord>([[file, await scanFile(root, file)]])
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id)
    const body = splitFrontmatter(await readFile(file, 'utf8')).body
    applyExternalMarkdown(crepe, body)
    return body
  }
  await tick()
  return getMarkdownForSave(crepe)
}

describe('no review leaves the file: the editor and the sweep, in any order (YAZ-4998)', () => {
  for (const [agentName, agentCard] of Object.entries(AGENTS)) {
    for (const ops of SEQUENCES) {
      it(`${agentName}: ${ops.join(' → ')}`, async () => {
        const { crepe, view, file } = await open(agentCard)
        let before = getMarkdownForSave(crepe)
        for (const op of ops) {
          const after = await run(op, crepe, view, file, agentCard ?? card('Q', 'WIKI-9, 2026-11-01T09:00Z good'))
          // 1. The set of reviews in the file holds every review it held before the step.
          const lost = [...reviewSet(before)].filter((r) => !reviewSet(after).has(r))
          expect(lost, `${op} dropped a review`).toEqual([])
          // 2. No card holds a review two times.
          for (const reviews of reviewsOn(after)) expect(new Set(reviews).size, `${op}: a review twice on one card`).toBe(reviews.length)
          // 3. After the sweep, no two cards share an ID.
          if (op === 'sweep') {
            const ids = pageCards(after).map((c) => cardIdOf(c.line))
            expect(ids.every((id) => id !== null), 'a card with no ID after the sweep').toBe(true)
            expect(new Set(ids).size, `IDs after the sweep: ${ids.join(' ')}`).toBe(ids.length)
          }
          before = after
        }
      })
    }
  }
})

describe('YAZ-4998 as filed: the user cuts the original and pastes it lower, beside the agent\'s older copy', () => {
  it('another text on the agent copy: the original keeps both reviews under a new ID; the agent copy keeps WIKI-9', async () => {
    const { crepe, view, file } = await open(AGENTS['agent copy, another text, older line'])
    const body = await run('cutPaste', crepe, view, file, '')
    expect(pageCards(body).map((c) => [c.text.split('\n')[0], cardIdOf(c.line), cardReviewsOf(c.line).map(reviewKey)])).toEqual([
      ['Q, reworded', 'WIKI-9', ['2026-11-01T09:00Z good']],
      ['Q', 'WIKI-100', ['2026-11-01T09:00Z good', '2026-11-07T09:00Z good']],
    ])
  })

  it('the same text on the agent copy: the agent copy takes the Nov 7 review in the paste\'s transaction; one ⌘Z undoes the paste and the union', async () => {
    const { crepe, view, file } = await open(AGENTS['agent copy, same text, older line'])
    const body = await run('cutPaste', crepe, view, file, '')
    expect(pageCards(body).map((c) => [cardIdOf(c.line), cardReviewsOf(c.line).map(reviewKey)])).toEqual([
      ['WIKI-9', ['2026-11-01T09:00Z good', '2026-11-07T09:00Z good']],
      ['WIKI-100', []],
    ])
    // ⌘Z undoes the paste and the union together (the ID from the door is out of the undo history): the cut is left.
    undo(view.state, view.dispatch)
    expect(pageCards(getMarkdownForSave(crepe)).map((c) => [cardIdOf(c.line), cardReviewsOf(c.line).map(reviewKey)])).toEqual([['WIKI-9', ['2026-11-01T09:00Z good']]])
  })
})

describe('settleCardCopy, the one rule', () => {
  const line = (...reviews: string[]): CardLine => ({ parts: [{ kind: 'id', id: 'WIKI-9' }, ...reviews.map((r) => ({ kind: 'review' as const, review: { at: r, rating: 'good' as const } }))] })
  const keys = (l: CardLine | null) => (l === null ? null : cardReviewsOf(l).map((r) => r.at))
  const cases: Array<[string, { line: CardLine; text: string } | null, { line: CardLine; text: string }, string[] | null, string[], boolean]> = [
    ['no keeper here: the copy keeps its history', null, { line: line('A'), text: 'Q' }, null, ['A'], false],
    ['another text: each keeps its own', { line: line('A'), text: 'Q2' }, { line: line('A', 'B'), text: 'Q' }, ['A'], ['A', 'B'], false],
    ['same text, the keeper lacks a review: the union, then the copy empties', { line: line('A'), text: 'Q' }, { line: line('A', 'B'), text: 'Q' }, ['A', 'B'], [], true],
    ['same text, disjoint: the union in time order', { line: line('C'), text: 'Q' }, { line: line('A'), text: 'Q' }, ['A', 'C'], [], true],
    ['same text, same reviews: nothing to add', { line: line('A'), text: 'Q' }, { line: line('A'), text: 'Q' }, ['A'], [], true],
  ]
  for (const [name, keeper, copy, keeperAfter, copyAfter, emptied] of cases)
    it(name, () => {
      const done = settleCardCopy(keeper, copy)
      expect([keys(done.keeper), keys(done.copy), done.emptied]).toEqual([keeperAfter, copyAfter, emptied])
      // The invariant: an emptied history's reviews are all on the keeper.
      if (done.emptied) for (const r of cardReviewsOf(copy.line)) expect(keys(done.keeper)).toContain(r.at)
    })
  it('nothing to add: the keeper is the same object, so no caller writes it', () => {
    const keeper = { line: line('A'), text: 'Q' }
    expect(settleCardCopy(keeper, { line: line('A'), text: 'Q' }).keeper).toBe(keeper.line)
  })
  it('up next (YAZ-4999): an emptied copy keeps no `next`; the keeper keeps its own and takes none; a copy that keeps its history keeps its `next`', () => {
    const next = (l: CardLine) => withCardNext(l, true)
    // The copy is up next, the keeper is not: the copy empties and loses `next`; the keeper does not take it.
    const one = settleCardCopy({ line: line('A'), text: 'Q' }, { line: next(line('A', 'B')), text: 'Q' })
    expect([isCardNext(one.keeper!), isCardNext(one.copy), one.emptied]).toEqual([false, false, true])
    // Both up next: the keeper keeps its own `next`; the emptied copy keeps none.
    const both = settleCardCopy({ line: next(line('A')), text: 'Q' }, { line: next(line('A', 'B')), text: 'Q' })
    expect([isCardNext(both.keeper!), isCardNext(both.copy), keys(both.keeper)]).toEqual([true, false, ['A', 'B']])
    expect(formatCardLine(both.copy)).toBe('<!-- card: WIKI-9 -->')
    // Another text: the copy is a card of its own and keeps its history and its `next`.
    const own = settleCardCopy({ line: line('A'), text: 'Q2' }, { line: next(line('B')), text: 'Q' })
    expect([isCardNext(own.keeper!), isCardNext(own.copy), own.emptied]).toEqual([false, true, false])
  })
})
