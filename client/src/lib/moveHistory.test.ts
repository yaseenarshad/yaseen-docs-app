/**
 * The window's undo list for moves (YAZ-3255 D10): the last 20 gestures, newest last, and a redo
 * list that a new move empties.
 */
import { describe, expect, it } from 'vitest'
import { createMoveHistory, invertMoves } from './moveHistory'

describe('createMoveHistory (YAZ-3255 D10)', () => {
  it('undo takes the newest gesture; undone puts it on the redo list; redo takes it back; redone puts it on the undo list again', () => {
    const history = createMoveHistory<string>(20)
    expect(history.undo()).toBeUndefined() // nothing to undo (S35)
    history.push('a')
    history.push('b')
    expect(history.undo()).toBe('b')
    history.undone('b')
    expect(history.redo()).toBe('b') // S37
    history.redone('b2') // the gesture again, with what it cleared this time
    expect(history.redo()).toBeUndefined()
    expect(history.undo()).toBe('b2')
    expect(history.undo()).toBe('a')
    expect(history.undo()).toBeUndefined()
  })

  it('a new move empties the redo list (S38)', () => {
    const history = createMoveHistory<string>(20)
    history.push('a')
    history.undone(history.undo()!)
    history.push('b')
    expect(history.redo()).toBeUndefined()
    expect(history.undo()).toBe('b')
  })

  it('more than 20 gestures: the oldest leaves the list (S41), and a redone gesture keeps the limit too', () => {
    const history = createMoveHistory<number>(20)
    for (let i = 1; i <= 21; i++) history.push(i)
    const undone: number[] = []
    for (let n = history.undo(); n !== undefined; n = history.undo()) undone.push(n)
    expect(undone).toHaveLength(20)
    expect(undone.at(-1)).toBe(2)
  })
})

describe('invertMoves', () => {
  it('the moves back, newest first', () => {
    expect(
      invertMoves([
        { oldPath: '/v/A/a.md', newPath: '/v/B/a.md', kind: 'file' },
        { oldPath: '/v/A/Sub', newPath: '/v/B/Sub', kind: 'dir' },
      ]),
    ).toEqual([
      { oldPath: '/v/B/Sub', newPath: '/v/A/Sub', kind: 'dir' },
      { oldPath: '/v/B/a.md', newPath: '/v/A/a.md', kind: 'file' },
    ])
  })
})
