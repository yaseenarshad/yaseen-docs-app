import type { StoredTab } from './types'
export type TabOperation =
  | { command: 'tab.open'; path: string; background: boolean; copy: boolean }
  | { command: 'tab.blank' }
  | { command: 'tab.close' | 'tab.duplicate' | 'tab.keep' | 'tab.sleep' | 'tab.wake'; tab: string }
  | { command: 'tab.rename'; tab: string; name: string | null }
  | { command: 'tab.reorder'; tab: string; index: number }
  | { command: 'session.apply'; tabs: StoredTab[] }
  | { command: 'sidebar.setCollapsed'; collapsed: boolean }
  | { command: 'rightPanel.setOpen'; open: boolean }
  /** The source half of a cross-window move: the GUI's send path. `to` null is a new window. */
  | { command: 'tab.move'; tab: string; to: string | null; at?: number; background: boolean }
  /** The target half: reply once a tab of `path` that is not in `except` stands in this strip. */
  | { command: 'tab.received'; path: string; except: string[] }

export const isTabOperation = (target: { command: string }): target is TabOperation => target.command.startsWith('tab.') || target.command === 'session.apply' || target.command === 'sidebar.setCollapsed' || target.command === 'rightPanel.setOpen'
