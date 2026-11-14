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
 * THE GATE, ALL IN MAIN (YAZ-5218: page code got a code with no click):
 * 1. The sender, as the private clipboard doors check it (`ipc/clipboard.ts`): a live window of the app, its main frame,
 *    on the app's own page. The window is in front, and `root` is a vault of that window.
 * 2. A real click or key that MAIN saw in that window (`input-event`, `inputSeen.ts`) less than `GESTURE_MS` ago. A
 *    script, the devtools console or a synthetic DOM event makes no such event. The preload also asks
 *    `navigator.userActivation` (its own world, which the page cannot change), but main does not trust a renderer flag.
 * 3. No code of this window is shown now, and no confirm is open: a second request gets nothing.
 * 4. Main's own confirm, a native box that page code cannot click. Cancel: no code.
 * 5. After the code is made, the window must still be in front (YAZ-5217), else no grid.
 * A shown code counts for `SHOWN_MS`, or until the dialog says it hid it (`phone:hide`, same sender checks).
 * A failure answers plain words, never its own message, which could hold a secret.
 */
export const GESTURE_MS = 5_000
export const SHOWN_MS = 60_000

export interface PhoneIpcHost {
  rendererUrl: string
  /** The sender's window has the focus. */
  isFocused(sender: WebContents): boolean
  /** The vaults of the sender's window (`senderRoots`). */
  roots(e: IpcMainInvokeEvent): readonly string[]
  /** `buildPhoneCode` with the production edges. */
  build(root: string): Promise<PhoneCodeAnswer>
  /** The time of the last real click or key in this web contents, as main saw it; null for none. */
  lastInputAt(sender: WebContents): number | null
  /** Main's confirm (a native box on the sender's window): true for "Show code". */
  confirm(sender: WebContents): Promise<boolean>
  now(): number
}

export function registerPhoneIpc(windows: Pick<WindowManagerIpc, 'idFor'>, host: PhoneIpcHost): void {
  /** Per web contents: the time its shown code stops counting, or `busy` while a request runs. */
  const shown = new Map<number, number | 'busy'>()

  const checkSender = (event: IpcMainInvokeEvent) => {
    const { sender, senderFrame } = event
    if (sender.isDestroyed()
      || windows.idFor(sender) === undefined
      || !senderFrame
      || senderFrame !== sender.mainFrame
      || !isRendererUrl(senderFrame.url, host.rendererUrl)) {
      throw new BridgeFailure('BAD_REQUEST', 'invalid sender for the phone code')
    }
  }

  handleWithEvent(CONTRACT.phone.code, async (event, root: unknown) => {
    checkSender(event)
    const { sender } = event
    if (!host.isFocused(sender)) throw new BridgeFailure('BAD_REQUEST', 'the window is not in front')
    if (typeof root !== 'string' || !host.roots(event).includes(root)) throw new BridgeFailure('BAD_REQUEST', 'not a vault of this window')
    const now = host.now()
    const state = shown.get(sender.id)
    if (state === 'busy' || (typeof state === 'number' && now < state)) throw new BridgeFailure('BAD_REQUEST', 'a code is shown already')
    const input = host.lastInputAt(sender)
    if (input === null || now - input > GESTURE_MS || input > now) throw new BridgeFailure('BAD_REQUEST', 'the phone code needs a click or a key')
    shown.set(sender.id, 'busy')
    let answer: PhoneCodeAnswer
    try {
      if (!(await host.confirm(sender))) {
        shown.delete(sender.id)
        return { ok: false, problem: 'cancelled' }
      }
      answer = await host.build(root)
    } catch {
      shown.delete(sender.id)
      throw new BridgeFailure('IO_ERROR', 'The code could not be made.')
    }
    if (!answer.ok) {
      shown.delete(sender.id)
      return answer
    }
    if (sender.isDestroyed() || !host.isFocused(sender)) {
      shown.delete(sender.id)
      return { ok: false, problem: 'not-in-front' }
    }
    shown.set(sender.id, host.now() + SHOWN_MS)
    return answer
  })

  handleWithEvent(CONTRACT.phone.hide, async (event) => {
    checkSender(event)
    if (shown.get(event.sender.id) !== 'busy') shown.delete(event.sender.id)
  })
}
