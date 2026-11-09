import type { TabOperation } from './automationTabs'
import type { BoardExportOperation, EditorOperation } from './automationEditor'
import type { ListScope, SidebarTab } from './types'

export interface NavigationInput {
  workspace?: string
  root?: string
  roots?: string[]
  path?: string
  id?: string
  name?: string
  window?: string
  tab?: string
  mode?: 'reuse' | 'new'
  panel?: 'right'
  sidebar?: SidebarTab
  scope?: ListScope
  group?: string
  view?: string
  reveal?: boolean
  allowPartial?: boolean
}

/** Resolved in main before opening or raising a window. No unresolved name can select an arbitrary item. */
export interface NavigationTarget {
  tab?: string
  path?: string
  /** Open `path` in the right panel instead of a main tab. */
  panel?: 'right'
  sidebar?: SidebarTab
  group?: string
  view?: string
  reveal?: boolean
}
/** `dirty` lists the paths at or under `path` whose editors hold unsaved edits, with their tabs (YAZ-4515). */
export type InspectTarget = { kind: 'history' } | { kind: 'window' } | { kind: 'document'; tab: string } | { kind: 'dirty'; path: string }
export type FileOperationTarget = TabOperation | EditorOperation | BoardExportOperation
  | { command: 'file.copy'; paths: string[]; targetDir: string; external: boolean; dropValues: boolean }
  | { command: 'file.restore' } | { command: 'file.undo' } | { command: 'file.redo' }
  | { command: 'file.rename'; path: string; newPath: string; kind: 'file' | 'dir' }
  | { command: 'file.move'; targetDir: string; moves: { oldPath: string; newPath: string; kind: 'file' | 'dir' }[]; dropValues: boolean }
  | { command: 'file.retitle'; path: string; title: string; kind: 'file' | 'dir' }
  | { command: 'file.trash'; paths: string[] }
export type RendererCommand = { id: string; action: 'navigate'; target: NavigationTarget } | { id: string; action: 'inspect'; target: InspectTarget } | { id: string; action: 'operate'; target: FileOperationTarget }
export type RendererReply = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
