import { splitFrontmatter } from '@shared/frontmatter'
import { pageTasks, readTaskLine, withoutBom } from '../page/pageMarked'

/**
 * YAZ-5494: THE PHONE'S SECOND WRITE TO A PAGE: it ticks or unticks ONE task check box, and changes no other byte.
 *
 * A task is a list item whose first line starts with a box, as the Mac's Markdown (GitHub flavour) reads it: `- [ ]`,
 * `* [ ]`, `+ [ ]`, `1. [ ]`, `1) [ ]`, at any depth, in a quote too (`> - [ ]`). YAZ-5513: the tasks of a page are
 * found by THE READER'S PARSER (`page/pageMarked.ts`, `pageTasks`), the one that draws the boxes, with the line of each:
 * so the box a person taps is the line a tick writes, and a line in a code fence, an indented code block, an HTML block
 * or a card block is never a task (no second reading of the text by a regex). `[x]` and `[X]` are done. The Mac
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

export interface TaskLine {
  /** Where the box's mark (the byte between the brackets) is, in the line. */
  box: number
  checked: boolean
  core: string
}

/** `line` (no line end) as a task line, or `null`. */
export const taskLine = (line: string): TaskLine | null => readTaskLine(line)

/** The core of a task's first line (`- [x] Buy milk` → `- [ ] Buy milk`), or `null` when it is no task line. */
export const taskCore = (line: string): string | null => taskLine(line.replace(/\r$/, ''))?.core ?? null

/**
 * Each task of a page's text (front matter and all), as the reader draws its boxes (`pageTasks` on the body): where its
 * box's mark is in `content` (`at`), its line in the body (`line`, 0-based: the box's `data-task-line`), its state and
 * its core. In document order.
 */
export function taskLines(content: string): Array<TaskLine & { at: number; line: number }> {
  // The last page read (a tap, its paint, the send read the same page in a row; a long page is a full parse each).
  if (last?.content === content) return last.tasks
  const tasks = readTasks(content)
  last = { content, tasks }
  return tasks
}

let last: { content: string; tasks: Array<TaskLine & { at: number; line: number }> } | null = null

function readTasks(content: string): Array<TaskLine & { at: number; line: number }> {
  const { frontmatter, body } = splitFrontmatter(content)
  // Where each line of the body starts in `content` (a line ends at LF, CRLF or CR, as the parser reads it).
  const own = withoutBom(body)
  const starts = [frontmatter.length + body.length - own.length]
  for (const m of own.matchAll(/\r\n|\r|\n/g)) starts.push(frontmatter.length + body.length - own.length + m.index + m[0].length)
  return pageTasks(body).map((t) => ({ box: t.box, checked: t.checked, core: t.core, line: t.line, at: starts[t.line]! + t.box }))
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
