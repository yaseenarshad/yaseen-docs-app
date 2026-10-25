/** How long the toast stays (YAZ-3255 D11): a fading action toast goes after `UNDO_NOTICE_MS`; another action toast stays. */
import { describe, expect, it } from 'vitest'
import { LINK_NOTICE_MS, noticeMs, UNDO_NOTICE_MS } from './notice'

describe('noticeMs (YAZ-3255 D11)', () => {
  it('a plain notice fades after LINK_NOTICE_MS; an Undo or Redo toast after UNDO_NOTICE_MS (6 s); another action toast stays', () => {
    const run = () => undefined
    expect(UNDO_NOTICE_MS).toBe(6000)
    expect(noticeMs({ text: 'Copied path', icon: 'info' })).toBe(LINK_NOTICE_MS)
    expect(noticeMs({ text: 'Moved 1 item', icon: 'paste', action: { label: 'Undo', run, fades: true } })).toBe(UNDO_NOTICE_MS)
    expect(noticeMs({ text: 'Merged', icon: 'info', action: { label: 'See changes', run } })).toBeNull()
  })
})
