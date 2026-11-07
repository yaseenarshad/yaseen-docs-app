export type EditorAction =
  | { action: 'select'; anchor: number; head: number }
  | { action: 'replace'; text: string }
  | { action: 'format'; format: 'bold' | 'italic' | 'code' | 'strike' }
  | { action: 'undo' }
  | { action: 'redo' }
  | { action: 'save' }
export type EditorOperation = { command: 'editor.action'; tab: string; revision: string; edit: EditorAction }
