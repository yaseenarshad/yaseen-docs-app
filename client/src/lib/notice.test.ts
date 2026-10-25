/** How long the toast stays (YAZ-3255 D11): a fading action toast goes after `UNDO_NOTICE_MS`; another action toast stays. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { countKinds, dragOutText, gestureNotice, LINK_NOTICE_MS, namedItems, NAMES_SHOWN, noticeMs, onDisk, shows, UNDO_NOTICE_MS, unlessFailed, type Notice } from './notice'

describe('noticeMs (YAZ-3255 D11)', () => {
  it('a plain notice fades after LINK_NOTICE_MS; an Undo or Redo toast after UNDO_NOTICE_MS (6 s); another action toast stays', () => {
    const run = () => undefined
    expect(UNDO_NOTICE_MS).toBe(6000)
    expect(noticeMs({ text: 'Copied path', icon: 'info' })).toBe(LINK_NOTICE_MS)
    expect(noticeMs({ text: 'Moved 1 item', icon: 'paste', action: { label: 'Undo', run, fades: true } })).toBe(UNDO_NOTICE_MS)
    expect(noticeMs({ text: 'Merged', icon: 'info', action: { label: 'See changes', run } })).toBeNull()
  })
})

describe('Settings › Notifications (YAZ-3303)', () => {
  const run = () => undefined
  const plain: Notice = { text: 'Copied path', icon: 'info' }
  const undo: Notice = { text: 'Moved 1 file (a.md)', icon: 'paste', action: { label: 'Undo', run, fades: true } }
  const merged: Notice = { text: 'Merged', icon: 'info', action: { label: 'See changes', run } }

  it('D5: Show for sets the length; a toast with Undo stays at least 6 s; "Until closed" and "See changes" stay (S4 to S9)', () => {
    expect([noticeMs(plain, '4s'), noticeMs(plain, '8s'), noticeMs(plain, '15s'), noticeMs(plain, 'closed')]).toEqual([LINK_NOTICE_MS, 8000, 15000, null])
    expect([noticeMs(undo, '4s'), noticeMs(undo, '8s'), noticeMs(undo, '15s'), noticeMs(undo, 'closed')]).toEqual([UNDO_NOTICE_MS, 8000, 15000, null])
    for (const length of ['4s', '8s', '15s', 'closed'] as const) expect(noticeMs(merged, length)).toBeNull()
  })

  it('D2: a typed toast shows only while its switch is not Off; an untyped toast always shows; a state without the field shows it', () => {
    const off = { ...DEFAULT_SETTINGS, noticeUndo: false, noticeClipboard: false, noticeLists: false }
    for (const type of ['undo', 'clipboard', 'lists'] as const) {
      expect(shows({ ...plain, type }, DEFAULT_SETTINGS)).toBe(true)
      expect(shows({ ...plain, type }, off)).toBe(false)
    }
    expect(shows({ text: "Can't copy path: denied", icon: 'info' }, off)).toBe(true)
    const { noticeClipboard: _gone, ...older } = DEFAULT_SETTINGS
    expect(shows({ ...plain, type: 'clipboard' }, older as typeof DEFAULT_SETTINGS)).toBe(true)
  })

  it('D2: a gesture that failed for an item has no type, so its skip always shows (S16, S18)', () => {
    expect(unlessFailed('undo', [])).toBe('undo')
    expect(unlessFailed('clipboard', ['Plan — already exists'])).toBeUndefined()
  })
})

describe('gestureNotice (audit 9): the one sentence of a gesture over many items', () => {
  it('says what landed, then how many did not and the first of them; with nothing landed, the failure alone; null when nothing ran', () => {
    expect(gestureNotice('Moved 2 items', [], "Can't move")).toBe('Moved 2 items')
    expect(gestureNotice('Moved 2 items', ['Plan already exists', 'Trip — gone'], "Can't move")).toBe('Moved 2 items, skipped 2: Plan already exists')
    expect(gestureNotice(null, ['Note — gone'], "Couldn't paste")).toBe("Couldn't paste: Note — gone")
    expect(gestureNotice(null, ['Note — gone', 'Plan — gone'], "Can't undo")).toBe("Can't undo 2 items: Note — gone")
    expect(gestureNotice(null, [], "Can't move")).toBeNull()
  })
})

describe('namedItems (YAZ-3274 D22, YAZ-3293 D23): the items of a gesture by kind, then by name on disk', () => {
  const file = (name: string) => ({ name, kind: 'file' as const })
  const folder = (name: string) => ({ name, kind: 'dir' as const })

  it('1 folder says "1 folder" and its name (S76); notes say "files" with the extension (S77)', () => {
    expect(NAMES_SHOWN).toBe(3)
    expect(namedItems([folder('Projects')])).toBe('1 folder (Projects)')
    expect(namedItems([file('Todo.md')])).toBe('1 file (Todo.md)')
    expect(namedItems([file('Todo.md'), file('Plan.md')])).toBe('2 files (Todo.md, Plan.md)')
    expect(namedItems([folder('Projects'), folder('Trips')])).toBe('2 folders (Projects, Trips)')
  })

  it('a mix says the folders first, then the files; the names keep the order of the gesture (S78)', () => {
    expect(namedItems([folder('Projects'), file('Todo.md'), file('Plan.md')])).toBe('1 folder and 2 files (Projects, Todo.md, Plan.md)')
    expect(namedItems([file('Todo.md'), folder('Projects')])).toBe('1 folder and 1 file (Todo.md, Projects)')
    expect(namedItems([folder('A'), folder('B'), file('c.md')])).toBe('2 folders and 1 file (A, B, c.md)')
  })

  it('more than 3 name the first 3, then how many more (S79)', () => {
    const twelve = 'abcdefghijkl'.split('').map((letter) => file(`${letter}.md`))
    expect(namedItems(twelve)).toBe('12 files (a.md, b.md, c.md + 9 more)')
    expect(namedItems([file('Todo.md'), file('Plan.md'), folder('Budget'), file('Trip.md')])).toBe('1 folder and 3 files (Todo.md, Plan.md, Budget + 1 more)')
  })

  it('countKinds is the kinds alone, as the menu labels and the Cut and Copy toasts say them', () => {
    expect(countKinds([{ kind: 'file' }, { kind: 'file' }])).toBe('2 files')
    expect(countKinds([{ kind: 'dir' }, { kind: 'file' }, { kind: 'file' }])).toBe('1 folder and 2 files')
    expect(countKinds([{ kind: 'dir' }])).toBe('1 folder')
  })

  it('onDisk names an item as Finder does: the last part of its path, with the extension', () => {
    expect(onDisk('/v/Plans/Todo.md', 'file')).toEqual({ name: 'Todo.md', kind: 'file' })
    expect(onDisk('/v/Projects', 'dir')).toEqual({ name: 'Projects', kind: 'dir' })
  })

  it('a toast keeps the failure part as gestureNotice says it', () => {
    expect(gestureNotice(`Moved ${namedItems([file('Plan.md'), file('Todo.md')])}`, ['Budget already exists'], "Can't move")).toBe('Moved 2 files (Plan.md, Todo.md), skipped 1: Budget already exists')
  })

  it('the drag-out box names the items it asks about by kind and by name on disk (S76)', () => {
    expect(dragOutText({ paths: ['/v/Projects'], kinds: ['dir'], links: 0 })).toBe('Copied 1 folder (Projects) to Finder?')
    expect(dragOutText({ paths: ['/v/A.md', '/v/B.md', '/v/C', '/v/D.md'], kinds: ['file', 'file', 'dir', 'file'], links: 2 })).toBe('Copied 1 folder and 3 files (A.md, B.md, C + 1 more) to Finder? 2 notes link to them.')
  })
})
