/**
 * One time (YAZ-4094 G4): the page switches that the app state held for notes move into the notes'
 * frontmatter, where the editor now reads them (`shared/pageSwitches.ts`): every `sectionIndents` entry,
 * and the note entries of `tocSwitches`. A code file's `tocSwitches` entry stays — it has no frontmatter.
 *
 * Each note is written first, then its entry leaves the state, so a crash in between only repeats the
 * move on the next launch (the same value again writes nothing). A note that is gone, or whose block
 * does not parse, loses its entry; a note that cannot be read or written now keeps it for the next launch.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { isMarkdown } from '@shared/fileKind'
import { setNotePageSwitch, type PageSwitchKey } from '@shared/pageSwitches'
import type { AppState } from '@shared/types'
import { atomicWrite } from './fs/fsUtils'

export type MovedList = 'sectionIndents' | 'tocSwitches'

export interface PageSwitchStore {
  get(): AppState
  dropPageSwitch(root: string, file: string, list: MovedList): void
}

const KEY_OF: Record<MovedList, PageSwitchKey> = { sectionIndents: 'section-indent', tocSwitches: 'toc' }

export async function movePageSwitches(store: PageSwitchStore, io = { readFile: (file: string) => readFile(file, 'utf8'), write: atomicWrite }): Promise<void> {
  for (const [root, folder] of Object.entries(store.get().folders)) {
    for (const list of ['sectionIndents', 'tocSwitches'] as const) {
      for (const [file, on] of Object.entries(folder[list])) {
        if (!isMarkdown(basename(file))) continue
        let content: string
        try {
          content = await io.readFile(file)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') store.dropPageSwitch(root, file, list)
          continue
        }
        let next: string
        try {
          next = setNotePageSwitch(content, KEY_OF[list], on)
        } catch {
          store.dropPageSwitch(root, file, list)
          continue
        }
        try {
          if (next !== content) await io.write(file, next)
        } catch {
          continue
        }
        store.dropPageSwitch(root, file, list)
      }
    }
  }
}
