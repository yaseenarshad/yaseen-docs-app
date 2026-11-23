/**
 * The caret comes back after the "Allow edits?" box (YAZ-4997 round 2, Yaseen: "return the caret to where I was
 * previously or where I was selecting prior to me having moved it to read only"). A REAL Crepe, read only with its
 * keyboard (`readOnlyKeys`), in a page with the real chip, wired as `Editor.tsx` wires it: the box keeps the selection
 * when it opens (`keepCaretOf`), and a choice, Cancel or Esc gives it back with the focus (`giveCaretBack`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, editorViewOf, giveCaretBack, keepCaretOf, type KeptCaret } from './createCrepe'
import { ReadOnlyChip } from './ReadOnlyChip'
import { tellReadOnlyEdit } from './readOnlyEdit'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let page: HTMLElement | null = null
let crepe: Crepe | null = null

afterEach(async () => {
  act(() => root?.unmount())
  await crepe?.destroy()
  page?.remove()
  root = page = crepe = null
})

/** The host, as `Editor.tsx`: locked until a choice, the box's keep and give back, Lock now locks again. */
function Host({ of }: { of: Crepe }) {
  const [asking, setAsking] = useState(false)
  const [until, setUntil] = useState<number | null>(null)
  const [kept, setKept] = useState<KeptCaret | null>(null)
  of.setReadonly(until === null)
  return (
    <ReadOnlyChip
      asking={asking}
      onAsk={() => {
        setKept(keepCaretOf(of))
        setAsking(true)
      }}
      onAllow={() => {
        setAsking(false)
        setUntil(Date.now() + 60_000)
      }}
      onCancel={() => setAsking(false)}
      editingUntil={until}
      onLock={() => setUntil(null)}
      lockKeys
      onReturn={(to) => giveCaretBack(of, to === 'ask' ? kept : null)}
    />
  )
}

async function mountPage() {
  page = document.createElement('section')
  page.className = 'editor'
  document.body.appendChild(page)
  const bar = document.createElement('div')
  const mount = document.createElement('div')
  page.append(bar, mount)
  crepe = createCrepe({ root: mount, defaultValue: 'first line of text\n\nsecond line here\n', readOnlyKeys: true })
  await crepe.create()
  const made = crepe
  root = createRoot(bar)
  act(() => root!.render(<Host of={made} />))
  const view = editorViewOf(made)
  // Yaseen selects "line" in the second paragraph, in the locked page.
  const start = view.state.doc.textContent.indexOf('second') + 'second '.length + 3
  act(() => {
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 4)))
  })
  expect(view.state.doc.textBetween(start, start + 4)).toBe('line')
  return { view, from: start, to: start + 4 }
}

const key = (target: Element, name: string) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })))
const box = () => document.querySelector<HTMLElement>('.read-only-chip__ask')

/** Types in the locked page: the message shows, and Enter opens the box, which takes the keyboard. */
function enterOpensBox(view: ReturnType<typeof editorViewOf>) {
  expect(view.editable).toBe(false)
  act(() => tellReadOnlyEdit(view.dom, 'page'))
  key(view.dom, 'Enter')
  expect(box()).not.toBeNull()
  expect(document.activeElement?.textContent).toBe('Allow edits for 1 minute')
  // Nothing in the page moved the selection meanwhile (a stray move would be put right by the give back).
  act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))))
}

describe('the caret comes back after the "Allow edits?" box (YAZ-4997 round 2)', () => {
  it('Enter, then 1 minute: the page is unlocked, has the focus, and the selection is the one it had, so typing goes on there', async () => {
    const { view, from, to } = await mountPage()
    enterOpensBox(view)
    key(document.activeElement!, 'Enter')
    expect(box()).toBeNull()
    expect(view.editable).toBe(true)
    expect(document.activeElement).toBe(view.dom)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([from, to])
  })

  it('Esc in the box: the same selection and the focus come back, still locked; a click on the chip and Cancel too', async () => {
    const { view, from, to } = await mountPage()
    enterOpensBox(view)
    key(document.activeElement!, 'Escape')
    expect(box()).toBeNull()
    expect(view.editable).toBe(false)
    expect(document.activeElement).toBe(view.dom)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([from, to])
    // By mouse: the chip, then Cancel.
    act(() => document.querySelector<HTMLButtonElement>('.read-only-chip__button')!.click())
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))))
    act(() => [...box()!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click())
    expect(document.activeElement).toBe(view.dom)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([from, to])
  })

  it('Lock now: the page locks again and the caret stays where it is now', async () => {
    const { view } = await mountPage()
    enterOpensBox(view)
    act(() => (document.activeElement as HTMLElement).click())
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4))))
    act(() => document.querySelector<HTMLButtonElement>('.read-only-chip__lock')!.click())
    expect(view.editable).toBe(false)
    expect(document.activeElement).toBe(view.dom)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([4, 4])
  })
})
