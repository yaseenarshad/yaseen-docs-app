/**
 * Tables is its own Settings page (YAZ-4775 demo: "tables have so many settings now under editor i think they should be
 * their own tab"), right after Editor: All tables (was "Tables"), Cell notes and Calendar tables. Editor ends at Outside
 * changes. Search finds them as "Tables › …". Only where the rows show moved; the settings keep their ids.
 * Also YAZ-4790: Tables › Cell notes › Add button is off by default.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { availableSections, groupsOf, type SettingsCtx } from './registry'
import { searchSettings, settingCandidates } from './searchSettings'

const ctx = (): SettingsCtx => ({ settings: { ...DEFAULT_SETTINGS }, onChange: () => undefined })
const section = (id: string) => availableSections(ctx()).find((s) => s.id === id)!
const titles = (id: string) => groupsOf(section(id), ctx()).map((g) => g.title)

describe('YAZ-4775 demo: the Tables page', () => {
  it('YAZ-4775 demo: Tables comes right after Editor, then Code', () => {
    const order = availableSections(ctx()).map((s) => s.id)
    expect(order.indexOf('tables')).toBe(order.indexOf('editor') + 1)
    expect(order.indexOf('code')).toBe(order.indexOf('tables') + 1)
    expect(section('tables').title).toBe('Tables')
  })

  it('YAZ-4775 demo: its groups are All tables, Cell notes and Calendar tables', () => {
    expect(titles('tables')).toEqual(['All tables', 'Cell notes', 'Calendar tables'])
  })

  it('YAZ-4775 demo: Editor no longer holds the table groups (Outside changes, then the later Code blocks, YAZ-4783)', () => {
    const editor = titles('editor')
    expect(editor).toContain('Outside changes')
    for (const gone of ['Tables', 'All tables', 'Cell notes', 'Calendar tables']) expect(editor).not.toContain(gone)
  })

  it('YAZ-4775 demo: a search for "cell notes" finds them on the Tables page', () => {
    const hits = searchSettings(settingCandidates(ctx()), 'cell notes')
    expect(hits.length).toBeGreaterThan(0)
    // Other pages' hints may name cell notes (Folder pages' "Keep cell notes open"); the group itself is on Tables, never Editor.
    expect(hits.some((h) => h.section.id === 'tables' && h.group.title === 'Cell notes')).toBe(true)
    expect(hits.some((h) => h.section.id === 'editor')).toBe(false)
  })
})

describe('YAZ-4790 demo: Cell notes › Add button is off by default', () => {
  it('YAZ-4790 demo: the default settings have the cell note + off', () => {
    const cellNotes = groupsOf(section('tables'), ctx()).find((g) => g.title === 'Cell notes')!
    const ids = cellNotes.items.map((i) => i.id)
    const button = ids.find((id) => /button/i.test(id))
    expect(button, `a button row among ${ids.join(', ')}`).toBeDefined()
    const path = button!.split('.')
    let value: unknown = DEFAULT_SETTINGS
    for (const part of path) value = (value as Record<string, unknown>)[part]
    expect(value).toBe(false)
  })
})
