/**
 * EXPORT DRAWING… (🔒 YAZ-1775 D3, YAZ-1821): the board as a STANDALONE `.excalidraw` — every image it uses
 * embedded in the file — so it opens in upstream Excalidraw, on excalidraw.com, or on anyone
 * else's machine with its pictures intact.
 *
 * Since YAZ-3943 D5 the vault file keeps its pictures inside too (🔒 YAZ-1775 D3, "the vault file never
 * embeds", is reversed), but a "pictures out" board does not, and a file being sent to someone else
 * has no `assets/` folder to point at. So the export still embeds, by itself. It is a SEPARATE
 * document — `drawing:save` is untouched and the vault file is not read, written or renamed by an export.
 *
 * THE FILES MAP IS THE WHOLE CANVAS'S (everything hydrated at load, plus anything
 * pasted or inserted since), because the engine's live map is the only place all of it is in one
 * piece. DELETED ELEMENTS' FILES ARE NOT SENT: an undo can leave an image's bytes in that map long
 * after the element is gone, and shipping them would put a picture the user deleted inside a file
 * they are about to hand to someone. `referencedFileIds` is the same rule the save path uses.
 *
 * ENGINE-BOUND BY DESIGN: `serializeAsJSON` comes in as an argument (`engine.ts`'s lazy rule), so
 * this tests with a stub and names the package nowhere.
 */
import { referencedFileIds } from '@shared/drawingAssets'
import { boardBaseName } from '@shared/fileKind'
import type { ExcalidrawModule } from './engine'

/** The engine value an export needs — the library's OWN writer, the same one a save uses. */
export type ExportEngine = Pick<ExcalidrawModule, 'serializeAsJSON'>
/** What Export Excalidraw Drawing…'s copy needs on top (YAZ-3943 1D1): the engine's font loader and its own measure. */
export type ExportCopyEngine = Pick<ExcalidrawModule, 'serializeAsJSON' | 'restoreElements' | 'Fonts'>

/** What the canvas holds right now: its elements, its appState, and its live image map. */
export interface ExportableScene {
  elements: readonly unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

/** The files a standalone copy has to carry: exactly the ones a LIVE image element names. */
export function embeddedFiles(elements: readonly unknown[], files: Record<string, unknown>): Record<string, unknown> {
  const referenced = referencedFileIds(elements)
  const embedded: Record<string, unknown> = {}
  for (const id of referenced) {
    const entry = files[id]
    // A missing byte is not an error: the board already draws the engine's placeholder for it
    // (🔒 YAZ-1775 D3), and an export that refused because of one would be worse than one that is honest.
    if (entry !== undefined) embedded[id] = entry
  }
  return embedded
}

/**
 * YAZ-3943 D14: the fonts normal Excalidraw offers in its font picker, for a copy that leaves the app.
 * Assistant (10), Inter (11), Roboto (12) and Liberation Serif (13) become Nunito (6); IBM Plex Mono
 * (14) becomes Comic Shanns (8). Every other font stays.
 */
const STANDARD_FONT: Readonly<Record<number, number>> = { 10: 6, 11: 6, 12: 6, 13: 6, 14: 8 }

/** `item` with its `key` font swapped for the standard one; the SAME object when there is nothing to swap. */
function withStandardFont<T>(item: T, key: string): T {
  const font = (item as Record<string, unknown> | null)?.[key]
  const to = typeof font === 'number' ? STANDARD_FONT[font] : undefined
  return to === undefined ? item : { ...item, [key]: to }
}

/**
 * The bytes of the standalone file. `serializeAsJSON(…, 'local')` is the library's own writer — the
 * same one "Save to disk" uses and the same one the vault save uses — so element cleanup and the
 * appState whitelist are its rules, not ours. Two things are ours: the files map above, and a
 * trailing newline, so an exported file and a saved one differ only in what they carry.
 *
 * `standardFonts` (YAZ-3943 D14) is set by Export Excalidraw Drawing… only: the copy gets the standard
 * fonts (`STANDARD_FONT`), so a friend on normal Excalidraw sees readable text. The board's own save,
 * the note embed's sidecar and Share Link never set it and keep their fonts. Per-letter styles (text
 * runs) stay in the copy; normal Excalidraw shows them as plain text.
 */
export function assembleStandaloneScene(engine: ExportEngine, scene: ExportableScene, { standardFonts = false }: { standardFonts?: boolean } = {}): string {
  const elements = standardFonts ? standardFontElements(scene.elements) : scene.elements
  const appState = standardFonts ? withStandardFont(scene.appState, 'currentItemFontFamily') : scene.appState
  return `${engine.serializeAsJSON(elements as never, appState as never, embeddedFiles(scene.elements, scene.files) as never, 'local')}\n`
}

/** The elements with the standard fonts (`STANDARD_FONT`); an element with nothing to swap stays the same object. */
const standardFontElements = (elements: readonly unknown[]): readonly unknown[] => elements.map((el) => withStandardFont(el, 'fontFamily'))

/**
 * Export Excalidraw Drawing…'s copy (YAZ-3943 D14, 1D1): the standard fonts, and each text box MEASURED
 * AGAIN in its new font, so Nunito text does not spill out of a box sized for Inter. The engine's own
 * measure does it (`restoreElements` with `refreshDimensions`, what it runs on a font change), after its
 * font loader has the new fonts in the page: a box measured in a fallback font would be as wrong as
 * before. A font that does not load leaves the boxes as they were. Only this copy is measured; the
 * board, its save and Share Link never pass here.
 */
export async function assembleExportCopy(engine: ExportCopyEngine, scene: ExportableScene): Promise<string> {
  const swapped = standardFontElements(scene.elements)
  let elements: readonly unknown[] = swapped
  if (swapped.some((el, i) => el !== scene.elements[i])) {
    const loaded = await engine.Fonts.loadElementsFonts(swapped as never).then(() => true, () => false)
    if (loaded) elements = engine.restoreElements(swapped as never, null, { refreshDimensions: true }) as readonly unknown[]
  }
  return assembleStandaloneScene(engine, { ...scene, elements }, { standardFonts: true })
}

/** The save dialog's default name: the board's own name, with the extension it is getting back (`pdf` for the PDF button, YAZ-3943 D6). */
export function exportFileName(boardName: string, ext = 'excalidraw'): string {
  const name = boardBaseName(boardName).trim()
  return `${name === '' ? 'Drawing' : name}.${ext}`
}
