/**
 * One time (YAZ-4094 G4): the page switches that the app state held for pages move into the pages'
 * frontmatter, where the editor now reads them (`shared/pageSwitches.ts`): every `sectionIndents` entry,
 * and the page entries of `tocSwitches`. A code file's `tocSwitches` entry stays — it has no frontmatter.
 *
 * Each page is written first, then its entry leaves the state, so a crash in between only repeats the
 * move on the next launch. The page is the source of truth: a page that already holds the key (as
 * `true` or `false`) is never written, and only loses the entry — so a choice that sync brought from
 * the other Mac, or a toggle after a crash, stays. A page that is gone, or whose block does not parse,
 * loses its entry; a page that cannot be read or written now keeps it for the next launch, and so does
 * a page whose mtime changed between the read and the write (an autosave landed: its text wins).
 */
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { isMarkdown } from '@shared/fileKind'
import { readPageSwitches, writePageSwitch, type PageSwitchKey } from '@shared/pageSwitches'
import type { AppState } from '@shared/types'
import { atomicWrite } from './fs/fsUtils'

export type MovedList = 'sectionIndents' | 'tocSwitches'

export interface PageSwitchStore {
  get(): AppState
  dropPageSwitch(root: string, file: string, list: MovedList): void
}

const KEY_OF: Record<MovedList, PageSwitchKey> = { sectionIndents: 'section-indent', tocSwitches: 'toc' }

const mtimeOf = async (file: string): Promise<number> => (await stat(file)).mtimeMs

export async function movePageSwitches(store: PageSwitchStore, io = { readFile: (file: string) => readFile(file, 'utf8'), mtime: mtimeOf, write: atomicWrite }): Promise<void> {
  for (const [root, folder] of Object.entries(store.get().folders)) {
    for (const list of ['sectionIndents', 'tocSwitches'] as const) {
      for (const [file, on] of Object.entries(folder[list])) {
        if (!isMarkdown(basename(file))) continue
        let content: string
        let read: number
        try {
          read = await io.mtime(file)
          content = await io.readFile(file)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') store.dropPageSwitch(root, file, list)
          continue
        }
        let next: string
        try {
          next = readPageSwitches(content)[KEY_OF[list]] === undefined ? writePageSwitch(content, KEY_OF[list], on) : content
        } catch {
          store.dropPageSwitch(root, file, list)
          continue
        }
        try {
          if (next !== content) {
            if ((await io.mtime(file)) !== read) continue
            await io.write(file, next)
          }
        } catch {
          continue
        }
        store.dropPageSwitch(root, file, list)
      }
    }
  }
}
