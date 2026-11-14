import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { PhoneCodeAnswer } from '@shared/types'
import { BridgeFailure } from '../fs/fsUtils'
import { isRendererUrl } from '../rendererUrl'
import type { WindowManagerIpc } from '../windows'
import { handleWithEvent } from './envelope'

/**
 * `phone:code` (YAZ-5098 "Connect your phone"): the one door that gives a renderer something made from the GitHub
 * token, and what it gives is a QR grid, never the token as text (`main/phoneCode.ts`). The other secret doors stay
 * "write and ask, never read" (`ipc/secrets.ts`).
 *
 * The sender is checked as the private clipboard doors check it (`ipc/clipboard.ts`): a live window of the app, its
 * main frame, on the app's own page. Also: the window is in front (the code shows only after a click in it), and
 * `root` is a vault of that window. A failure answers plain words, never its own message, which could hold a secret.
 */
export interface PhoneIpcHost {
  rendererUrl: string
  /** The sender's window has the focus. */
  isFocused(sender: WebContents): boolean
  /** The vaults of the sender's window (`senderRoots`). */
  roots(e: IpcMainInvokeEvent): readonly string[]
  /** `buildPhoneCode` with the production edges. */
  build(root: string): Promise<PhoneCodeAnswer>
}

export function registerPhoneIpc(windows: Pick<WindowManagerIpc, 'idFor'>, host: PhoneIpcHost): void {
  handleWithEvent(CONTRACT.phone.code, async (event, root: unknown) => {
    const { sender, senderFrame } = event
    if (sender.isDestroyed()
      || windows.idFor(sender) === undefined
      || !senderFrame
      || senderFrame !== sender.mainFrame
      || !isRendererUrl(senderFrame.url, host.rendererUrl)
      || !host.isFocused(sender)) {
      throw new BridgeFailure('BAD_REQUEST', 'invalid sender for the phone code')
    }
    if (typeof root !== 'string' || !host.roots(event).includes(root)) throw new BridgeFailure('BAD_REQUEST', 'not a vault of this window')
    try {
      return await host.build(root)
    } catch {
      throw new BridgeFailure('IO_ERROR', 'The code could not be made.')
    }
  })
}
