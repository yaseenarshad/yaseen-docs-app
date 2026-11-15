/**
 * YAZ-5494: a made-up page of tasks in every shape the Mac reads (`- [ ]`, `* [ ]`, `+ [ ]`, `1. [ ]`, `2) [x]`,
 * `[X]`, nested and indented, in a quote), with a card block whose boxes stay the card's, a code fence whose boxes are
 * text, and two tasks that read the same. For the tests (`comments/taskWrite.test.ts`, `page/taskTicks.test.tsx`) and
 * the screen fixture `page-tasks` (`readerFixtures.tsx`).
 */
export const TASKS_PAGE = [
  '---',
  'title: Weekend jobs',
  'tags: [home,garden]',
  '---',
  '# Weekend jobs',
  '',
  '- [ ] Buy seeds',
  '- [x] Mow the lawn',
  '  - [ ] Sharpen the blade',
  '  - [X] Empty the box',
  '* [ ] Call Sam about the fence',
  '+ [ ] Water the beans',
  '',
  '1. [ ] Sweep the shed',
  '2) [x] Oil the hinges',
  '',
  '> - [ ] Ask Ana for the ladder',
  '> - [x] Return the drill',
  '',
  '- [ ] Water the beans',
  '',
  '```card',
  'Q: What needs the most water?',
  '- [ ] Beans',
  '```',
  '',
  '```',
  '- [ ] not a task, code',
  '```',
  '',
  'The end.',
  '',
].join('\n')

/**
 * YAZ-5510: numbered tasks, one and two digits (`1.`, `2.`, `10.`, `11.`), one done, one that wraps: the number, then
 * the box, then the text. For `page/numberedTasks.test.ts` and the screen fixture `page-tasks-numbered`.
 */
export const NUMBERED_TASKS_PAGE = [
  '---',
  'title: Shed list',
  '---',
  '# Shed list',
  '',
  '1. [ ] Sweep the shed',
  '2. [x] Oil the hinges',
  '',
  'Later:',
  '',
  '10. [ ] Paint the gate, two coats on both sides, and let it dry before the rain comes back',
  '11. [ ] Fix the latch',
  '',
].join('\n')
