import { describe, expect, it } from 'vitest'
import { branchSteps, type LevelNode } from './groupLevelSteps'

/**
 * "Expand all" / "Collapse all" on a nested Folder group's header (YAZ-4928): the folder groups below that header, in
 * the view's collapse keys. Pure.
 */
describe('branchSteps (YAZ-4928)', () => {
  // Cloud * › AWS * › Lambda * › Tuning; Cloud › Costs; Habits (a leaf). "*" marks a nested Folder group with children.
  const TREE: LevelNode[] = [
    { key: 'cloud', nested: true, children: [{ key: 'cloud/aws', nested: true, children: [{ key: 'cloud/aws/lambda', nested: true, children: [{ key: 'cloud/aws/lambda/tuning' }] }] }, { key: 'cloud/costs' }] },
    { key: 'habits' },
  ]

  it('a nested Folder group with children: Collapse all shuts every group below it (the header stays open); Expand all opens the header and every group below', () => {
    expect(branchSteps(TREE, 'cloud', [])).toEqual({ collapseAll: ['cloud/aws', 'cloud/aws/lambda', 'cloud/aws/lambda/tuning', 'cloud/costs'], expandAll: null })
    expect(branchSteps(TREE, 'cloud', ['cloud', 'cloud/aws/lambda', 'habits'])).toEqual({
      collapseAll: ['cloud', 'cloud/aws/lambda', 'habits', 'cloud/aws', 'cloud/aws/lambda/tuning', 'cloud/costs'],
      expandAll: ['habits'],
    })
  })

  it('nothing to do is null: all below shut → no Collapse all; the header and all below open → no Expand all', () => {
    expect(branchSteps(TREE, 'cloud/aws', ['cloud/aws/lambda', 'cloud/aws/lambda/tuning'])).toEqual({ collapseAll: null, expandAll: [] })
    expect(branchSteps(TREE, 'cloud/aws', [])).toEqual({ collapseAll: ['cloud/aws/lambda', 'cloud/aws/lambda/tuning'], expandAll: null })
  })

  it('a leaf, a plain group and an unknown key get no steps at all', () => {
    expect(branchSteps(TREE, 'cloud/aws/lambda/tuning', [])).toBeNull()
    expect(branchSteps(TREE, 'habits', [])).toBeNull()
    expect(branchSteps([{ key: 'a', children: [{ key: 'a/b' }] }], 'a', [])).toBeNull()
    expect(branchSteps(TREE, 'nope', [])).toBeNull()
  })

  it('a group under a plain level is found too: only its own branch moves', () => {
    const under: LevelNode[] = [{ key: 'done', children: [{ key: 'done/cloud', nested: true, children: [{ key: 'done/cloud/aws' }] }] }, { key: 'open', children: [{ key: 'open/cloud', nested: true, children: [{ key: 'open/cloud/aws' }] }] }]
    expect(branchSteps(under, 'open/cloud', ['done/cloud/aws'])).toEqual({ collapseAll: ['done/cloud/aws', 'open/cloud/aws'], expandAll: null })
  })
})
