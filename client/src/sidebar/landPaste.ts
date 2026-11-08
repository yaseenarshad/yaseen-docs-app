import type { IndexRecord, PasteResponse } from '@shared/types'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { playGestureSound } from '../lib/gestureSound'
import type { MovedGesture } from '../lib/moveHistory'
import { gestureNotice, namedItems, onDisk, unlessFailed, type NoticeKind, type NoticeType } from '../lib/notice'
import { pageName, pathTitles } from '../lib/pageLabel'
import { dropFolderValuesAfterCopy, dropFolderValuesAfterMove } from '../links/shortcuts'

/**
 * A paste once main answered (YAZ-1674): the sidebar's Paste and the CLI's `file move` between vaults
 * (YAZ-4502) both end here. A CUT is a move: each note it moved leaves the values of the folders it
 * left behind (D20), judged on `before`, the target vault's index as it stood before the paste. A
 * COPY's notes keep no values for the folders that do not show them (YAZ-2420 3E1), judged after it.
 * Then ONE notice says it, and a cut goes on the undo list through `onMoved` (YAZ-3255 S39), which
 * plays its land sound. Answers the move gesture (null for a copy) and each item that did not land.
 */
export async function landPaste(
  { vault, index, before, res }: { vault: string; index: WikilinkResolveSource; before: { records: readonly IndexRecord[]; folders: readonly IndexRecord[] } | null; res: PasteResponse },
  { onNotice, onMoved }: { onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void; onMoved: (gesture: MovedGesture, text: string, skipped: boolean) => void },
): Promise<{ gesture: MovedGesture | null; failed: string[] }> {
  // What D20 cleared, for the undo list.
  const cleared: MovedGesture['cleared'] = []
  if (before !== null) for (const { from, to, kind } of res.pasted) cleared.push(...(await dropFolderValuesAfterMove({ root: vault, oldPath: from, newPath: to, kind, ...before })))
  else if (index.ids) await dropFolderValuesAfterCopy(vault, res.pasted.map(({ to }) => to))
  // Each item that did not land, by its page name; the titles are read only when one did not.
  const titles = res.failed.length === 0 ? undefined : pathTitles(index.records, index.folders)
  const failed = titles === undefined ? [] : res.failed.map((f) => `${pageName(vault, f.from, titles)} — ${f.message}`)
  // A Paste of a Cut is a move gesture (YAZ-3255 S39): its moves and what they cleared go on the undo list.
  const gesture: MovedGesture | null = before === null ? null : { moves: res.pasted.map(({ from, to, kind }) => ({ oldPath: from, newPath: to, kind })), cleared }
  // What landed, by kind and by its name on disk (YAZ-3293 D23): a copy may have a new free name.
  const pasted = res.pasted.map(({ to, kind }) => onDisk(to, kind))
  const text = gestureNotice(res.pasted.length === 0 ? null : `Pasted ${namedItems(pasted)}`, failed, "Couldn't paste")
  // Nothing ran: EVERY entry was a cut into the folder it is already in (skipped silently, D2) — nothing went wrong.
  if (text === null) onNotice('Nothing to paste', 'info')
  else if (res.pasted.length === 0) onNotice(text, 'error')
  // What landed is said with Undo when it was a move (D11). A copy plays its land sound here;
  // a move plays it in App's `onMoved`, so the gesture has ONE sound (YAZ-3267 D15, S54).
  else if (gesture === null) {
    playGestureSound('land')
    // A paste that skipped an item has no type: it shows with Copy toasts off (YAZ-3303 D2).
    onNotice(text, 'paste', unlessFailed('clipboard', res.failed))
  }
  else onMoved(gesture, text, res.failed.length > 0)
  return { gesture, failed }
}
