/**
 * The window's undo list for moves (YAZ-3255 D10): the last 20 gestures, newest last, and a redo
 * list that a new move empties.
 */
import { describe, expect, it } from 'vitest'
import { createMoveHistory, invertMoves, type MovedGesture } from './moveHistory'

/** A gesture of one move, named by its note. */
const gesture = (name: string): MovedGesture => ({ moves: [{ oldPath: `/v/${name}.md`, newPath: `/v/B/${name}.md`, kind: 'file' }], cleared: [] })
const name = (entry: MovedGesture | undefined): string | undefined => entry?.moves[0].oldPath.slice(3, -3)

describe('createMoveHistory (YAZ-3255 D10)', () => {
  it('undo takes the newest gesture; undone puts it on the redo list; redo takes it back; redone puts it on the undo list again', () => {
    const history = createMoveHistory(20)
    expect(history.undo()).toBeUndefined() // nothing to undo (S35)
    history.push(gesture('a'))
    history.push(gesture('b'))
    const b = history.undo()
    expect(name(b)).toBe('b')
    history.undone(b!)
    expect(history.redo()).toBe(b) // S37
    history.redone(gesture('b2')) // the gesture again, with what it cleared this time
    expect(history.redo()).toBeUndefined()
    expect(name(history.undo())).toBe('b2')
    expect(name(history.undo())).toBe('a')
    expect(history.undo()).toBeUndefined()
  })

  it('a new move empties the redo list (S38)', () => {
    const history = createMoveHistory(20)
    history.push(gesture('a'))
    history.undone(history.undo()!)
    history.push(gesture('b'))
    expect(history.redo()).toBeUndefined()
    expect(name(history.undo())).toBe('b')
  })

  it('more than 20 gestures: the oldest leaves the list (S41), and a redone gesture keeps the limit too', () => {
    const history = createMoveHistory(20)
    for (let i = 1; i <= 21; i++) history.push(gesture(String(i)))
    const undone: string[] = []
    for (let entry = history.undo(); entry !== undefined; entry = history.undo()) undone.push(name(entry)!)
    expect(undone).toHaveLength(20)
    expect(undone.at(-1)).toBe('2')
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
