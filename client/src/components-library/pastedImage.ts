/**
 * A PICTURE PASTED OR DROPPED INTO THE ADD TAB (YAZ-4157 demo 6M), the emoji app's "add by paste" (D12 of YAZ-2919):
 * ⌘V in the tab, or a drop of an image file on it, makes a component of the picture at its FULL size. A picture
 * pasted on the board is made smaller first (the engine's 1,440 px), so this is the way in for the best copy: a file
 * copied in Finder brings its own bytes (an SVG stays an SVG), and an image copied in a browser comes at its own size.
 *
 * The component is one image element with its bytes embedded, as "Save selection" makes of a picture on the board.
 */
import type { CapturedComponent } from './componentData'
import type { InsertEngine } from '../image-studio/insertShape'

/** The picture types the engine draws; anything else on the clipboard is not a picture to save. */
export const PASTE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

/** How big the picture lands on a board, at most, on its longer side; its bytes keep their full size. */
const PLACED_MAX = 400

/** The first picture of a paste or a drop, and how many there were (one is saved at a time). */
export function pastedImages(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) => PASTE_IMAGE_TYPES.includes(file.type))
}

/**
 * The name box's start (the emoji app's `AddSource.title(fromName:)`): the file name with no extension, `-` and `_`
 * as spaces, no copy mark. A name that says nothing — a paste's "image.png", digits, a code, a camera or screenshot
 * name — starts the box empty.
 */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/ \(\d+\)$/, '')
  const plain = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const says = plain !== '' && !/^\d+$/.test(plain) && !/^[0-9a-f]{16,}$/i.test(plain.replace(/ /g, ''))
  const generic = /^(image|photo|picture|untitled|pasted|clipboard|download|img \d+|screenshot.*|screen shot.*|whatsapp image.*|giphy)$/i.test(plain)
  return says && !generic ? plain : ''
}

const readDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The picture could not be read'))
    reader.readAsDataURL(file)
  })

const naturalSize = (dataURL: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || PLACED_MAX, height: image.naturalHeight || PLACED_MAX })
    image.onerror = () => reject(new Error('That is not a picture this app can show'))
    image.src = dataURL
  })

/** The picture's id: a hash of its bytes, so the same picture twice is one file on a board (🔒 YAZ-1775 D3). */
async function fileIdOf(file: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', await file.arrayBuffer()))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The picture as a component to name and save: one image element, its bytes untouched. */
export async function captureImageFile(engine: Pick<InsertEngine, 'convertToExcalidrawElements'>, file: File): Promise<CapturedComponent> {
  const dataURL = await readDataUrl(file)
  const size = await naturalSize(dataURL)
  const scale = Math.min(1, PLACED_MAX / Math.max(size.width, size.height))
  const fileId = await fileIdOf(file)
  const elements = engine.convertToExcalidrawElements([
    { type: 'image', fileId, status: 'saved', x: 0, y: 0, width: Math.round(size.width * scale), height: Math.round(size.height * scale) } as never,
  ]) as unknown as readonly unknown[]
  return { elements, files: { [fileId]: { id: fileId, mimeType: file.type, dataURL, created: Date.now() } } }
}
