/**
 * YAZ-5589: the texts of the pages and cards read last or read ahead (phone memory only), so a page, a card file or a
 * panel that opens draws its text in the SAME frame as the tap (the stored file is read again at once after; a change
 * draws again). Read ahead by `primePage` (`PageView.tsx`): before an open (`openReady.ts`), the arrows' pages and the
 * links of the page on the screen once the app is idle, Today's page.
 */
const texts = new Map<string, string>()
/** At most this many texts, and about this many characters in all: the oldest go first. */
const MOST = 48
const MOST_CHARS = 2_000_000
let chars = 0

const key = (vault: string, path: string) => `${vault}\n${path}`

export function heldText(vault: string, path: string): string | undefined {
  return texts.get(key(vault, path))
}

export function holdText(vault: string, path: string, text: string): void {
  const k = key(vault, path)
  const old = texts.get(k)
  if (old !== undefined) chars -= old.length
  texts.delete(k)
  texts.set(k, text)
  chars += text.length
  while (texts.size > 1 && (texts.size > MOST || chars > MOST_CHARS)) {
    const first = texts.keys().next().value!
    chars -= texts.get(first)!.length
    texts.delete(first)
  }
}

/** A file deleted or not on the phone: its text goes. */
export function dropText(vault: string, path: string): void {
  const k = key(vault, path)
  const old = texts.get(k)
  if (old === undefined) return
  chars -= old.length
  texts.delete(k)
}

/** Every text (a sync change with no list of its files). */
export function dropAllTexts(): void {
  texts.clear()
  chars = 0
}
