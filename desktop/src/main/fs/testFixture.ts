import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _swept } from '../vaultIndex/idSweep'
import { COUNT_DIR, macId, type IdDoor } from '../vaultIndex/mint'
import { BridgeFailure } from './fsUtils'

/** Creates a temp vault that gives its notes IDs (`ids.json` says yes), with Markdown, view-only text/image, a file with no in-app viewer, and hidden entries; caller removes it via `cleanup`. */
export async function makeFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'mdapp-'))
  await mkdir(path.join(root, 'Zeta', 'inner'), { recursive: true })
  await mkdir(path.join(root, 'alpha'), { recursive: true })
  await mkdir(path.join(root, 'Empty'), { recursive: true })
  await mkdir(path.join(root, 'assets-only'), { recursive: true })
  await mkdir(path.join(root, '.obsidian'), { recursive: true })
  await mkdir(path.join(root, '.yaseendocs'), { recursive: true })
  await mkdir(path.join(root, '.git'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, 'b.md'), '# b\n'),
    writeFile(path.join(root, 'A.md'), '# A\n'),
    writeFile(path.join(root, 'notes.txt'), 'not markdown'),
    writeFile(path.join(root, 'book.epub'), 'no in-app viewer'),
    writeFile(path.join(root, '.hidden.md'), 'hidden'),
    writeFile(path.join(root, 'Zeta', 'inner', 'deep.md'), 'deep'),
    writeFile(path.join(root, 'Zeta', 'z.markdown'), 'z'),
    writeFile(path.join(root, 'alpha', 'a.md'), 'a'),
    writeFile(path.join(root, 'assets-only', 'img.png'), 'png'),
    writeFile(path.join(root, '.obsidian', 'workspace.md'), 'ws'),
    writeFile(path.join(root, '.yaseendocs', 'foo.json'), '{"a":1}'),
    writeFile(path.join(root, '.yaseendocs', 'ids.json'), '{"enabled":true}'),
    writeFile(path.join(root, 'node_modules', 'pkg', 'README.md'), 'readme'),
  ])
  return { root, cleanup: () => removeVault(root) }
}

/**
 * A test's vault goes. The sweep is not awaited by the index (it must not hold up a first index), so
 * one can still be writing a `.folder.md` or a count file when the test ends: each sweep of the
 * vault that was started ends first, and only then is the folder removed. Drop the index before
 * (`_evictAll`), so no new event starts one.
 */
export async function removeVault(...roots: string[]): Promise<void> {
  for (const root of roots) {
    await _swept(root)
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
}

/**
 * Everything under `dir`, hidden entries included: each file's text by its path from `dir`, each
 * folder as `<path>/`. What a test compares to prove that nothing else was written (YAZ-2523 🔒 V3).
 */
export async function vaultFiles(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name)
    const rel = path.relative(dir, file)
    if (entry.isDirectory()) out[`${rel}/`] = ''
    else out[rel] = await readFile(file, 'utf8')
  }
  return out
}

/** The `BridgeFailure` a promise rejects with. */
export async function failure(p: Promise<unknown>): Promise<BridgeFailure> {
  try {
    await p
  } catch (err) {
    if (err instanceof BridgeFailure) return err
    throw new Error(`expected a BridgeFailure, got ${String(err)}`)
  }
  throw new Error('expected the promise to reject')
}

/** Polls `pred` every 20 ms until true, or throws after `ms`. */
export async function until(pred: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Resolves once `count()` has not moved for `quietMs` — a recording has gone quiet. */
export async function settled(count: () => number, quietMs: number): Promise<void> {
  let seen = -1
  while (seen !== count()) {
    seen = count()
    await sleep(quietMs)
  }
}

/**
 * A vault's door for a test of what is done WITH an ID (YAZ-2677 D4): the numbers 1, 2, 3 and on
 * with `letters`, and `given`, each ID in the order it was handed out. The door itself, with its
 * count files, is `vaultIndex/mint.test.ts`'s.
 */
export function testDoor(letters = 'YAZ'): IdDoor & { given: string[] } {
  const given: string[] = []
  return {
    letters: [letters],
    given,
    mint: async (count) => {
      const ids = Array.from({ length: count }, (_, i) => `${letters}-${given.length + i + 1}`)
      given.push(...ids)
      return ids
    },
  }
}

/**
 * This Mac is the FIRST Mac of the vault at `root` (YAZ-2677 R33): it holds the oldest count file
 * there, with no number given yet, so the sweep's numbers come at once (R31). A vault with no count
 * file has no first Mac, and every Mac waits.
 */
export async function makeFirstMac(root: string): Promise<void> {
  const dir = path.join(root, '.yaseendocs', COUNT_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${await macId(root)}.json`), `${JSON.stringify({ name: 'first', since: new Date(0).toISOString(), last: 0, made: [] })}\n`)
}
