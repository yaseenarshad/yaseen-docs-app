/**
 * The macOS file list on the system clipboard (YAZ-3265 D13): `NSFilenamesPboardType`, a plist of
 * paths, what Finder's Copy writes and its Paste reads. Electron's `clipboard` is a stand-in here,
 * an in-memory pasteboard: no test touches the real one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clipboard } from 'electron'
import { FILENAMES_TYPE, readOsFiles, writeOsFiles } from './osFileClipboard'

/** The stand-in pasteboard: one value per type, as `read` / `writeBuffer` see it. */
const board = vi.hoisted(() => new Map<string, string>())
vi.mock('electron', () => ({
  clipboard: {
    read: vi.fn((type: string) => board.get(type) ?? ''),
    writeBuffer: vi.fn((type: string, buffer: Buffer) => {
      board.clear() // a write replaces what was there, as on the Mac
      board.set(type, buffer.toString('utf8'))
    }),
  },
}))

const platform = process.platform
const onPlatform = (value: string) => Object.defineProperty(process, 'platform', { value })
afterEach(() => {
  onPlatform(platform)
  board.clear()
  vi.unstubAllEnvs()
  vi.mocked(clipboard.read).mockClear()
  vi.mocked(clipboard.writeBuffer).mockClear()
})

describe('osFileClipboard (YAZ-3265 D13)', () => {
  it('a write and a read give back the same paths in order: spaces, "&", "<", ">" and quotes survive the XML', () => {
    onPlatform('darwin')
    const paths = ['/Users/me/Downloads/Q3 report.pdf', '/Users/me/R&D <draft> "v2" \'x\'.md', '/Users/me/Trip', '/Users/me/naïve – café.md']
    writeOsFiles(paths)
    expect(clipboard.writeBuffer).toHaveBeenCalledExactlyOnceWith(FILENAMES_TYPE, expect.any(Buffer))
    const xml = board.get(FILENAMES_TYPE) ?? ''
    expect(xml).toContain('<string>/Users/me/R&amp;D &lt;draft&gt; "v2" \'x\'.md</string>')
    expect(readOsFiles()).toEqual(paths)
  })

  it("reads the plist Finder's Copy writes (tabs, a DOCTYPE, character references); no files, or text only, is an empty list", () => {
    onPlatform('darwin')
    board.set(
      FILENAMES_TYPE,
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<array>\n\t<string>/Users/me/a b.md</string>\n\t<string>/Users/me/Tom &amp; Jerry &#38; &#x3C;1&#x3e;</string>\n\t<string>relative.md</string>\n</array>\n</plist>\n',
    )
    // A relative entry is no file the app can paste.
    expect(readOsFiles()).toEqual(['/Users/me/a b.md', '/Users/me/Tom & Jerry & <1>'])
    board.clear()
    board.set('public.utf8-plain-text', 'some text')
    expect(readOsFiles()).toEqual([])
  })

  it('off macOS both are no-ops: nothing is read or written', () => {
    onPlatform('linux')
    writeOsFiles(['/a.md'])
    expect(readOsFiles()).toEqual([])
    expect(clipboard.writeBuffer).not.toHaveBeenCalled()
    expect(clipboard.read).not.toHaveBeenCalled()
  })

  it('under the e2e harness (YASEEN_DOCS_E2E) the system clipboard is never touched: an in-memory pasteboard stands in', () => {
    onPlatform('darwin')
    vi.stubEnv('YASEEN_DOCS_E2E', '1')
    writeOsFiles(['/v/a b.md'])
    expect(readOsFiles()).toEqual(['/v/a b.md'])
    expect(clipboard.writeBuffer).not.toHaveBeenCalled()
    expect(clipboard.read).not.toHaveBeenCalled()
  })
})
