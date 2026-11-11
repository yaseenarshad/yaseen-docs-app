/**
 * COLLAPSE OR EXPAND ONE LEVEL AT A TIME (YAZ-3746 13AT, S8 reversed: "i reversed my choice i want this"), beside
 * "Collapse all", which stays as it is. A view's groups are levels (Page › Scenario › Status …):
 *
 *  - "Collapse one level" closes every group of the deepest level that shows open now. Pressed again, the level
 *    above, until only the top level shows.
 *  - "Expand one level" opens every group down to one level deeper than shows open now (the levels above it too, so
 *    the page reads evenly), until every row shows.
 *
 * Pure: the groups as a tree of their collapse keys (`spotKey`) and the view's collapsed keys in, the next collapsed
 * keys out — `null` where the step would change nothing. The group header's menu and the toolbar's ⌃ read them from
 * `GroupLevelStepsContext`, which `ViewsPane` gives while the view has two levels or more.
 */
import { createContext } from 'react'

export interface LevelNode {
  key: string
  children?: readonly LevelNode[]
}

export interface LevelSteps {
  /** The collapsed keys after "Collapse one level"; null when nothing is open to close. */
  collapseOne: string[] | null
  /** The collapsed keys after "Expand one level"; null when every group is open. */
  expandOne: string[] | null
}

export function levelSteps(nodes: readonly LevelNode[], collapsed: readonly string[]): LevelSteps {
  const shut = new Set(collapsed)
  const byLevel: string[][] = []
  /** The deepest level with a group that is open and shows (each group above it open): -1 when the top is all shut. */
  let open = -1
  const walk = (list: readonly LevelNode[], depth: number, shows: boolean) => {
    for (const node of list) {
      ;(byLevel[depth] ??= []).push(node.key)
      const isOpen = !shut.has(node.key)
      if (shows && isOpen) open = Math.max(open, depth)
      if (node.children !== undefined) walk(node.children, depth + 1, shows && isOpen)
    }
  }
  walk(nodes, 0, true)
  if (byLevel.length === 0) return { collapseOne: null, expandOne: null }

  const closing = open < 0 ? [] : byLevel[open].filter((key) => !shut.has(key))
  const collapseOne = closing.length === 0 ? null : [...collapsed, ...closing]

  const target = Math.min(open + 1, byLevel.length - 1)
  const opening = new Set(byLevel.slice(0, target + 1).flat())
  const kept = collapsed.filter((key) => !opening.has(key))
  const expandOne = kept.length === collapsed.length ? null : kept

  return { collapseOne, expandOne }
}

/** What the menus offer; an absent step is greyed. */
export interface GroupLevelStepActions {
  collapseOne?: () => void
  expandOne?: () => void
}

export const GroupLevelStepsContext = createContext<GroupLevelStepActions | null>(null)
