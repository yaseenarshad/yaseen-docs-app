// CHECKER (YAZ-4946 round 1): ⌘Z in the page after an Inbox answer landed from outside.
import { afterEach, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { withCardOff } from '@shared/cardLine'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { applyExternalMarkdown } from '../external/applyExternalMarkdown'
import { changeNoteCardLine } from './noteCardLine'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  while (mounted.length > 0) {
    const c = mounted.pop()!
    await c.crepe.destroy()
    c.root.remove()
  }
})

it('⋯ Archive card, Unarchive card, then an outside answer, then ⌘Z: the answer stays in the file', async () => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const base = 'Intro\n\n```card\nQ\n---\nA\n```\n'
  const crepe = createCrepe({ root, defaultValue: `${base}<!-- card: WIKI-9, 2026-11-01T09:00Z good -->\n` })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  let pos = -1
  view.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === 'code_block') pos = p
    return pos === -1
  })
  // The user archives the card and unarchives it again in the ⋯ menu (two steps in the page's undo history).
  view.dispatch(changeNoteCardLine(view.state, pos, (l) => withCardOff(l, true))!)
  await new Promise((r) => setTimeout(r, 600))
  view.dispatch(changeNoteCardLine(view.state, pos, (l) => withCardOff(l, false))!)
  // The Inbox writes an answer to the file; the open note merges it (out of the undo history).
  const answered = `${base}<!-- card: WIKI-9, 2026-11-01T09:00Z good, 2026-11-12T10:00Z good -->\n`
  expect(applyExternalMarkdown(crepe, answered)).toBe('applied')
  expect(getMarkdownForSave(crepe)).toContain('2026-11-12T10:00Z good')
  // ⌘Z in the page undoes the user's last step ("Unarchive card").
  undo(view.state, view.dispatch)
  expect(getMarkdownForSave(crepe)).toContain('2026-11-12T10:00Z good')
})
