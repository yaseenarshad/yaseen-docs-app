import type { Crepe } from '@milkdown/crepe'
import { commandsCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo, redo, closeHistory } from '@milkdown/kit/prose/history'
import { toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand } from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { AutomationFailure } from '@shared/automation'
import type { EditorAction } from '@shared/automationEditor'
import { editorViewOf } from './createCrepe'

/** The same installed commands as the editor toolbar; no keys, focus, or global editor lookup. */
export function markdownAction(crepe: Crepe, action: Exclude<EditorAction, { action: 'save' }>): void {
  const view = editorViewOf(crepe)
  if (action.action === 'select') {
    const { anchor, head } = action
    if (![anchor, head].every(at => Number.isInteger(at) && at >= 0 && at <= view.state.doc.content.size)) throw new AutomationFailure('INVALID_INPUT', 'Selection positions are outside this document.')
    view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head))))
    return
  }
  if (action.action === 'undo' || action.action === 'redo') {
    if (!(action.action === 'undo' ? undo : redo)(view.state, view.dispatch)) throw new AutomationFailure('NO_HISTORY', 'There is no editor history for this action.')
    return
  }
  // Keep each requested edit as its own local undo step.
  view.dispatch(closeHistory(view.state.tr))
  if (action.action === 'replace') view.dispatch(view.state.tr.insertText(action.text))
  else if (action.action === 'format') {
    const command = { bold: toggleStrongCommand, italic: toggleEmphasisCommand, code: toggleInlineCodeCommand, strike: toggleStrikethroughCommand }[action.format]
    if (!crepe.editor.action(ctx => ctx.get(commandsCtx).call(command.key))) throw new AutomationFailure('UNSUPPORTED_ACTION', 'This formatting action cannot apply to the current selection.')
  }
  view.dispatch(closeHistory(view.state.tr))
}
