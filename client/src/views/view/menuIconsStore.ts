/**
 * Live module-level store for `SettingsState.menuIcons` (YAZ-6567).
 * Synced once from `App.tsx` via `applyMenuIcons(settings.menuIcons)` so both React context menus
 * (`icons.tsx`, `menuSections.ts`, `TabMenu.tsx`) and plain-DOM ProseMirror menus (`linkMenu.ts`,
 * `inlineDrawingView.ts`) read the active choice without prop drilling.
 */
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_MENU_ICONS,
  resolveMenuIcons,
  type MenuIconAction,
  type MenuIconsSetting,
  type ResolvedMenuIcons,
} from '@shared/menuIcons'

type Listener = () => void

let currentSetting: MenuIconsSetting = DEFAULT_MENU_ICONS
let currentResolved: ResolvedMenuIcons = resolveMenuIcons(currentSetting)
const listeners = new Set<Listener>()

function sameResolved(a: ResolvedMenuIcons, b: ResolvedMenuIcons): boolean {
  return (
    a.enabled === b.enabled &&
    a.picks.newWindow === b.picks.newWindow &&
    a.picks.duplicateTab === b.picks.duplicateTab &&
    a.picks.openNewTab === b.picks.openNewTab &&
    a.picks.hideOthers === b.picks.hideOthers &&
    a.picks.showInSidebar === b.picks.showInSidebar
  )
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getMenuIconsSetting(): MenuIconsSetting {
  return currentSetting
}

export function getResolvedMenuIcons(): ResolvedMenuIcons {
  return currentResolved
}

export function isMenuIconVisible(action: MenuIconAction): boolean {
  return currentResolved.enabled && currentResolved.picks[action] !== 'none'
}

export function applyMenuIcons(setting: MenuIconsSetting | undefined): void {
  const nextSetting: MenuIconsSetting = setting ?? DEFAULT_MENU_ICONS
  const nextResolved = resolveMenuIcons(nextSetting)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.menuIcons = nextResolved.enabled ? 'on' : 'off'
  }
  const changed = !sameResolved(currentResolved, nextResolved)
  currentSetting = nextSetting
  if (!changed) return
  currentResolved = nextResolved
  for (const listener of listeners) listener()
}

export function useMenuIcons(): ResolvedMenuIcons {
  return useSyncExternalStore(subscribe, getResolvedMenuIcons, getResolvedMenuIcons)
}

export function resetMenuIconsForTest(): void {
  applyMenuIcons(DEFAULT_MENU_ICONS)
}
