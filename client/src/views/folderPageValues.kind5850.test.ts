/**
 * YAZ-5850: the Pages table hides a card file's `kind: card` mark, as the properties panel does (`isCardMark`).
 * The Type column (`file.kind`) is the way to see card files. Any other `kind` value is the user's and stays.
 */
import { describe, expect, it } from 'vitest'
import { columnReservedKeys } from '../links/reservedKeys'
import { rowValues } from './folderPageValues'

const run = (properties: Record<string, unknown>) => rowValues(properties, columnReservedKeys(true), undefined, new Set(), new Map())

describe('YAZ-5850 the card mark is no Pages table column', () => {
  it('drops kind: card from a card file row', () => {
    expect(run({ kind: 'card', tags: ['a'] })).toEqual({ tags: ['a'] })
  })
  it('drops the mark in any letter case and with spaces', () => {
    expect(run({ kind: ' Card ' })).toEqual({})
  })
  it('keeps a kind that is not the card mark', () => {
    expect(run({ kind: 'recipe' })).toEqual({ kind: 'recipe' })
  })
  it('gives back the same object when there is nothing to drop', () => {
    const p = { tags: ['a'] }
    expect(run(p)).toBe(p)
  })
})
