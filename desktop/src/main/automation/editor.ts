import { AutomationFailure } from '@shared/automation'
import { DRAWING_ACTIONS, type DrawingAction, type EditorAction } from '@shared/automationEditor'
import { decodeViewOnlyText } from '../fs/file'
import { MAX_FILE_BYTES } from '@shared/types'
import type { NavigationHost } from './navigation'

export async function editorCommand(host: NavigationHost, command: string, args: Record<string, unknown>, body: Buffer) {
  if (!host.windows().some(window => window.id === args.window)) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The requested window is not live.')
  const action = command.slice('editor.'.length)
  if (body.length > MAX_FILE_BYTES) throw new AutomationFailure('TOO_LARGE', 'A text edit exceeds the document size limit.')
  const edit: EditorAction = action === 'replace' ? { action, text: decodeViewOnlyText(body, 'editor content') }
    : action === 'select' ? { action, anchor: args.anchor as number, head: args.head as number }
    : action === 'format' ? { action, format: args.format as 'bold' | 'italic' | 'code' | 'strike' }
    : action === 'selectElements' ? { action, ids: args.ids as string[] }
    : Object.hasOwn(DRAWING_ACTIONS, action) ? { action: action as DrawingAction }
    : { action: action as 'undo' | 'redo' | 'save' }
  return host.operate(args.window as string, { command: 'editor.action', tab: args.tab as string, revision: args.revision as string, edit })
}
