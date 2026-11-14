// Moved out of `editor/linkMenu.ts` (YAZ-5153) so the card screens load without the editor; the link menu gives it out as before.

/**
 * Copies `text` and says so through `onNotice` either way: "Copied path", "Can't copy path: …". `show` puts the copied
 * text in the notice, for a row with no hint (demo M1): "Copied: AR v2 plan (YAS-466)".
 */
export function copyText(text: string, what: string, onNotice: (message: string) => void, copy: (text: string) => Promise<void> | void = (t) => navigator.clipboard.writeText(t), show = false): void {
  const failed = (error: unknown) => onNotice(`Can't copy ${what}: ${error instanceof Error ? error.message : String(error)}`)
  try {
    void Promise.resolve(copy(text)).then(() => onNotice(show ? `Copied: ${text}` : `Copied ${what}`), failed)
  } catch (error) {
    failed(error)
  }
}
