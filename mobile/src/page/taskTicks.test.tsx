// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { act, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { splitFrontmatter } from '@shared/frontmatter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommentsPort } from '../comments/bridge'
import type { WaitingComment } from '../comments/outbox'
import type { NewCommentInput } from '../comments/sender'
import { TASK_REFUSED_WORDS, applyTask, taskCore } from '../comments/taskWrite'
import { TASKS_PAGE } from '../dev/taskFixtures'
import { renderPage, renderPiece, type PageLook } from './pageRender'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { useTaskTicks } from './taskTicks'

/**
 * YAZ-5494: the tap on a task's box in a page. The box shows its new state at once (struck through by the reader's
 * look), the tick goes to the comment list (a fake port here; the send is `comments/taskSend.test.ts`), a box whose
 * task the stored page does not hold the same is refused at the tap, a tick the send refused says so and shows the
 * page's state, a card's box is no control, and the tap area is 44 px.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: (text) => {
    // The Mac's card look: a box is a glyph.
    const el = document.createElement('div')
    el.className = 'card'
    el.textContent = text.replace(/\[ \]/g, '☐')
    return el
  },
}
const PATH = 'home/Weekend jobs.md'

/** A fake comment list: what went in, and a refusal a test can set. */
function fakePort() {
  const list: WaitingComment[] = []
  const listeners = new Set<() => void>()
  const port: CommentsPort & { list: WaitingComment[]; refuse(id: string): void; settle(id: string): void } = {
    list,
    ready: async () => {},
    waiting: (path) => list.filter((c) => path === undefined || c.path === path),
    add: vi.fn(async (input: NewCommentInput) => {
      const c: WaitingComment = { id: `t${list.length}`, path: input.path, body: input.body, at: '2026-11-14T06:00:00Z', madeAt: 0, notBefore: 0, ...(input.task ? { task: input.task } : {}) }
      list.push(c)
      return c
    }),
    undo: async () => false,
    discard: vi.fn(async (id: string) => {
      const at = list.findIndex((c) => c.id === id)
      if (at >= 0) list.splice(at, 1)
      return at >= 0
    }),
    subscribe(l) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    refuse(id) {
      const c = list.find((w) => w.id === id)!
      c.refused = 'changed'
      for (const l of [...listeners]) l()
    },
    /** The send settled it (written, or found done already): it leaves the list. */
    settle(id) {
      list.splice(list.findIndex((w) => w.id === id), 1)
      for (const l of [...listeners]) l()
    },
  }
  return port
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function page(text: string, port: CommentsPort | null) {
  const said: string[] = []
  let paint: () => void = () => {}
  function Page() {
    const host = useRef<HTMLDivElement>(null)
    const [, setNotice] = useState<string | null>(null)
    // A tick that settled: the page reads its stored file again (here the same text) and paints from it, as PageView.
    const ticks = useTaskTicks(
      host,
      PATH,
      text,
      port,
      (w) => {
        said.push(w)
        setNotice(w)
      },
      () => ticksRef.current?.paint(),
    )
    const ticksRef = useRef(ticks)
    ticksRef.current = ticks
    paint = ticks.paint
    useEffect(() => {
      void renderPage(splitFrontmatter(text).body, look, host.current!).then(() => ticks.paint())
    }, [])
    return <div className="reader__body" ref={host} />
  }
  const el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root!.render(<Page />))
  await act(async () => {})
  const body = el.querySelector<HTMLElement>('.reader__body')!
  const boxes = () => [...body.querySelectorAll<HTMLElement>('.page-task')]
  const box = (text: string) => boxes().find((b) => b.closest('li')!.textContent!.trim().startsWith(text))!
  return { body, boxes, box, said, paint: () => paint() }
}
const tap = async (el: HTMLElement) => act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))

describe('the boxes of a page (YAZ-5494)', () => {
  it("each box of the page's own tasks carries its line, as the file's task lines read; a card's and a code fence's do not", async () => {
    const { boxes, body } = await page(TASKS_PAGE, fakePort())
    const lines = TASKS_PAGE.split('\n').map(taskCore).filter((c): c is string => c !== null)
    const drawn = boxes().map((b) => b.dataset.task)
    // The card block (`- [ ] Beans`) and the code fence's line are lines too, but the page draws no box of its own for them.
    expect(drawn).toEqual(lines.filter((c) => c !== '- [ ] Beans' && c !== '- [ ] not a task, code'))
    expect(body.querySelector('.card')?.textContent).toContain('☐ Beans')
    expect(boxes().every((b) => b.getAttribute('role') === 'checkbox' && b.tabIndex === 0)).toBe(true)
  })
})

describe('a tap ticks (YAZ-5494)', () => {
  it('the box shows its new state at once and the tick goes in the list: the task, which of its twins, the state', async () => {
    const port = fakePort()
    const p = await page(TASKS_PAGE, port)
    const seeds = p.box('Buy seeds')
    await tap(seeds)
    expect(seeds.dataset.checked).toBe('true')
    expect(seeds.getAttribute('aria-checked')).toBe('true')
    expect(port.add).toHaveBeenCalledWith({ path: PATH, body: '', task: { core: '- [ ] Buy seeds', nth: 0, of: 1, checked: true } })
    // The tick it names finds the same task in the stored page and changes one byte.
    expect(applyTask(TASKS_PAGE, port.list[0]!.task!)).toMatchObject({ kind: 'ticked' })
    // Again: unticked, a second entry (applied in order: the page ends as it began).
    await tap(seeds)
    expect(seeds.dataset.checked).toBe('false')
    expect(port.list.map((c) => c.task!.checked)).toEqual([true, false])
  })

  it('a done task in a quote and a nested [X] untick; an ordered one ticks', async () => {
    const port = fakePort()
    const p = await page(TASKS_PAGE, port)
    await tap(p.box('Return the drill'))
    await tap(p.box('Empty the box'))
    await tap(p.box('Sweep the shed'))
    expect(port.list.map((c) => [c.task!.core, c.task!.checked])).toEqual([
      ['- [ ] Return the drill', false],
      ['- [ ] Empty the box', false],
      ['1. [ ] Sweep the shed', true],
    ])
  })

  it('the 44 px tap area is around the box, and the box keeps its size', async () => {
    const css = readFileSync(fileURLToPath(import.meta.url).replace(/taskTicks\.test\.tsx$/, 'reader.css'), 'utf8')
    const rule = css.slice(css.indexOf('/* YAZ-5494'))
    expect(rule).toMatch(/width: 44px;\s*height: 44px;/)
    // The rules of the box itself (not its empty `::before`) change none of its size.
    const own = [...rule.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => !sel!.includes('::before'))
    expect(own.length).toBeGreaterThan(0)
    for (const [, , body] of own) expect(body).not.toMatch(/\b(width|height|margin|border|padding)\s*:/)
  })

  it('a tap with the page drawn from older text than the stored one is refused, the box unchanged', async () => {
    const port = fakePort()
    const old = TASKS_PAGE
    const stored = TASKS_PAGE.replace('- [ ] Buy seeds', '- [ ] Buy seeds and bulbs')
    // Drawn from `old`, but the stored text is `stored`.
    const said: string[] = []
    function Page() {
      const host = useRef<HTMLDivElement>(null)
      useTaskTicks(host, PATH, stored, port, (w) => said.push(w))
      useEffect(() => void renderPage(splitFrontmatter(old).body, look, host.current!), [])
      return <div className="reader__body" ref={host} />
    }
    const el = document.createElement('div')
    document.body.append(el)
    root = createRoot(el)
    await act(async () => root!.render(<Page />))
    await act(async () => {})
    const box = [...el.querySelectorAll<HTMLElement>('.page-task')].find((b) => b.dataset.task === '- [ ] Buy seeds')!
    await tap(box)
    expect(port.add).not.toHaveBeenCalled()
    expect(box.dataset.checked).toBe('false')
    expect(said).toEqual([TASK_REFUSED_WORDS.changed])
  })

  it('a tick the send refused: the short line, the box back to the page, the tick discarded', async () => {
    const port = fakePort()
    const p = await page(TASKS_PAGE, port)
    const seeds = p.box('Buy seeds')
    await tap(seeds)
    expect(seeds.dataset.checked).toBe('true')
    await act(async () => port.refuse(port.list[0]!.id))
    expect(p.said).toEqual([TASK_REFUSED_WORDS.changed])
    expect(seeds.dataset.checked).toBe('false')
    expect(port.discard).toHaveBeenCalledWith('t0')
  })

  it('lostReply_alreadyInBranch_clearsThePendingTickOnTheOpenPage: a tick settled with no write (the Mac unticked after it) shows the stored file at once (sweep2 S-D)', async () => {
    const port = fakePort()
    // The stored file: the Mac's state (Buy seeds not done), the same bytes as before the tap.
    const p = await page(TASKS_PAGE, port)
    const seeds = p.box('Buy seeds')
    await tap(seeds)
    expect(seeds.dataset.checked).toBe('true')
    // The retry finds its commit in the branch (W3): the tick leaves the list; nothing is written.
    await act(async () => port.settle(port.list[0]!.id))
    expect(seeds.dataset.checked).toBe('false')
    expect(seeds.getAttribute('aria-checked')).toBe('false')
    expect(p.said).toEqual([])
  })

  it('a waiting tick keeps its state when the page is drawn again before GitHub holds it', async () => {
    const port = fakePort()
    const p = await page(TASKS_PAGE, port)
    await tap(p.box('Water the beans'))
    // The page drawn again from the stored text (the tick not sent yet).
    await act(async () => {
      await renderPage(splitFrontmatter(TASKS_PAGE).body, look, p.body)
      p.paint()
    })
    expect(p.box('Water the beans').dataset.checked).toBe('true')
  })

  it('no list yet (the engine still loading): a short line, nothing changes', async () => {
    const p = await page(TASKS_PAGE, null)
    await tap(p.box('Buy seeds'))
    expect(p.box('Buy seeds').dataset.checked).toBe('false')
    expect(p.said).toEqual(['The phone is still starting. Try again in a moment.'])
  })

  it('the keyboard: Space on a focused box ticks it', async () => {
    const port = fakePort()
    const p = await page(TASKS_PAGE, port)
    const box = p.box('Buy seeds')
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
    expect(box.dataset.checked).toBe('true')
  })
})

/** YAZ-5513: tap the `k`th box the reader drew; the line of the stored page (1-based) that the tick changes, or the refusal. */
async function tapAndWrite(text: string, k = 0): Promise<number | string> {
  const port = fakePort()
  const p = await page(text, port)
  const box = p.boxes()[k]
  if (box === undefined) return 'no box'
  await tap(box)
  if (p.said.length > 0) return p.said.join(' ')
  const out = applyTask(text, port.list[0]!.task!)
  if (out.kind !== 'ticked') return out.kind
  const at = [...text].findIndex((c, i) => c !== out.content[i])
  return text.slice(0, at).split('\n').length
}

describe('a tap ticks the task the reader drew, found with the reader\'s own parser (YAZ-5513)', () => {
  it('a tick finds its task as the renderer does: never a line inside a fence, an indented code block or an HTML block', async () => {
    // T1 (N4): a closing line with an info string does not close the fence; the tap ticks line 7, not the code line 4.
    expect(await tapAndWrite('```\n- [ ] Buy milk\n```js\n- [ ] Buy milk\n```\n\n- [ ] Buy milk\n')).toBe(7)
    // N5: a fence opened on a list item line hides the task-looking code line 2.
    expect(await tapAndWrite('- ```md\n  - [ ] Buy milk\n  ```\n- [ ] Buy milk\n')).toBe(4)
    // N6: a 4-space indented "```" is code, not a fence: the task is line 2, and line 4 is in the real fence below.
    expect(await tapAndWrite('    ```\n- [ ] Buy milk\n```\n- [ ] Buy milk\n```\n')).toBe(2)
    // An indented code block and an HTML block hold task-looking lines; the tap ticks the real task.
    expect(await tapAndWrite('    - [ ] Buy milk\n\n<div>\n- [ ] Buy milk\n</div>\n\n- [ ] Buy milk\n')).toBe(7)
    // With CRLF line ends too.
    expect(await tapAndWrite('```\r\n- [ ] Buy milk\r\n```js\r\n- [ ] Buy milk\r\n```\r\n\r\n- [ ] Buy milk\r\n')).toBe(7)
  })
})

describe('no tap is refused when nothing changed (YAZ-5513, T2)', () => {
  it('a task with a commented-out twin can be ticked', async () => {
    // The same line in an HTML comment, a <div> and a $$ block: no box, so they are no twins of the task.
    for (const twin of ['<!--\n- [ ] Buy milk\n-->', '<div>\n- [ ] Buy milk\n</div>', '$$\n- [ ] Buy milk\n$$']) {
      expect(await tapAndWrite(`# Shop\n\n${twin}\n\n- [ ] Buy milk\n`)).toBe(7)
      act(() => root?.unmount())
    }
  })

  it('a long page drawn in pieces: a box names its own line, so a piece read on its own never shifts which task a tap writes', async () => {
    // A piece cut inside a comment (`renderPage` cuts long pages at blank lines) draws a box for the comment's line;
    // the whole page, as the send reads it, has no task there. The real task is still the one its box names.
    const head = `# Long\n\n<!--\n\n`
    const tail = `- [ ] Buy milk\n\n-->\n\n- [ ] Buy milk\n`
    const text = head + tail
    const port = fakePort()
    const said: string[] = []
    function Page() {
      const host = useRef<HTMLDivElement>(null)
      useTaskTicks(host, PATH, text, port, (w) => said.push(w))
      useEffect(() => {
        host.current!.replaceChildren(renderPiece(head, look, 0), renderPiece(tail, look, head.split('\n').length - 1))
      }, [])
      return <div className="reader__body" ref={host} />
    }
    const el = document.createElement('div')
    document.body.append(el)
    root = createRoot(el)
    await act(async () => root!.render(<Page />))
    await act(async () => {})
    const boxes = [...el.querySelectorAll<HTMLElement>('.page-task[data-task]')]
    expect(boxes).toHaveLength(2)
    // The real task (line 9) ticks.
    await tap(boxes[1]!)
    expect(said).toEqual([])
    expect(port.list.map((c) => c.task)).toEqual([{ core: '- [ ] Buy milk', nth: 0, of: 1, checked: true }])
    const out = applyTask(text, port.list[0]!.task!) as { content: string }
    expect(out.content.split('\n')[8]).toBe('- [x] Buy milk')
    // The comment's line (5) is no task of the page: refused, nothing goes in the list.
    await tap(boxes[0]!)
    expect(said).toEqual([TASK_REFUSED_WORDS.changed])
    expect(port.list).toHaveLength(1)
  })
})

describe('the boxes are the Mac\'s tasks (YAZ-5513, T3)', () => {
  it('only tasks the Mac reads as tasks get a tappable box', async () => {
    // CommonMark: a list that does not start at 1 cannot interrupt a paragraph, so `2) [ ] X` is the paragraph's text.
    // As the Mac reads it (micromark), not after indented code either. Their brackets stay text, as on the Mac.
    for (const page of ['- parent\n  2) [ ] Buy milk\n', 'Paragraph\n> 2) [ ] Buy milk\n', '    code\n\n2) [ ] Buy milk\n3) [x] Buy milk\n']) {
      const p = await page2(page)
      expect(p.boxes()).toHaveLength(0)
      expect(p.body.textContent).toContain('[ ] Buy milk')
      act(() => root?.unmount())
    }
    // The Mac's tasks keep theirs: a list at 1, a bullet list, one after a blank line.
    for (const [page, n] of [['- parent\n  1) [ ] Buy milk\n', 1], ['- parent\n  - [ ] Buy milk\n', 1], ['Paragraph\n\n2) [ ] Buy milk\n', 1], ['﻿- [ ] Buy milk\n', 1]] as const) {
      const p = await page2(page)
      expect(p.boxes().filter((b) => b.dataset.task !== undefined)).toHaveLength(n)
      act(() => root?.unmount())
    }
  })
})

/** A page drawn with the tap on, and no list. */
const page2 = (text: string) => page(text, fakePort())
