/**
 * YAZ-5197 (decided by Yaseen's delegation): the "Fix later" glyph is a WRENCH, not a pencil (a pencil reads as "Edit
 * card"). The wrench is Tabler's `tool`, the one the app already draws for the Present tab (`toolsIcon`), redrawn on the
 * Inbox's 16 px grid. Every place that shows the Fix later glyph draws `FIX_PATH`: the Inbox ⋯ row and the To fix list.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIX_PATH } from './cardInboxIcons'

const PENCIL = 'M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3'
/** Tabler's `tool` (24 px), as `presentationIcons.tsx` draws it. */
const TABLER_TOOL = 'M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5'

describe('the Fix later glyph (YAZ-5197)', () => {
  it('is the wrench, not the pencil', () => {
    expect(FIX_PATH).not.toBe(PENCIL)
    // The same command letters as Tabler's tool: the same shape, scaled to 16 px.
    const letters = (d: string) => d.replace(/[^a-zA-Z]/g, '')
    expect(letters(FIX_PATH)).toBe(letters(TABLER_TOOL))
    expect(readFileSync(join(__dirname, '../drawings/presentation/presentationIcons.tsx'), 'utf8')).toContain(TABLER_TOOL)
  })

  it('every place that shows it draws FIX_PATH', () => {
    const inbox = readFileSync(join(__dirname, 'CardInbox.tsx'), 'utf8')
    expect(inbox).toMatch(/const ICON_FIX = icon\(FIX_PATH\)/)
    expect(inbox.match(/icon: ICON_FIX/g)?.length).toBe(2)
    const icons = readFileSync(join(__dirname, 'cardInboxIcons.tsx'), 'utf8')
    expect(icons).toMatch(/export const FixIcon = \(\) => glyph\(<path d=\{FIX_PATH\} \/>\)/)
    const bar = readFileSync(join(__dirname, 'CardInboxBar.tsx'), 'utf8')
    expect(bar).toMatch(/\{ id: 'fix', label: 'To fix', icon: FixIcon \}/)
  })
})
