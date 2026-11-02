/**
 * PDF EXPORT (YAZ-3943 D6): the export box's PDF button. The engine hands its export as an SVG — the
 * fonts and the pictures inline (`exportToSvg`) — and its size; main draws it in a HIDDEN window and
 * asks Chromium for the PDF, so text stays text and the file stays small.
 *
 * ONE PAGE THE SIZE OF THE DRAWING: the SVG's CSS pixels at 96 to the inch, no margins, the background
 * printed. Chromium and the PDF format stop at 200 inches a side, so a bigger drawing scales the whole
 * page down to fit — never cut (`pdfPageSize`).
 *
 * ONE HIDDEN WINDOW FOR EACH EXPORT, destroyed in a `finally`, at the latest after 60 s (YAZ-4074 6A
 * item 10): sandboxed, no preload, no Node, never shown. It loads a small `data:` page; the SVG goes in by script, because Chromium refuses a URL over
 * 2 MB and a drawing with pictures is often more. The print waits for the fonts (`document.fonts.ready`)
 * and for each picture to decode.
 */
import { BrowserWindow } from 'electron'

/** The largest side of a page, in inches (14 400 points: the PDF format's own limit). */
export const MAX_PDF_INCHES = 200
const CSS_PX_PER_INCH = 96

/** The page for a drawing of `size` CSS pixels, in inches: its own size, scaled down to fit when a side passes 200 inches. */
export function pdfPageSize(size: { width: number; height: number }): { width: number; height: number } {
  const width = size.width / CSS_PX_PER_INCH
  const height = size.height / CSS_PX_PER_INCH
  const scale = Math.min(1, MAX_PDF_INCHES / Math.max(width, height))
  return { width: width * scale, height: height * scale }
}

/** The page the window loads first: no margin, and whatever SVG goes in fills it exactly. */
const SHELL = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body></body></html>'

/** The script that puts the SVG in and answers once its fonts and pictures are ready to print. */
function placeSvg(svg: string): string {
  return `(async () => {
    document.body.innerHTML = ${JSON.stringify(svg)};
    document.body.getBoundingClientRect();
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('image')].map((el) => {
      const img = new Image();
      img.src = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
      return img.decode().catch(() => undefined);
    }));
  })()`
}

/** What the export needs of a window: tests hand a fake one. */
export type PdfWindow = Pick<BrowserWindow, 'loadURL' | 'destroy'> & { webContents: Pick<BrowserWindow['webContents'], 'executeJavaScript' | 'printToPDF'> }

const hiddenWindow = (): PdfWindow =>
  new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, backgroundThrottling: false } })

/** YAZ-4074 6A item 10: a hidden window that never answers fails the export here, and is destroyed. */
export const PDF_TIMEOUT_MS = 60_000

/** The PDF bytes of one SVG (see the module doc). The window is destroyed whatever happens, at the latest after `PDF_TIMEOUT_MS`. */
export async function printSvgToPdf(svg: string, size: { width: number; height: number }, makeWindow: () => PdfWindow = hiddenWindow): Promise<Buffer> {
  const pageSize = pdfPageSize(size)
  const win = makeWindow()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The PDF print did not answer in ${PDF_TIMEOUT_MS / 1000} s.`)), PDF_TIMEOUT_MS)
  })
  const print = async (): Promise<Buffer> => {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SHELL)}`)
    await win.webContents.executeJavaScript(placeSvg(svg))
    return win.webContents.printToPDF({ pageSize, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true, pageRanges: '1' })
  }
  try {
    return await Promise.race([print(), timeout])
  } finally {
    clearTimeout(timer)
    win.destroy()
  }
}
