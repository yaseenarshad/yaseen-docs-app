/**
 * Shared Electron-free helpers for `cli.ts`, `cardCommands.ts`, and `boardCommands.ts`.
 *
 * Keeps atomic compare-and-set disk writes, heading section placement, vault `.trash` moves,
 * and flag checks in one place so the CLI subcommands never drift.
 */
import { lstat, mkdir, rename } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { lineKinds } from '@shared/fences'
import { isSkipped } from '@shared/fileKind'
import { readFile, writeFile } from '../main/fs/file'
import { BridgeFailure, fsCall } from '../main/fs/fsUtils'
import { readPage } from '../main/vaultIndex/idSweep'

export const str = (flags: Map<string, string | true>, name: string): string | undefined => {
  const v = flags.get(name)
  return typeof v === 'string' ? v : undefined
}

/** Rejects any flag not in `takes`, throwing `makeError` (maps to CLI exit code 2). */
export function onlyFlags(
  verb: string,
  flags: Map<string, string | true>,
  takes: readonly string[],
  makeError: (message: string) => Error,
): void {
  const other = [...flags.keys()].find((flag) => !takes.includes(flag))
  if (other !== undefined) throw makeError(`${verb} does not take ${other}`)
}

/**
 * The renderer's `transformFile` on disk: read, transform, write against the mtime just read;
 * on CONFLICT read again and recompute ONCE. A second conflict throws. A no-op transform
 * writes nothing and returns the bytes as read. `create`: a file that is not there yet reads as
 * empty and the write creates it — a folder's settings file the app has not written yet (YAZ-2290 D1).
 */
export async function transformOnDisk(path: string, transform: (content: string) => string, create = false): Promise<string> {
  let file: { content: string; mtime?: number } = await (create ? readPage : readFile)(path)
  let retried = false
  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return content
    try {
      await writeFile({ path, content, expectedMtime: file.mtime ?? 0 })
      return content
    } catch (err) {
      if (!(err instanceof BridgeFailure) || err.code !== 'CONFLICT' || retried) throw err
      retried = true
      file = await readFile(path)
    }
  }
}

/** Where a new block goes in `body`: end of `--after` heading's section, or end of page. */
export function sectionPlace(body: string, after: string | undefined): number {
  const lines = body.split('\n')
  if (after === undefined) return lines.length
  const want = after.replace(/^#+\s*/, '').trim().toLowerCase()
  const kinds = lineKinds(lines)
  const headings: { at: number; level: number; text: string }[] = []
  lines.forEach((line, at) => {
    // A heading in a code block (or a card/drawing) is the block's own text.
    const h = kinds[at] === 'text' ? /^(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line) : null
    if (h !== null) headings.push({ at, level: h[1].length, text: h[2].trim().toLowerCase() })
  })
  const i = headings.findIndex((h) => h.text === want)
  if (i === -1) throw new Error(`no heading "${after}" on the page`)
  const end = headings.slice(i + 1).find((h) => h.level <= headings[i].level)
  return end === undefined ? lines.length : end.at
}

/**
 * Moves `filePath` into `<root>/.trash/` using `rename` (never `rm`/`unlink`). Never overwrites
 * an existing entry in `.trash` — appends a timestamp/counter suffix on collision. Electron-free.
 */
export async function trashInVault(filePath: string, root: string): Promise<string> {
  const name = basename(filePath)
  if (isSkipped(name)) throw new BridgeFailure('BAD_REQUEST', 'hidden entries cannot be trashed', { path: filePath })
  const trashDir = join(root, '.trash')
  await fsCall(trashDir, () => mkdir(trashDir, { recursive: true }))
  let dest = join(trashDir, name)
  if ((await lstat(dest).catch(() => null)) !== null) {
    const ext = extname(name)
    const stem = ext === '' ? name : name.slice(0, -ext.length)
    const stamp = Date.now()
    for (let n = 0; ; n++) {
      const candidate = join(trashDir, `${stem}-${stamp}${n === 0 ? '' : `-${n}`}${ext}`)
      if ((await lstat(candidate).catch(() => null)) === null) {
        dest = candidate
        break
      }
    }
  }
  await fsCall(filePath, () => rename(filePath, dest))
  return dest
}
