import { describe, expect, it, vi } from 'vitest'
import { MAX_PDF_INCHES, pdfPageSize, printSvgToPdf, type PdfWindow } from './printPdf'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

/** YAZ-3943 D6: one page the size of the drawing, printed in a hidden window that never outlives the export. */

describe('pdfPageSize', () => {
  it('is the drawing at 96 CSS pixels to the inch', () => {
    expect(pdfPageSize({ width: 960, height: 480 })).toEqual({ width: 10, height: 5 })
  })

  it('scales the whole page down when a side passes 200 inches, keeping its shape: never cut', () => {
    const wide = pdfPageSize({ width: 400 * 96, height: 100 * 96 })
    expect(wide).toEqual({ width: MAX_PDF_INCHES, height: 50 })
    const tall = pdfPageSize({ width: 30 * 96, height: 600 * 96 })
    expect(tall.height).toBe(MAX_PDF_INCHES)
    expect(tall.width).toBeCloseTo(10)
    expect(pdfPageSize({ width: 200 * 96, height: 1 * 96 })).toEqual({ width: 200, height: 1 })
  })
})

describe('printSvgToPdf', () => {
  function fakeWindow(fail?: 'load' | 'script' | 'print') {
    const win = {
      loadURL: vi.fn(async (url: string) => {
        if (fail === 'load') throw new Error('load failed')
        return url as never
      }),
      destroy: vi.fn(),
      webContents: {
        executeJavaScript: vi.fn(async (_code: string) => {
          if (fail === 'script') throw new Error('script failed')
        }),
        printToPDF: vi.fn(async () => {
          if (fail === 'print') throw new Error('print failed')
          return Buffer.from('%PDF')
        }),
      },
    }
    return win
  }

  it('loads a small data: page, puts the SVG in, prints one page of the drawing\'s size with no margins and the background, then destroys the window', async () => {
    const win = fakeWindow()
    const svg = '<svg width="960" height="480"><text>Hi</text></svg>'
    expect((await printSvgToPdf(svg, { width: 960, height: 480 }, () => win as unknown as PdfWindow)).toString()).toBe('%PDF')
    expect(win.loadURL.mock.calls[0][0]).toMatch(/^data:text\/html;charset=utf-8,/)
    expect(win.loadURL.mock.calls[0][0]).not.toContain('Hi')
    const script = win.webContents.executeJavaScript.mock.calls[0][0] as string
    expect(script).toContain(JSON.stringify(svg))
    expect(script).toContain('document.fonts.ready')
    expect(win.webContents.printToPDF).toHaveBeenCalledWith({ pageSize: { width: 10, height: 5 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true, pageRanges: '1' })
    expect(win.destroy).toHaveBeenCalledTimes(1)
  })

  it.each(['load', 'script', 'print'] as const)('destroys the window when the %s step fails, and the failure reaches the caller', async (step) => {
    const win = fakeWindow(step)
    await expect(printSvgToPdf('<svg/>', { width: 96, height: 96 }, () => win as unknown as PdfWindow)).rejects.toThrow(`${step} failed`)
    expect(win.destroy).toHaveBeenCalledTimes(1)
  })
})
