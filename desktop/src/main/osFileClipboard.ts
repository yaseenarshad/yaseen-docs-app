import path from 'node:path'
import { clipboard } from 'electron'

/**
 * The file list on the macOS system clipboard (YAZ-3265 D13): what Finder's Copy writes and its
 * Paste reads. The type is `NSFilenamesPboardType`, a plist array of paths. It carries MANY files;
 * `public.file-url` gives only the first (the "Clipboard test" on YAZ-3248), so it is not used.
 *
 * Off macOS both calls are no-ops: the app keeps its own clipboard only, as before. Under the e2e
 * harness (`YASEEN_DOCS_E2E`) an in-memory pasteboard stands in, so a test never writes the real
 * clipboard of the person at the Mac. A clipboard that fails is warned about and read as empty:
 * the app's own clip (`fileClip`) always stands.
 */
export const FILENAMES_TYPE = 'NSFilenamesPboardType'

const XML_OUT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const XML_IN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const escapeXml = (s: string): string => s.replace(/[&<>]/g, (c) => XML_OUT[c])
const unescapeXml = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return XML_IN[ref] ?? whole
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
    return Number.isNaN(code) ? whole : String.fromCodePoint(code)
  })

/** The plist Finder writes for `paths`, in order. */
export function filenamesPlist(paths: readonly string[]): string {
  const items = paths.map((p) => `\t<string>${escapeXml(p)}</string>\n`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<array>\n${items}</array>\n</plist>\n`
}

/** The absolute paths in such a plist, in order; a relative entry is no file and is left out. */
export function parseFilenamesPlist(xml: string): string[] {
  return [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1])).filter((p) => path.isAbsolute(p))
}

/** The in-memory pasteboard of the e2e harness. */
const e2e = globalThis as { e2eOsFiles?: string }
const inE2E = (): boolean => process.env.YASEEN_DOCS_E2E === '1'

/** The files on the system clipboard, absolute and in order; empty off macOS, when it holds no files (text, say), or when the read fails. */
export function readOsFiles(): string[] {
  if (process.platform !== 'darwin') return []
  try {
    return parseFilenamesPlist(inE2E() ? (e2e.e2eOsFiles ?? '') : clipboard.read(FILENAMES_TYPE))
  } catch (err) {
    console.warn(`[osFileClipboard] read failed: ${String(err)}`)
    return []
  }
}

/**
 * Empties the system clipboard when it still holds exactly `paths` (YAZ-3265): a Cut the app pasted
 * moved them, so Finder's Paste would find stale paths. Anything copied there since is left alone.
 */
export function clearOsFiles(paths: readonly string[]): void {
  const now = readOsFiles()
  if (now.length === 0 || now.length !== paths.length || now.some((p, i) => p !== paths[i])) return
  try {
    if (inE2E()) delete e2e.e2eOsFiles
    else clipboard.clear()
  } catch (err) {
    console.warn(`[osFileClipboard] clear failed: ${String(err)}`)
  }
}

/** Puts `paths` on the system clipboard as Finder's Copy would, in place of what was there. */
export function writeOsFiles(paths: readonly string[]): void {
  if (process.platform !== 'darwin') return
  const plist = filenamesPlist(paths)
  try {
    if (inE2E()) e2e.e2eOsFiles = plist
    else clipboard.writeBuffer(FILENAMES_TYPE, Buffer.from(plist, 'utf8'))
  } catch (err) {
    console.warn(`[osFileClipboard] write failed: ${String(err)}`)
  }
}
