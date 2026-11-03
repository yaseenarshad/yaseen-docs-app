/**
 * A day's daily note in the vault at `root`, found on disk or made (YAZ-4269 D2). The app's button, when its index has
 * none, and `yaseendocs daily` both come here, so they make one note between them: one maker at a time on this Mac
 * (`onlyOne`), and the daily notes folder is read again INSIDE that turn. A note another process made a moment ago is
 * found, never made again.
 */
import { stat } from 'node:fs/promises'
import { dailyNoteName } from '@shared/dailyNote'
import { dailyNotes, makeDailyNote, type FoundNote } from '@shared/noteBirth'
import { isFolderSettingsPath, type IndexRecord, type SettingsState } from '@shared/types'
import { idVault } from '../vaultIndex/mint'
import { scanAll } from '../vaultIndex/reconcile'
import { fileTitle, scanFile, walk } from '../vaultIndex/scan'
import { noteDisk } from './disk'
import { onlyOne } from './lock'

export type DailySettings = Pick<SettingsState, 'dailyNotes' | 'dailyNoteFolder' | 'dailyNoteFormat' | 'dailyNoteDayFolder'>

/** The notes of the daily notes folder `folder` as the index hands them out: no folder's settings file, and in a vault without IDs the file name is the title (YAZ-2523 V12). */
async function notesIn(root: string, folder: string, ids: boolean): Promise<IndexRecord[]> {
  const files: string[] = []
  await walk(folder, files)
  const records = [...(await scanAll(root, files.filter((file) => !isFolderSettingsPath(file)))).values()]
  return ids ? records : records.map((r) => ({ ...r, title: fileTitle(r) }))
}

/**
 * The note of `day` (the Mac's own day) in the vault at `root`, by the Daily notes settings; made when there is none
 * and `make`, else null. Refused when Daily notes is off or the daily notes folder is not there.
 */
export async function dailyNote(root: string, settings: DailySettings, day: Date, make: boolean): Promise<FoundNote | null> {
  if (!settings.dailyNotes) throw new Error('Daily notes are off. Turn them on in Settings › Files & Links › Daily notes')
  const folder = settings.dailyNoteFolder === '' ? root : `${root}/${settings.dailyNoteFolder}`
  if (!(await stat(folder).catch(() => null))?.isDirectory()) throw new Error(`${root} has no folder "${settings.dailyNoteFolder}". Make it, or change the daily notes folder in Settings › Files & Links`)
  const title = dailyNoteName(settings.dailyNoteFormat, day).trim()
  const idRoot = await idVault(root)
  return onlyOne(`${root}\n${settings.dailyNoteFolder}\n${title}`, async () => {
    // Only the daily notes folder is read, never the vault.
    const records = await notesIn(root, folder, idRoot !== null)
    const [found, ...others] = dailyNotes(records, settings.dailyNoteFolder, title, settings.dailyNoteDayFolder)
    if (found !== undefined) return { path: found, title, id: records.find((r) => r.path === found)?.id ?? null, created: false, others }
    if (!make) return null
    const { disk, ids } = await noteDisk(idRoot)
    const path = await makeDailyNote(disk, root, settings, title, ids)
    return { path, title, id: ids ? ((await scanFile(root, path)).id ?? null) : null, created: true, others: [] }
  })
}
