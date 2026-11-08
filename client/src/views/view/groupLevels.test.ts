/** The column menu's Group flyout writes (YAZ-4588 D42): only this column, append it, remove a level. */
import { describe, expect, it } from 'vitest'
import type { ViewDef } from '../viewSchema'
import { groupAppend, groupOnly, groupRemoveLevel } from './groupLevels'

const view = (groupBy?: ViewDef['groupBy']): ViewDef => ({ type: 'table', name: 'T', ...(groupBy === undefined ? {} : { groupBy }) })

describe('groupOnly (YAZ-4588 D42)', () => {
  it('no grouping: this column alone, in the single-object form', () => {
    const v = view()
    groupOnly(v, 'status')
    expect(v.groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
  })

  it('grouped by others: this column alone; the first level’s look (highlight, Large) stays, its order does not', () => {
    const v = view([{ property: 'note.pillar', direction: 'DESC', by: 'value', highlight: 'blue', large: true }, { property: 'note.priority' }])
    groupOnly(v, 'note.status')
    expect(v.groupBy).toEqual({ property: 'note.status', direction: 'ASC', highlight: 'blue', large: true })
  })

  it('this column a level: that level alone, with its own highlight, Large and order', () => {
    const v = view([{ property: 'note.pillar', highlight: 'blue' }, { property: 'status', direction: 'DESC', by: 'value', highlight: 'green', large: true }])
    groupOnly(v, 'note.status')
    expect(v.groupBy).toEqual({ property: 'note.status', direction: 'DESC', by: 'value', highlight: 'green', large: true })
  })

  it('an entry with no column stays after the levels, as it was (YAZ-4544)', () => {
    const v = view([{ property: 'note.pillar' }, {} as never])
    groupOnly(v, 'note.status')
    expect(v.groupBy).toEqual([{ property: 'note.status', direction: 'ASC' }, {}])
  })
})

describe('groupAppend (YAZ-4588 D42)', () => {
  it('appends this column as the next level; every level keeps its fields', () => {
    const v = view({ property: 'note.pillar', direction: 'DESC', by: 'value', highlight: 'blue', large: true })
    groupAppend(v, 'status')
    expect(v.groupBy).toEqual([
      { property: 'note.pillar', direction: 'DESC', by: 'value', highlight: 'blue', large: true },
      { property: 'note.status', direction: 'ASC' },
    ])
  })

  it('does nothing at three levels, or when this column is already a level', () => {
    const three = view([{ property: 'note.a' }, { property: 'note.b' }, { property: 'note.c' }])
    groupAppend(three, 'note.d')
    expect(three.groupBy).toEqual([{ property: 'note.a' }, { property: 'note.b' }, { property: 'note.c' }])
    const twice = view({ property: 'status' })
    groupAppend(twice, 'note.status')
    expect(twice.groupBy).toEqual({ property: 'status' })
  })

  it('Folder then Folder is allowed: the second level is the next folder down (YAZ-2541)', () => {
    const v = view({ property: 'file.folder', highlight: 'pink' })
    groupAppend(v, 'file.folder')
    expect(v.groupBy).toEqual([{ property: 'file.folder', highlight: 'pink' }, { property: 'file.folder', direction: 'ASC' }])
  })
})

describe('groupRemoveLevel (YAZ-4588 D42)', () => {
  it('removes one level; the levels below move up with their fields', () => {
    const v = view([{ property: 'note.a', highlight: 'blue' }, { property: 'note.b' }, { property: 'note.c', direction: 'DESC', by: 'value', large: true }])
    groupRemoveLevel(v, 1)
    expect(v.groupBy).toEqual([{ property: 'note.a', highlight: 'blue' }, { property: 'note.c', direction: 'DESC', by: 'value', large: true }])
    groupRemoveLevel(v, 0)
    expect(v.groupBy).toEqual({ property: 'note.c', direction: 'DESC', by: 'value', large: true })
  })

  it('the last level gone deletes groupBy; an entry with no column stays', () => {
    const v = view({ property: 'note.a' })
    groupRemoveLevel(v, 0)
    expect('groupBy' in v).toBe(false)
    const kept = view([{ property: 'note.a' }, {} as never])
    groupRemoveLevel(kept, 0)
    expect(kept.groupBy).toEqual([{}])
  })
})
