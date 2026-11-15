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
import { renderPage, type PageLook } from './pageRender'
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
  const port: CommentsPort & { list: WaitingComment[]; refuse(id: string): void } = {
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
    const ticks = useTaskTicks(host, PATH, text, port, (w) => {
      said.push(w)
      setNotice(w)
    })
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
