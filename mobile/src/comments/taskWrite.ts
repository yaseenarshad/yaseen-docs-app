import { splitFrontmatter } from '@shared/frontmatter'

/**
 * YAZ-5494: THE PHONE'S SECOND WRITE TO A PAGE: it ticks or unticks ONE task check box, and changes no other byte.
 *
 * A task is a list item whose first line starts with a box, as the Mac's Markdown (GitHub flavour) reads it: `- [ ]`,
 * `* [ ]`, `+ [ ]`, `1. [ ]`, `1) [ ]`, at any depth, in a quote too (`> - [ ]`). `[x]` and `[X]` are done. The Mac
 * writes a done box `[x]` (remark's `listItem`; `cellLists.ts` writes `[X]` back as `[x]` too), so a tick writes `x`
 * and an untick writes a space: ONE byte, the one between the brackets. The line ends (LF or CRLF), the spacing, the
 * marker and the text stay as they are.
 *
 * FINDING THE SAME TASK AGAIN: a tap names the task by its LINE (`core`: the line from its marker on, its box read as
 * `[ ]`, with no indent or quote marks before it) and its place among the lines that read the same (`nth` of `of`), in
 * document order. On the fresh page the task is the `nth` line of the same text, when the page still has `of` of them:
 * so a line added or removed elsewhere changes nothing, and a task whose text changed, that is gone, or that now has a
 * twin (or lost one) is refused, and nothing is written.
 *
 * IDEMPOTENT: an entry says what the box must BECOME (`checked`), not "toggle". A retry whose first try reached GitHub
 * finds the box already so, and writes nothing (`already`): never a double toggle. A tick then an untick are two
 * entries, applied in order. Pure: no React, no store, no network.
 */

export interface TaskTick {
  /** The task's line from its marker on, its box as `[ ]` (`taskCore`). */
  core: string
  /** Its place among the lines with the same `core` (0-based), and how many there were. */
  nth: number
  of: number
  /** What the box becomes. */
  checked: boolean
}

export type TaskRefusedWhy = 'changed' | 'gone'

export type TaskResult = { kind: 'ticked'; content: string } | { kind: 'already' } | { kind: 'refused'; why: TaskRefusedWhy }

/** The plain words of a refusal: what the person reads on the page. Nothing was written. */
export const TASK_REFUSED_WORDS: Record<TaskRefusedWhy, string> = {
  changed: 'This task changed on the Mac, so the phone did not tick it. Nothing was changed.',
  gone: 'This page is no longer on the phone, so the task was not ticked. Nothing was changed.',
}

/** A task line: the quote marks and indent before it, then the marker, the space, the box, a space and the rest (`marked`'s `listIsTask`). */
const TASK = /^((?:[ \t]*>)*[ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\]( .*)$/
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/

export interface TaskLine {
  /** Where the box's mark (the byte between the brackets) is, in the line. */
  box: number
  checked: boolean
  core: string
}

/** `line` (no line end) as a task line, or `null`. */
export function taskLine(line: string): TaskLine | null {
  const m = TASK.exec(line)
  if (m === null) return null
  const box = m[1]!.length + m[2]!.length + 1
  return { box, checked: m[3] !== ' ', core: `${m[2]}[ ]${m[4]}` }
}

/** The core of a task's first line (`- [x] Buy milk` → `- [ ] Buy milk`), or `null` when it is no task line. */
export const taskCore = (line: string): string | null => taskLine(line.replace(/\r$/, ''))?.core ?? null

/** Each task line of a page's text (after its front matter, outside code fences): where its box's mark is, and its core. */
export function taskLines(content: string): Array<TaskLine & { at: number }> {
  const { frontmatter } = splitFrontmatter(content)
  const out: Array<TaskLine & { at: number }> = []
  let fence: string | null = null
  let start = frontmatter.length
  while (start <= content.length) {
    const nl = content.indexOf('\n', start)
    const end = nl === -1 ? content.length : nl
    const line = content.slice(start, end).replace(/\r$/, '')
    const f = FENCE.exec(line)
    if (f !== null) {
      if (fence === null) fence = f[1]!
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null
    } else if (fence === null) {
      const task = taskLine(line)
      if (task !== null) out.push({ ...task, at: start + task.box })
    }
    if (nl === -1) break
    start = nl + 1
  }
  return out
}

/** The tick of the `nth` task with `core` in `content` (`of` of them), to `checked`. */
export function tickOf(content: string, core: string, nth: number, checked: boolean): TaskTick {
  return { core, nth, of: taskLines(content).filter((t) => t.core === core).length, checked }
}

/** `content` with the task's box set to `tick.checked`, or `already`, or why not (`changed`: not found the same). */
export function applyTask(content: string, tick: TaskTick): TaskResult {
  const same = taskLines(content).filter((t) => t.core === tick.core)
  const task = same.length === tick.of ? same[tick.nth] : undefined
  if (task === undefined) return { kind: 'refused', why: 'changed' }
  if (task.checked === tick.checked) return { kind: 'already' }
  return { kind: 'ticked', content: `${content.slice(0, task.at)}${tick.checked ? 'x' : ' '}${content.slice(task.at + 1)}` }
}
