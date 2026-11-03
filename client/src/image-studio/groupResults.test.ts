/** One tile per icon, its copies on request (YAZ-4157 demo 6J): the group key, the whole-word match and the groups. */
import { describe, expect, it } from 'vitest'
import type { StudioItem } from '@shared/types'
import { groupResults, iconGroupKey, namesTheSearch } from './groupResults'

const icon = (id: string): StudioItem => ({ itemKey: `iconify:${id}`, provider: 'iconify', providerId: id, kind: 'icon', title: id.split(':')[1].replace(/-/g, ' ') })
const photo = (id: string): StudioItem => ({ itemKey: `pixabay:${id}`, provider: 'pixabay', providerId: id, kind: 'illustration', title: 'Hand' })

describe('iconGroupKey', () => {
  it('takes off skin tones, styles and sizes, again and again', () => {
    expect(iconGroupKey('nail-polish-medium-dark')).toBe('nail-polish')
    expect(iconGroupKey('rocket-24-filled')).toBe('rocket')
    expect(iconGroupKey('snail-duotone-round')).toBe('snail')
    expect(iconGroupKey('nail-polish-one')).toBe('nail-polish-one')
  })

  it('never takes a name down to nothing', () => {
    expect(iconGroupKey('dark')).toBe('dark')
  })
})

describe('namesTheSearch', () => {
  it('a word of the name must START with a word of the search', () => {
    expect(namesTheSearch('nails', 'nail')).toBe(true)
    expect(namesTheSearch('hammer-nails', 'hammer and nail')).toBe(true)
    expect(namesTheSearch('snail', 'nail')).toBe(false)
    expect(namesTheSearch('gallery-thumbnails', 'nail')).toBe(false)
  })
})

describe('groupResults', () => {
  it('keeps the provider`s order; the first of a group is its tile; Pixabay passes as it is', () => {
    const groups = groupResults([icon('noto:nail-polish'), photo('1'), icon('twemoji:nail-polish'), icon('noto:snail'), icon('mdi:nail'), icon('fluent-emoji-flat:nail-polish-light')], 'nail')
    expect(groups.map((g) => [g.head.itemKey, g.variants.map((v) => v.itemKey)])).toEqual([
      ['iconify:noto:nail-polish', ['iconify:twemoji:nail-polish', 'iconify:fluent-emoji-flat:nail-polish-light']],
      ['pixabay:1', []],
      ['iconify:mdi:nail', []],
    ])
  })
})
