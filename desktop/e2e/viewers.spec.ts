/**
 * The VIEW-ONLY viewers against the REAL app (E26, YAZ-1289 — e2e coverage under YAZ-2171): a
 * `.txt`, a `.pdf` and a `.png` in the vault each open in a tab as a read-only viewer
 * (`client/src/viewers/TextViewer.tsx`, `PdfViewer.tsx`, `ImageViewer.tsx`, mounted by
 * `editor/Editor.tsx` on `fileKind`), render something REAL, and leave the bytes on disk alone.
 *
 * WHAT IT PROVES, and why only the real app can: the bytes cross the bridge through the
 * dedicated bounded reads (`readFile` strict text, `readPdf`, `readImage`) and are rendered by
 * CHROMIUM — a `<pre>` for text, the native PDF plugin over an `application/pdf` Blob URL
 * (`plugins: true` in the window's webPreferences), and `createImageBitmap` → one canvas frame.
 * A unit test can render the component over fake bytes; only this checks that the real file on
 * disk arrives, decodes (a canvas sized to the PNG's real dimensions; a PDF frame Chromium
 * accepted) and that opening, closing and quitting never WRITE it (md5 before and after — the
 * "Never" column of the capability table).
 *
 * Same harness as imageRender.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture
 * vault with the three fixtures written in `beforeAll`, `viewers-` screenshots; serial by design.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, fileRow, launchApp, layer, md5, quitApp, seededState, shoot, tabsOf } from './helpers'
import { SMALL_HEIGHT, SMALL_WIDTH, smallPng } from './imageFixtures'

test.describe.configure({ mode: 'serial' })

const TEXT_FILE = 'Notes.txt'
/** Exact whitespace is part of the viewer's contract: two spaces and a tab must survive. */
const TEXT_BODY = 'viewer-text-body  two-spaces\tone-tab\nsecond line'
const PDF_FILE = 'Brief.pdf'
const IMAGE_FILE = 'Pic.png'
const IMAGE_BYTES = smallPng(23)

/**
 * A minimal but WELL-FORMED single-page PDF, xref offsets computed rather than guessed, so the
 * plugin has nothing to repair and a failure to render is the viewer's, not the fixture's.
 */
function tinyPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body))
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page
/** md5 of each fixture as written — the "untouched" baseline steps 4 and 5 compare against. */
let baseline: Record<string, string>
let rootListing: string[]

const fixture = (name: string) => path.join(vault, name)
/** The VISIBLE tab layer — hidden per-tab layers stay mounted (tabs.spec.ts's idiom). */

const snapshot = async (): Promise<Record<string, string>> => ({
  [TEXT_FILE]: await md5(fixture(TEXT_FILE)),
  [PDF_FILE]: await md5(fixture(PDF_FILE)),
  [IMAGE_FILE]: await md5(fixture(IMAGE_FILE)),
})

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'viewers-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await Promise.all([
    writeFile(fixture(TEXT_FILE), TEXT_BODY),
    writeFile(fixture(PDF_FILE), tinyPdf()),
    writeFile(fixture(IMAGE_FILE), IMAGE_BYTES),
  ])
  baseline = await snapshot()
  rootListing = (await readdir(vault)).sort()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a .txt opens as the read-only text viewer with its exact bytes', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  // View-only rows keep their FULL filename (stripExt strips `.md` only) — that is the label clicked.
  await fileRow(win, TEXT_FILE).click()

  const viewer = layer(win).locator('.text-viewer')
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('.text-viewer__name')).toHaveText(TEXT_FILE)
  await expect(viewer.locator('.text-viewer__badge')).toHaveText('Read only')
  const content = viewer.locator('pre.text-viewer__content[role="textbox"][aria-readonly="true"]')
  await expect(content).toHaveText(TEXT_BODY) // `<pre>` keeps the double space and the tab
  await expect(viewer).toHaveAttribute('aria-busy', 'false')
  await expect(layer(win).locator('.ProseMirror')).toHaveCount(0) // no editor was mounted for it
  await expect(tabsOf(win)).toHaveText([TEXT_FILE])
  await shoot(win, 'viewers-01-text')
})

test('step 2 — a .pdf opens in the PDF viewer frame over a blob: URL on the app origin', async () => {
  await fileRow(win, PDF_FILE).click()
  const viewer = layer(win).locator('.pdf-viewer')
  await expect(viewer).toBeVisible()
  const frame = viewer.locator('iframe.pdf-viewer__frame')
  await expect(frame).toBeVisible()
  await expect(frame).toHaveAttribute('title', PDF_FILE)
  // The dedicated bytes became an `application/pdf` Blob URL on the page's OWN origin.
  await expect(frame).toHaveAttribute('src', /^blob:app:\/\/yaseen\//)
  await expect(viewer).toHaveAttribute('aria-busy', 'false')
  await expect(viewer.locator('.pdf-viewer__error')).toHaveCount(0)

  await expect(tabsOf(win)).toHaveText([PDF_FILE]) // a plain click REPLACES the tab (I3)
  await shoot(win, 'viewers-02-pdf')
})

test('step 3 — a .png opens as one decoded canvas frame at the image\'s real size', async () => {
  await fileRow(win, IMAGE_FILE).click()
  const viewer = layer(win).locator('.image-viewer')
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('.image-viewer__name')).toHaveText(IMAGE_FILE)
  await expect(viewer.locator('.image-viewer__badge')).toHaveText('Read only')
  const canvas = viewer.locator('canvas.image-viewer__canvas')
  await expect(canvas).toBeVisible() // `hidden` is dropped only once the frame is painted
  await expect(viewer).toHaveAttribute('aria-busy', 'false')
  await expect(viewer.locator('.image-viewer__error')).toHaveCount(0)
  // The canvas is sized to the DECODED bitmap — the real proof the PNG bytes were decoded.
  await expect.poll(() => canvas.evaluate((el) => [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height])).toEqual([SMALL_WIDTH, SMALL_HEIGHT])
  await expect(canvas).toHaveAttribute('aria-label', IMAGE_FILE)
  await shoot(win, 'viewers-03-image')
})

test('step 4 — closing the viewer tab writes nothing: every fixture is byte-identical', async () => {
  await win.locator('.tabbar__close').click()
  await expect(tabsOf(win)).toHaveCount(0)
  await expect(win.locator('.editor-msg')).toHaveText('Select a file from the sidebar.')
  expect(await snapshot()).toEqual(baseline)
  expect((await readdir(vault)).sort()).toEqual(rootListing) // no sidecar, no temp file, nothing born
  await shoot(win, 'viewers-04-closed')
})

test('step 5 — the real quit path (flush handshake included) leaves them untouched too', async () => {
  // Reopen a viewer so a mounted one is what the close/flush handshake runs over.
  await fileRow(win, TEXT_FILE).click()
  await expect(layer(win).locator('.text-viewer__content')).toHaveText(TEXT_BODY)
  await quitApp(app)
  expect(await snapshot()).toEqual(baseline)
  expect((await readdir(vault)).sort()).toEqual(rootListing)
})
