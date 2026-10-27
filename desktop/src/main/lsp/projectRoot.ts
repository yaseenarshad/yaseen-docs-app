import path from 'node:path'

/**
 * The project of a file (YAZ-3454, YAZ-3455): the nearest folder above it that holds one of
 * `markers`. A helper works in that folder, with the project's own settings and libraries.
 *
 * The walk never takes a folder in `skip` — the home folder: a stray `~/package.json` must not make
 * every file under it one project. Null when no folder up to the disk root has a marker.
 */
export function findProjectRoot(file: string, markers: readonly string[], exists: (p: string) => boolean, skip: readonly string[] = []): string | null {
  const skipped = new Set(skip.map((s) => path.resolve(s)))
  for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
    if (!skipped.has(dir) && markers.some((m) => exists(path.join(dir, m)))) return dir
    if (path.dirname(dir) === dir) return null
  }
}

/** True when `file` is `folder` or inside it. */
export function isInside(file: string, folder: string): boolean {
  const rel = path.relative(path.resolve(folder), path.resolve(file))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
