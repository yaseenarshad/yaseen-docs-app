/**
 * The macOS file list on the system clipboard (YAZ-3265 D13): `NSFilenamesPboardType`, a plist of
 * paths, what Finder's Copy writes and its Paste reads. Electron's `clipboard` is a stand-in here,
 * an in-memory pasteboard: no test touches the real one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clipboard } from 'electron'
import { FILENAMES_MIME, osFiles, readOsFiles, writeOsFiles } from './osFileClipboard'

/** The stand-in pasteboard: one value per MIME type, as Electron 45+ `clipboard.read` / `write` see it. */
const board = vi.hoisted(() => new Map<string, string>())
vi.mock('electron', () => {
  class FakeClipboardItem {
    readonly items: Record<string, string | Blob>
    constructor(items: Record<string, string | Blob>) {
      this.items = items
    }
    get types(): string[] {
      return Object.keys(this.items)
    }
    async getType(type: string): Promise<Blob> {
      const value = this.items[type]
      if (value === undefined) throw new Error(`missing type ${type}`)
      return typeof value === 'string' ? new Blob([value]) : value
    }
  }
  return {
    ClipboardItem: FakeClipboardItem,
    clipboard: {
      read: vi.fn(async () =>
        board.size === 0 ? [] : [new FakeClipboardItem(Object.fromEntries(board.entries()))],
      ),
      clear: vi.fn(() => board.clear()),
      write: vi.fn(async (items: FakeClipboardItem[]) => {
        board.clear() // a write replaces what was there, as on the Mac
        for (const item of items) {
          for (const type of item.types) {
            const blob = await item.getType(type)
            board.set(type, await blob.text())
          }
        }
      }),
    },
  }
})

const platform = process.platform
const onPlatform = (value: string) => Object.defineProperty(process, 'platform', { value })
afterEach(() => {
  onPlatform(platform)
  board.clear()
  vi.unstubAllEnvs()
  vi.mocked(clipboard.read).mockClear()
  vi.mocked(clipboard.write).mockClear()
})

describe('osFileClipboard (YAZ-3265 D13)', () => {
  it('a write and a read give back the same paths in order: spaces, "&", "<", ">" and quotes survive the XML', async () => {
    onPlatform('darwin')
    const paths = ['/Users/me/Downloads/Q3 report.pdf', '/Users/me/R&D <draft> "v2" \'x\'.md', '/Users/me/Trip', '/Users/me/naïve – café.md']
    await writeOsFiles(paths)
    expect(clipboard.write).toHaveBeenCalledOnce()
    const xml = board.get(FILENAMES_MIME) ?? ''
    expect(xml).toContain('<string>/Users/me/R&amp;D &lt;draft&gt; "v2" \'x\'.md</string>')
    expect(await readOsFiles()).toEqual(paths)
  })

  it("reads the plist Finder's Copy writes (tabs, a DOCTYPE, character references); no files, or text only, is an empty list", async () => {
    onPlatform('darwin')
    board.set(
      FILENAMES_MIME,
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<array>\n\t<string>/Users/me/a b.md</string>\n\t<string>/Users/me/Tom &amp; Jerry &#38; &#x3C;1&#x3e;</string>\n\t<string>relative.md</string>\n</array>\n</plist>\n',
    )
    // A relative entry is no file the app can paste.
    expect(await readOsFiles()).toEqual(['/Users/me/a b.md', '/Users/me/Tom & Jerry & <1>'])
    board.clear()
    board.set('text/plain', 'some text')
    expect(await readOsFiles()).toEqual([])
  })

  it('off macOS both are no-ops: nothing is read or written, and the app cannot know the system clipboard (YAZ-4372)', async () => {
    onPlatform('linux')
    expect(await writeOsFiles(['/a.md'])).toBe(false)
    expect(await readOsFiles()).toEqual([])
    expect(await osFiles()).toBeNull()
    expect(clipboard.write).not.toHaveBeenCalled()
    expect(clipboard.read).not.toHaveBeenCalled()
  })

  it('YAZ-4372: a write answers whether the system clipboard holds the paths; a failed read is "unknown" (null), a clipboard with no files is an empty list', async () => {
    onPlatform('darwin')
    expect(await writeOsFiles(['/v/a.md'])).toBe(true)
    expect(await osFiles()).toEqual(['/v/a.md'])
    vi.mocked(clipboard.write).mockRejectedValueOnce(new Error('busy'))
    expect(await writeOsFiles(['/v/b.md'])).toBe(false)
    vi.mocked(clipboard.read).mockRejectedValueOnce(new Error('busy'))
    expect(await osFiles()).toBeNull()
    board.clear()
    board.set('image/png', 'picture data')
    expect(await osFiles()).toEqual([])
  })

  it('with YASEEN_DOCS_FAKE_CLIPBOARD (the e2e harness) the system clipboard is never touched: an in-memory pasteboard stands in; YASEEN_DOCS_E2E alone reaches the real one', async () => {
    onPlatform('darwin')
    vi.stubEnv('YASEEN_DOCS_FAKE_CLIPBOARD', '1')
    await writeOsFiles(['/v/a b.md'])
    expect(await readOsFiles()).toEqual(['/v/a b.md'])
    expect(clipboard.write).not.toHaveBeenCalled()
    expect(clipboard.read).not.toHaveBeenCalled()
    // A dev build run by hand keeps YASEEN_DOCS_E2E (no claim of the link handler) and still reads Finder's real clipboard.
    vi.stubEnv('YASEEN_DOCS_FAKE_CLIPBOARD', '')
    vi.stubEnv('YASEEN_DOCS_E2E', '1')
    await readOsFiles()
    expect(clipboard.read).toHaveBeenCalledOnce()
  })
})
