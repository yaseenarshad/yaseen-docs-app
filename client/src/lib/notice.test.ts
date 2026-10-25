/** How long the toast stays (YAZ-3255 D11): a fading action toast goes after `UNDO_NOTICE_MS`; another action toast stays. */
import { describe, expect, it } from 'vitest'
import { dragOutText, gestureNotice, LINK_NOTICE_MS, namedItems, NAMES_SHOWN, noticeMs, UNDO_NOTICE_MS } from './notice'

describe('noticeMs (YAZ-3255 D11)', () => {
  it('a plain notice fades after LINK_NOTICE_MS; an Undo or Redo toast after UNDO_NOTICE_MS (6 s); another action toast stays', () => {
    const run = () => undefined
    expect(UNDO_NOTICE_MS).toBe(6000)
    expect(noticeMs({ text: 'Copied path', icon: 'info' })).toBe(LINK_NOTICE_MS)
    expect(noticeMs({ text: 'Moved 1 item', icon: 'paste', action: { label: 'Undo', run, fades: true } })).toBe(UNDO_NOTICE_MS)
    expect(noticeMs({ text: 'Merged', icon: 'info', action: { label: 'See changes', run } })).toBeNull()
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

describe('namedItems (YAZ-3274 D22): the items of a gesture by name', () => {
  it('1 item names it (S73); 2 or 3 name them all (S74); more than 3 name the first 3, then how many more (S75)', () => {
    expect(NAMES_SHOWN).toBe(3)
    expect(namedItems(['Todo'])).toBe('1 item (Todo)')
    expect(namedItems(['Todo', 'Plan'])).toBe('2 items (Todo, Plan)')
    expect(namedItems(['Todo', 'Plan', 'Budget'])).toBe('3 items (Todo, Plan, Budget)')
    expect(namedItems(['Todo', 'Plan', 'Budget', 'Trip'])).toBe('4 items (Todo, Plan, Budget + 1 more)')
    const twelve = ['Todo', 'Plan', 'Budget', ...Array.from({ length: 9 }, (_, i) => `Note ${i + 1}`)]
    expect(namedItems(twelve)).toBe('12 items (Todo, Plan, Budget + 9 more)')
  })

  it('a toast keeps the names in the order of the gesture, and the failure part as gestureNotice says it', () => {
    expect(gestureNotice(`Moved ${namedItems(['Plan', 'Todo'])}`, ['Budget already exists'], "Can't move")).toBe('Moved 2 items (Plan, Todo), skipped 1: Budget already exists')
  })

  it('the drag-out box names the items it asks about (YAZ-3254 S29)', () => {
    expect(dragOutText({ paths: ['/v/Todo.md'], names: ['Todo'], links: 0 })).toBe('Copied 1 item (Todo) to Finder?')
    expect(dragOutText({ paths: ['/v/A.md', '/v/B.md', '/v/C.md', '/v/D.md'], names: ['Todo', 'Plan', 'Budget', 'Trip'], links: 2 })).toBe('Copied 4 items (Todo, Plan, Budget + 1 more) to Finder? 2 notes link to them.')
  })
})
