/**
 * "Copy ID" (YAZ-2293), offered in one place, an id link's right-click (YAZ-2420 🔒 D31): exactly
 * the note's id on the clipboard, said through the app's passive notice either way.
 */
export function copyNoteId(id: string, onNotice?: (message: string) => void): void {
  void navigator.clipboard.writeText(id).then(
    () => onNotice?.('Copied ID'),
    (error: unknown) => onNotice?.(`Can't copy ID: ${error instanceof Error ? error.message : String(error)}`),
  )
}
