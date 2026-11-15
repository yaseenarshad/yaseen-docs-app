import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Where the friends checkers' research tools (`*.research.ts`, `npm run mobile:friends-research`) write their output:
 * `OUT` when it is set, else a folder in the system's temp folder. Never inside the source tree (YAZ-5092 C1): an
 * `OUT` under `mobile/src` is refused.
 */
export function researchOut(): string {
  const dir = resolve(process.env.OUT ?? join(tmpdir(), 'yaseen-docs-friends-research'))
  const src = resolve(import.meta.dirname, '..')
  const rel = relative(src, dir)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error(`OUT is inside the source tree (${dir}); pick a folder outside mobile/src`)
  mkdirSync(dir, { recursive: true })
  return dir
}
