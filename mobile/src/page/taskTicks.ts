import { useEffect, useRef, type RefObject } from 'react'
import type { CommentsPort } from '../comments/bridge'
import type { WaitingComment } from '../comments/outbox'
import { TASK_REFUSED_WORDS, taskLines, type TaskTick } from '../comments/taskWrite'

/**
 * TICK A TASK FROM THE PHONE (YAZ-5494): a tap on a task's check box in a page ticks it, or unticks it. Only that
 * changes in the file: one byte (`comments/taskWrite.ts`). The write takes the comments' safe path (YAZ-5461): the
 * comment list (IndexedDB, kept with no signal), the send (the fresh page, the same task found again, one commit with
 * compare-and-swap, again on the newest page after a race), and the status dot counts it. Nothing asks "Allow edits?".
 *
 * The box shows its new state AT ONCE (the reader's own look: a done task is struck through and dimmed, as on the Mac),
 * and keeps it while the tick waits, also when the page is drawn again before GitHub holds it (`paint`). A task the
 * fresh page no longer has the same is refused: a short line on the page says so, the box shows the page's own state,
 * and nothing was written.
 *
 * WHERE: a box the page renderer drew with its line (`data-task`, its core, and `data-task-line`, its line in the
 * body; `pageRender.ts`): a task of the page's own text, in a list, a nested list or a quote, as the reader's parser
 * reads it (`pageMarked.ts`, YAZ-5513). The tap finds the task on THAT line of the stored page with the same parser,
 * so the line it writes is the box's own, never a line of code or HTML that reads the same. A card's box (a card block in the page, an embedded card, Review) is the Mac's
 * card look, a glyph that the Mac does not tick either: it has no `data-task`, so it is never a control. The tap area
 * is 44 px around the box (`reader.css`); the box's look does not change.
 *
 * THE HOLD (YAZ-5522 N11): a tick waits `TICK_HOLD_MS` before its send, and the ticks tapped in that time join it (one
 * commit, `sender.ts`). A tap that undoes a tick not sent yet (tick, then untick, of the same box) takes that tick out
 * of the list: nothing is written. The box shows the tap's state at once either way. The hold never loses a tick: it is
 * in IndexedDB from the tap, and it goes at once when the page closes (`flushTicks`), the app goes to the background or
 * is closed (`followAnswers`), or a sync begins (`sender.ts`).
 */
export const TICK_HOLD_MS = 3000

const BOX = '.page-task[data-task][data-task-line]'

/** The task of `text` that a tick names: the `nth` with its core (`taskLines`: the reader's parse). */
const taskOf = (text: string, tick: Pick<TaskTick, 'core' | 'nth'>) => taskLines(text).filter((l) => l.core === tick.core)[tick.nth]

/** The box of the tick's task in `host`, drawn from `text`: the box on that task's line. */
function boxOf(host: HTMLElement, text: string, tick: Pick<TaskTick, 'core' | 'nth'>): HTMLElement | null {
  const task = taskOf(text, tick)
  if (task === undefined) return null
  return [...host.querySelectorAll<HTMLElement>(BOX)].find((b) => b.dataset.taskLine === String(task.line) && b.dataset.task === task.core) ?? null
}

/**
 * YAZ-5513: the tick of a tapped box, from the stored page `text`: the box names its line (`data-task-line`) and its
 * core, both from the reader's parse; the task on that line of `text`, found by the same parse, is the one, and its
 * place among the tasks that read the same is how the send finds it again on the fresh page. Null when `text` has no
 * such task on that line (the page was drawn from other text): nothing is written.
 */
export function tickOfBox(text: string, box: HTMLElement, checked: boolean): TaskTick | null {
  const core = box.dataset.task
  const same = taskLines(text).filter((l) => l.core === core)
  const nth = same.findIndex((l) => String(l.line) === box.dataset.taskLine)
  return core === undefined || nth < 0 ? null : { core, nth, of: same.length, checked }
}

/** The box shows `checked` (the reader's look reads `data-checked`), and says so. */
export function showBox(box: HTMLElement, checked: boolean): void {
  box.dataset.checked = String(checked)
  box.setAttribute('aria-checked', String(checked))
  box.setAttribute('aria-label', checked ? 'Done' : 'Not done')
}

/** Each box with its line becomes a check box for a screen reader and the keyboard. */
function controls(host: HTMLElement): void {
  for (const box of host.querySelectorAll<HTMLElement>(`${BOX}:not([tabindex])`)) {
    box.setAttribute('role', 'checkbox')
    box.setAttribute('tabindex', '0')
    box.setAttribute('aria-checked', box.dataset.checked === 'true' ? 'true' : 'false')
  }
}

export interface TaskTicks {
  /**
   * After a draw, or a read of the stored file that found the same text: the boxes become controls, each shows what
   * the text says (YAZ-5521), and the ticks still waiting show their state over it.
   */
  paint(): void
}

/**
 * The ticks of the page `path` drawn in `host`, from its stored `text` (front matter and all). `port` is the comment
 * list (null until the engine has loaded); `say` shows a short line on the page.
 */
export function useTaskTicks(
  host: RefObject<HTMLElement | null>,
  path: string,
  text: string | null | undefined,
  port: CommentsPort | null,
  say: (words: string) => void,
  /**
   * YAZ-5521 (sweep2 S-D): a tick of this page left the list with no refusal (written, or found done already after a
   * lost reply, W3): the page reads its stored file again and paints (`paint`) or draws from it. A tick settled with no
   * write (the Mac unticked after it) changes no byte, so no sync event redraws the page: its box kept the tap's state.
   */
  onSettled?: () => void,
): TaskTicks {
  const latest = useRef({ path, text, port, say, onSettled })
  latest.current = { path, text, port, say, onSettled }

  const paint = () => {
    const el = host.current
    const { port: p, path: at, text: t } = latest.current
    if (el === null) return
    controls(el)
    // Each box as the text says (YAZ-5521: a tick that settled leaves no tap state behind), then the waiting ticks.
    if (typeof t === 'string') {
      const lines = new Map(taskLines(t).map((l) => [`${l.line}\u0000${l.core}`, l.checked]))
      for (const box of el.querySelectorAll<HTMLElement>(BOX)) {
        const own = lines.get(`${box.dataset.taskLine}\u0000${box.dataset.task}`)
        if (own !== undefined && (box.dataset.checked === 'true') !== own) showBox(box, own)
      }
    }
    for (const c of p?.waiting(at) ?? []) if (c.task !== undefined && c.refused === undefined) {
      const box = typeof latest.current.text === 'string' ? boxOf(el, latest.current.text, c.task) : null
      if (box !== null) showBox(box, c.task.checked)
    }
  }

  // A refused tick: the short line, the box back to the page's own state, and the tick leaves the list.
  // YAZ-5521: a tick that leaves the list unrefused (settled): the page reads its stored file again.
  useEffect(() => {
    if (port === null) return
    let ticked = new Set<string>()
    const refused = () => {
      const { path: at, text: t, say: tell } = latest.current
      const now = new Set(port.waiting(at).filter((c) => c.task !== undefined && c.refused === undefined).map((c) => c.id))
      const settled = [...ticked].some((id) => !now.has(id) && !port.waiting(at).some((c) => c.id === id))
      ticked = now
      const gone = port.waiting(at).filter((c): c is WaitingComment & { task: TaskTick } => c.task !== undefined && c.refused !== undefined)
      for (const c of gone) {
        tell(c.refused === 'changed' ? TASK_REFUSED_WORDS.changed : TASK_REFUSED_WORDS.gone)
        void port.discard(c.id)
        const box = host.current === null || typeof t !== 'string' ? null : boxOf(host.current, t, c.task)
        const own = typeof t === 'string' ? taskOf(t, c.task) : undefined
        if (box !== null && own !== undefined) showBox(box, own.checked)
      }
      paint()
      if (settled) latest.current.onSettled?.()
    }
    refused()
    return port.subscribe(refused)
  }, [port, host])

  useEffect(() => {
    const el = host.current
    if (el === null) return
    const tap = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== ' ' && event.key !== 'Enter') return
      const box = (event.target as Element | null)?.closest?.(BOX)
      if (!(box instanceof HTMLElement) || !el.contains(box)) return
      event.preventDefault()
      event.stopPropagation()
      const { port: p, path: at, text: t, say: tell } = latest.current
      if (p === null || typeof t !== 'string') return tell('The phone is still starting. Try again in a moment.')
      // The stored page must hold the task on the box's line, found by the reader's parse: else nothing goes in the list.
      const tick = tickOfBox(t, box, box.dataset.checked !== 'true')
      if (tick === null) return tell(TASK_REFUSED_WORDS.changed)
      showBox(box, tick.checked)
      // YAZ-5522 N11: the opposite tick of this box, not tried yet: out of the list, and nothing is written.
      const undone = p.waiting(at).find((c) => c.task !== undefined && c.refused === undefined && c.tried !== true && c.task.core === tick.core && c.task.nth === tick.nth && c.task.checked !== tick.checked)
      const add = () => p.add({ path: at, body: '', task: tick, holdMs: TICK_HOLD_MS })
      void (undone === undefined ? add() : p.undo(undone.id).then((gone) => (gone ? undefined : add()))).catch(() => {
        showBox(box, !tick.checked)
        tell('The phone could not save the tick. Nothing was changed.')
      })
    }
    el.addEventListener('click', tap, true)
    el.addEventListener('keydown', tap, true)
    return () => {
      el.removeEventListener('click', tap, true)
      el.removeEventListener('keydown', tap, true)
    }
  }, [host])

  // YAZ-5522 N11: the page closes (or another page opens here): its held ticks go now.
  useEffect(() => () => void latest.current.port?.flushTicks?.().catch(() => {}), [path])

  return { paint }
}
