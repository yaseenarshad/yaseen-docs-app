import type { WebContents } from 'electron'
import { SPECIAL } from '@shared/ipc'
import { BridgeFailure } from '../fs/fsUtils'
import type { WindowManagerIpc } from '../windows'
import { isRendererUrl } from '../rendererUrl'
import { handleWithEvent } from './envelope'

// Bound renderer-supplied strings while allowing large document selections (UTF-16 code units).
export const MAX_COPY_TEXT_LENGTH = 16 * 1024 * 1024

export interface ClipboardHost {
  target(): Pick<WebContents, 'id'> | undefined
  /** Electron clipboard.writeText replaces existing formats with text only. */
  writeText(text: string): void
  /** Copy as › Without folded lines (YAZ-3653): the text and rich HTML normal Copy writes. */
  write(data: { text: string; html: string }): void
  /** The clipboard's text, for the note menu's Paste as (YAZ-3653). */
  readText(): string
  rendererUrl: string
}

/**
 * Private preload reply to Copy as; no arbitrary clipboard writer is exposed to the renderer. A note menu row
 * (`menu:edit`, YAZ-3653) asks the same way, from the target window and, in the preload, only during a user gesture.
 */
export function registerClipboardIpc(windows: Pick<WindowManagerIpc, 'idFor'>, host: ClipboardHost): void {
  handleWithEvent(SPECIAL.menuCopyText, async (event, text: unknown, html?: unknown) => {
    const { sender, senderFrame } = event
    if (sender.isDestroyed()
      || windows.idFor(sender) === undefined
      || sender.id !== host.target()?.id
      || !senderFrame
      || senderFrame !== sender.mainFrame
      || !isRendererUrl(senderFrame.url, host.rendererUrl)
      || typeof text !== 'string'
      || (html !== undefined && typeof html !== 'string')
      || text.length + (typeof html === 'string' ? html.length : 0) > MAX_COPY_TEXT_LENGTH) {
      throw new BridgeFailure('BAD_REQUEST', 'invalid copy target or text')
    }
    if (text === '') return
    if (typeof html === 'string') host.write({ text, html })
    else host.writeText(text)
  })
  // A note's own right-click menu (YAZ-3653): each row does what the native menu's row does, on the
  // window that sent it. Only that window's own selection and clipboard commands; never other text.
  handleWithEvent(SPECIAL.menuEdit, async (event, action: unknown, word?: unknown) => {
    const { sender, senderFrame } = event
    if (sender.isDestroyed()
      || windows.idFor(sender) === undefined
      || sender.id !== host.target()?.id
      || !senderFrame
      || senderFrame !== sender.mainFrame
      || !isRendererUrl(senderFrame.url, host.rendererUrl)) {
      throw new BridgeFailure('BAD_REQUEST', 'invalid menu target')
    }
    switch (action) {
      case 'cut': return sender.cut()
      case 'copy': return sender.copy()
      case 'paste': return sender.paste()
      case 'copy-plain':
      case 'copy-markdown':
      case 'copy-visible':
        return sender.send(SPECIAL.menuCopyAs, action.slice('copy-'.length))
      case 'paste-plain':
      case 'paste-markdown':
        return sender.send(SPECIAL.menuPasteAs, { mode: action.slice('paste-'.length), text: host.readText() })
      case 'add-word':
        if (typeof word === 'string' && /^\S{1,64}$/.test(word)) {
          sender.session.addWordToSpellCheckerDictionary(word)
          return
        }
    }
    throw new BridgeFailure('BAD_REQUEST', 'invalid menu action')
  })
}
