/**
 * "Copy ID" (YAZ-2293), the one body behind every surface that offers it — the sidebar row, the
 * tab, a view's page menu, an id link's right-click: exactly the note's id on the clipboard, said
 * through the app's passive notice either way.
 */
export function copyNoteId(id: string, onNotice?: (message: string) => void): void {
  void navigator.clipboard.writeText(id).then(
    () => onNotice?.('Copied ID'),
    (error: unknown) => onNotice?.(`Can't copy ID: ${error instanceof Error ? error.message : String(error)}`),
  )
}
