import { describe, expect, it } from 'vitest'
import { TASKS_PAGE } from '../dev/taskFixtures'
import { applyTask, taskCore, taskLine, taskLines, tickOf, type TaskTick } from './taskWrite'

/** YAZ-5494: one box, one byte; the same task found again on the fresh page, or refused. */
const tick = (content: string, line: string, checked: boolean, nth = 0): TaskTick => tickOf(content, taskCore(line)!, nth, checked)
const ticked = (content: string, t: TaskTick) => {
  const out = applyTask(content, t)
  if (out.kind !== 'ticked') throw new Error(`not ticked: ${JSON.stringify(out)}`)
  return out.content
}
/** The bytes that differ between `a` and `b` (same length). */
const diff = (a: string, b: string) => [...a].flatMap((c, i) => (c === b[i] ? [] : [[i, c, b[i]]]))

describe('the task line, as the Mac reads it', () => {
  it('reads -, *, + and ordered markers, [ ], [x] and [X], with the indent and quote marks before it', () => {
    expect(taskLine('- [ ] Buy seeds')).toEqual({ box: 3, checked: false, core: '- [ ] Buy seeds' })
    expect(taskLine('  - [X] Empty the box')).toEqual({ box: 5, checked: true, core: '- [ ] Empty the box' })
    expect(taskLine('> - [x] Return the drill')).toEqual({ box: 5, checked: true, core: '- [ ] Return the drill' })
    expect(taskLine('12) [ ] Twelve')?.core).toBe('12) [ ] Twelve')
    expect(taskLine('1.  [ ] Two spaces')?.box).toBe(5)
    for (const no of ['- [ ]', '-[ ] x', '- [y] x', '- [ ]x', 'text - [ ] x', '| - [ ] x |', '- [ x] y']) expect(taskLine(no)).toBeNull()
  })

  it('finds the tasks of a page: not in the front matter, not in a code fence', () => {
    const lines = taskLines(TASKS_PAGE)
    expect(lines.map((l) => l.core)).toEqual([
      '- [ ] Buy seeds',
      '- [ ] Mow the lawn',
      '- [ ] Sharpen the blade',
      '- [ ] Empty the box',
      '* [ ] Call Sam about the fence',
      '+ [ ] Water the beans',
      '1. [ ] Sweep the shed',
      '2) [ ] Oil the hinges',
      '- [ ] Ask Ana for the ladder',
      '- [ ] Return the drill',
      '- [ ] Water the beans',
      // Not the card block's `- [ ] Beans` (a card is a fence: its box is the card's), nor the code fence's.
    ])
    expect(lines.every((l) => TASKS_PAGE[l.at - 1] === '[' && TASKS_PAGE[l.at + 1] === ']')).toBe(true)
  })
})

describe('a tick changes one byte, nothing else (YAZ-5494)', () => {
  it('LF: tick and untick, - * + and ordered, nested and indented, in a quote; [X] unticks to a space', () => {
    const cases: Array<[string, boolean, string]> = [
      ['- [ ] Buy seeds', true, 'x'],
      ['- [x] Mow the lawn', false, ' '],
      ['  - [ ] Sharpen the blade', true, 'x'],
      ['  - [X] Empty the box', false, ' '],
      ['* [ ] Call Sam about the fence', true, 'x'],
      ['1. [ ] Sweep the shed', true, 'x'],
      ['2) [x] Oil the hinges', false, ' '],
      ['> - [ ] Ask Ana for the ladder', true, 'x'],
      ['> - [x] Return the drill', false, ' '],
    ]
    for (const [line, checked, mark] of cases) {
      const out = ticked(TASKS_PAGE, tick(TASKS_PAGE, line, checked))
      expect(out.length).toBe(TASKS_PAGE.length)
      const at = TASKS_PAGE.indexOf(line) + line.indexOf('[') + 1
      expect(diff(TASKS_PAGE, out)).toEqual([[at, TASKS_PAGE[at], mark]])
    }
  })

  it('CRLF: the line ends stay CRLF, the one byte changes', () => {
    const crlf = TASKS_PAGE.replace(/\n/g, '\r\n')
    const out = ticked(crlf, tick(crlf, '+ [ ] Water the beans', true))
    expect(diff(crlf, out)).toHaveLength(1)
    expect(out.split('\r\n').length).toBe(crlf.split('\r\n').length)
    expect(out).toContain('+ [x] Water the beans\r\n')
  })

  it('a done box is written [x], as the Mac writes it; a page with no line end at its end keeps none', () => {
    expect(ticked('- [ ] a', tick('- [ ] a', '- [ ] a', true))).toBe('- [x] a')
    expect(ticked('- [X] a\n', tick('- [X] a\n', '- [X] a', false))).toBe('- [ ] a\n')
  })

  it('two tasks that read the same: the tap names which (the 2nd), and only it changes', () => {
    const second = tick(TASKS_PAGE, '- [ ] Water the beans', true, 0)
    // `+ [ ]` and `- [ ]` are not the same line: the `-` one is alone.
    expect(second.of).toBe(1)
    const twins = 'a\n- [ ] Same\nb\n- [ ] Same\n'
    const out = ticked(twins, tick(twins, '- [ ] Same', true, 1))
    expect(out).toBe('a\n- [ ] Same\nb\n- [x] Same\n')
  })
})

describe('the same task found again, or refused', () => {
  it('lines added and removed elsewhere change nothing: the same task is found', () => {
    const t = tick(TASKS_PAGE, '* [ ] Call Sam about the fence', true)
    const moved = TASKS_PAGE.replace('# Weekend jobs\n', '# Weekend jobs\n\nA new line from the Mac.\n- [ ] A new task\n').replace('The end.\n', '')
    const out = ticked(moved, t)
    expect(diff(moved, out)).toHaveLength(1)
    expect(out).toContain('* [x] Call Sam about the fence')
  })

  it('refused when its text changed, it is gone, or the tapped twin is gone: nothing written', () => {
    const t = tick(TASKS_PAGE, '- [ ] Buy seeds', true)
    expect(applyTask(TASKS_PAGE.replace('Buy seeds', 'Buy seeds and bulbs'), t)).toEqual({ kind: 'refused', why: 'changed' })
    expect(applyTask(TASKS_PAGE.replace('- [ ] Buy seeds\n', ''), t)).toEqual({ kind: 'refused', why: 'changed' })
    // YAZ-5570: a twin the Mac added elsewhere no longer refuses it: the tapped task is found by the lines around it.
    const twin = TASKS_PAGE.replace('The end.', '- [ ] Buy seeds')
    expect(ticked(twin, t)).toBe(twin.replace('- [ ] Buy seeds\n- [x] Mow', '- [x] Buy seeds\n- [x] Mow'))
    const twins = 'a\n- [ ] Same\nb\n- [ ] Same\n'
    expect(applyTask('a\n- [ ] Same\n', tick(twins, '- [ ] Same', true, 1))).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('idempotent: a box already as the tick wants is `already` (a retry after GitHub took it): no double toggle', () => {
    const t = tick(TASKS_PAGE, '- [ ] Buy seeds', true)
    const once = ticked(TASKS_PAGE, t)
    expect(applyTask(once, t)).toEqual({ kind: 'already' })
    // Ticked on the Mac too: nothing to write.
    expect(applyTask(TASKS_PAGE.replace('- [ ] Buy seeds', '- [X] Buy seeds'), t)).toEqual({ kind: 'already' })
    // A tick then an untick: the page ends as it began.
    expect(ticked(once, { ...t, checked: false })).toBe(TASKS_PAGE)
  })

  it('a task in a code fence is never found (a fence is text)', () => {
    expect(applyTask(TASKS_PAGE, { core: '- [ ] not a task, code', nth: 0, of: 1, checked: true })).toEqual({ kind: 'refused', why: 'changed' })
  })
})
