import { useEffect, useRef, type RefObject } from 'react'
import type { CommentsPort } from '../comments/bridge'
import type { WaitingComment } from '../comments/outbox'
import { TASK_REFUSED_WORDS, applyTask, taskLines, type TaskTick } from '../comments/taskWrite'

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
 * WHERE: a box the page renderer drew with its line (`data-task`, `pageRender.ts`): a task of the page's own text, in
 * a list, a nested list or a quote. A card's box (a card block in the page, an embedded card, Review) is the Mac's
 * card look, a glyph that the Mac does not tick either: it has no `data-task`, so it is never a control. The tap area
 * is 44 px around the box (`reader.css`); the box's look does not change.
 */

const BOX = '.page-task[data-task]'

/** The box of the tick's task in `host`: the `nth` box with its line. */
function boxOf(host: HTMLElement, tick: Pick<TaskTick, 'core' | 'nth'>): HTMLElement | null {
  return [...host.querySelectorAll<HTMLElement>(BOX)].filter((b) => b.dataset.task === tick.core)[tick.nth] ?? null
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
  /** After a draw: the boxes become controls, and the ticks still waiting show their state. */
  paint(): void
}

/**
 * The ticks of the page `path` drawn in `host`, from its stored `text` (front matter and all). `port` is the comment
 * list (null until the engine has loaded); `say` shows a short line on the page.
 */
export function useTaskTicks(host: RefObject<HTMLElement | null>, path: string, text: string | null | undefined, port: CommentsPort | null, say: (words: string) => void): TaskTicks {
  const latest = useRef({ path, text, port, say })
  latest.current = { path, text, port, say }

  const paint = () => {
    const el = host.current
    const { port: p, path: at } = latest.current
    if (el === null) return
    controls(el)
    for (const c of p?.waiting(at) ?? []) if (c.task !== undefined && c.refused === undefined) {
      const box = boxOf(el, c.task)
      if (box !== null) showBox(box, c.task.checked)
    }
  }

  // A refused tick: the short line, the box back to the page's own state, and the tick leaves the list.
  useEffect(() => {
    if (port === null) return
    const refused = () => {
      const { path: at, text: t, say: tell } = latest.current
      const gone = port.waiting(at).filter((c): c is WaitingComment & { task: TaskTick } => c.task !== undefined && c.refused !== undefined)
      for (const c of gone) {
        tell(c.refused === 'changed' ? TASK_REFUSED_WORDS.changed : TASK_REFUSED_WORDS.gone)
        void port.discard(c.id)
        const box = host.current === null ? null : boxOf(host.current, c.task)
        const own = typeof t === 'string' ? taskLines(t).filter((l) => l.core === c.task.core)[c.task.nth] : undefined
        if (box !== null && own !== undefined) showBox(box, own.checked)
      }
      paint()
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
      const core = box.dataset.task!
      const same = [...el.querySelectorAll<HTMLElement>(BOX)].filter((b) => b.dataset.task === core)
      const tick: TaskTick = { core, nth: same.indexOf(box), of: same.length, checked: box.dataset.checked !== 'true' }
      // The stored page must hold the same task (the same line, as many of them): else nothing goes in the list.
      if (applyTask(t, tick).kind === 'refused') return tell(TASK_REFUSED_WORDS.changed)
      showBox(box, tick.checked)
      void p.add({ path: at, body: '', task: tick }).catch(() => {
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

  return { paint }
}
