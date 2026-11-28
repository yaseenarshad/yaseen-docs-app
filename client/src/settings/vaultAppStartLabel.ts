import type { SidebarLens, VaultAppSidebarStart } from '@shared/types'

export const SIDEBAR_TAB_LABELS: Record<SidebarLens, string> = {
  files: 'Files',
  focus: 'Focus',
  favorites: 'Favorites',
  sessions: 'Sessions',
  recents: 'Recents',
}

export function sidebarStartBadgeLabel(sidebarStart?: VaultAppSidebarStart): string | null {
  if (sidebarStart === undefined) return null
  const parts: string[] = [SIDEBAR_TAB_LABELS[sidebarStart.tab] ?? sidebarStart.tab]
  const folder = sidebarStart.folderName ?? sidebarStart.folderPath
  if (folder !== undefined && folder.length > 0) {
    parts.push(folder)
  }
  if (sidebarStart.onlyFolder === true) {
    parts.push('Only')
  }
  return parts.join(' · ')
}
