import type { EditorOperation } from './automationEditor'
import type { ListScope, SidebarTab } from './types'

export interface NavigationInput {
  workspace?: string
  root?: string
  roots?: string[]
  path?: string
  id?: string
  name?: string
  window?: string
  mode?: 'reuse' | 'new'
  sidebar?: SidebarTab
  scope?: ListScope
  group?: string
  view?: string
  reveal?: boolean
  allowPartial?: boolean
}

/** Resolved in main before opening or raising a window. No unresolved name can select an arbitrary item. */
export interface NavigationTarget {
  path?: string
  sidebar?: SidebarTab
  scope?: ListScope
  group?: string
  view?: string
  reveal?: boolean
}
export type InspectTarget = { kind: 'history' } | { kind: 'window' } | { kind: 'document'; tab: string }
export type FileOperationTarget = EditorOperation
  | { command: 'file.restore' }
  | { command: 'file.rename'; path: string; newPath: string; kind: 'file' | 'dir' }
  | { command: 'file.retitle'; path: string; title: string; kind: 'file' | 'dir' }
  | { command: 'file.trash'; paths: string[] }
export type RendererCommand = { id: string; action: 'navigate'; target: NavigationTarget } | { id: string; action: 'inspect'; target: InspectTarget } | { id: string; action: 'operate'; target: FileOperationTarget }
export type RendererReply = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
