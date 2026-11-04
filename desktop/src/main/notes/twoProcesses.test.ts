/**
 * Two processes of one Mac (the app and the command, or two runs of the command) that make notes at one moment never
 * give two notes one ID (YAZ-4269 5A, found by the checker of YAZ-4291). Each process has its own door (`mint.ts`
 * `doors`), so separate copies of the modules stand for separate processes here. The one-maker lock of a note does not
 * help (its key is the folder and the title, and these notes have other titles): the door's own lock does.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let dir: string
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-4269-two-processes-')))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A fresh copy of `newNote` with its own door: one more process. */
async function aProcess(): Promise<typeof import('./note').newNote> {
  vi.resetModules()
  return (await import('./note')).newNote
}

it('notes made at one moment by four processes of one Mac have four IDs', async () => {
  const root = path.join(dir, 'vault')
  await mkdir(path.join(root, '.yaseendocs'), { recursive: true })
  await writeFile(path.join(root, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: true, letters: 'YAZ' }))
  await mkdir(path.join(root, 'notes'))
  const makers: Awaited<ReturnType<typeof aProcess>>[] = []
  for (let i = 0; i < 4; i++) makers.push(await aProcess())

  await Promise.all(makers.map((newNote, i) => newNote(path.join(root, 'notes'), `Note ${i}`)))

  const names = await readdir(path.join(root, 'notes'))
  const ids = await Promise.all(names.map(async (name) => /^id: (.*)$/m.exec(await readFile(path.join(root, 'notes', name), 'utf8'))?.[1]))
  expect(names).toHaveLength(4)
  expect(new Set(ids).size).toBe(4)
})
