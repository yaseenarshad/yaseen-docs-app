import type { StoredTab } from './types'
export type TabOperation =
  | { command: 'tab.open'; path: string; background: boolean; copy: boolean }
  | { command: 'tab.blank' }
  | { command: 'tab.close' | 'tab.duplicate' | 'tab.keep' | 'tab.sleep' | 'tab.wake'; tab: string }
  | { command: 'tab.rename'; tab: string; name: string | null }
  | { command: 'tab.reorder'; tab: string; index: number }
  | { command: 'session.apply'; tabs: StoredTab[] }
  | { command: 'sidebar.setCollapsed'; collapsed: boolean }

export const isTabOperation = (target: { command: string }): target is TabOperation => target.command.startsWith('tab.') || target.command === 'session.apply' || target.command === 'sidebar.setCollapsed'
