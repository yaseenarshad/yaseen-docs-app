import { readFile, stat } from 'node:fs/promises'
import { MAX_PDF_BYTES, type PdfResponse } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

/** Read-only binary boundary used only by Chromium's native PDF viewer. */
export async function readPdf(path: string): Promise<PdfResponse> {
  const p = requireAbsPath(path, 'path')
  if (fileKind(p) !== 'pdf') {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only PDF files can be read as PDF', { path: p })
  }

  return fsCall(p, async () => {
    const st = await stat(p)
    if (!st.isFile()) throw new BridgeFailure('NOT_A_FILE', 'expected a file', { path: p })
    if (st.size > MAX_PDF_BYTES) {
      throw new BridgeFailure('TOO_LARGE', `PDF exceeds ${MAX_PDF_BYTES} bytes`, { path: p })
    }
    const bytes = await readFile(p)
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new BridgeFailure('TOO_LARGE', `PDF exceeds ${MAX_PDF_BYTES} bytes`, { path: p })
    }
    return { path: p, data: new Uint8Array(bytes), mtime: st.mtimeMs, size: bytes.byteLength }
  })
}
