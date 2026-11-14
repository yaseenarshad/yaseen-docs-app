/**
 * A day's daily page in the vault at `root`, found on disk or made (YAZ-4269 D2). The app's button, when its index has
 * none, and `yaseendocs daily` both come here, so they make one page between them: one maker at a time on this Mac
 * (`onlyOne`), and the daily pages folder is read again INSIDE that turn. A page another process made a moment ago is
 * found, never made again.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { dailyPageName } from '@shared/dailyPage'
import { isMarkdown } from '@shared/fileKind'
import { dailyPages, dailyPagesFolder, makeDailyPage, type FoundPage } from '@shared/pageBirth'
import type { IndexRecord, SettingsState } from '@shared/types'
import { appDataDir, vaultIds } from '../vaultIndex/mint'
import { scanAll } from '../vaultIndex/reconcile'
import { fileTitle, scanFile } from '../vaultIndex/scan'
import { pageDisk } from './disk'
import { LOCK_DIR, onlyOne } from '../fs/lock'

export type DailySettings = Pick<SettingsState, 'dailyPages' | 'dailyPageFolder' | 'dailyPageFormat' | 'dailyPageDayFolder'> & Partial<Pick<SettingsState, 'commentsHint'>>

/** The Markdown pages of `dir`, never a hidden file (a folder's `.folder.md`, the `.template.md`); its folders apart. */
async function entriesOf(dir: string): Promise<{ pages: string[]; dirs: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const shown = entries.filter((e) => !e.name.startsWith('.'))
  return { pages: shown.filter((e) => e.isFile() && isMarkdown(e.name)).map((e) => path.join(dir, e.name)), dirs: shown.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)) }
}

/**
 * The pages where a day's page can be (`dailyPages`: the daily pages folder and its day folders, one level down), as
 * the index hands them out: in path order, and in a vault without IDs with the file name as the title (YAZ-2523 V12).
 */
async function pagesIn(root: string, folder: string, ids: boolean): Promise<IndexRecord[]> {
  const top = await entriesOf(folder)
  const days = await Promise.all(top.dirs.map(async (dir) => (await entriesOf(dir)).pages))
  const records = [...(await scanAll(root, [...top.pages, ...days.flat()])).values()].sort((a, b) => (a.path < b.path ? -1 : 1))
  return ids ? records : records.map((r) => ({ ...r, title: fileTitle(r) }))
}

/**
 * The page of `day` (the Mac's own day) in the vault at `root`, by the Daily pages settings; made when there is none
 * and `make`, else null. Refused when Daily pages is off or the daily pages folder is not there. The vault's own answer
 * about IDs decides, as the app's index and its door take it (YAZ-2523 V5).
 */
export async function dailyPage(root: string, settings: DailySettings, day: Date, make: boolean): Promise<FoundPage | null> {
  if (!settings.dailyPages) throw new Error('Daily pages are off. Turn them on in Settings › Files & Links › Daily pages')
  if (!(await stat(root).catch(() => null))?.isDirectory()) throw new Error(`no vault folder ${root}`)
  const folder = dailyPagesFolder(root, settings.dailyPageFolder)
  // The real path: a symlink and its target are one lock, for the app and the command alike.
  const real = await realpath(folder).catch(() => null)
  if (real === null || !(await readdir(real).then(() => true, () => false))) throw new Error(`${root} has no folder "${settings.dailyPageFolder}". Make it, or change the daily pages folder in Settings › Files & Links`)
  const title = dailyPageName(settings.dailyPageFormat, day).trim()
  const ids = (await vaultIds(root)).answer === true
  return onlyOne(path.join(appDataDir(), LOCK_DIR), `${real}\n${title}`, async () => {
    const records = await pagesIn(root, folder, ids)
    const [found, ...others] = dailyPages(records, settings.dailyPageFolder, title, settings.dailyPageDayFolder)
    if (found !== undefined) return { path: found, title, id: ids ? (records.find((r) => r.path === found)?.id ?? null) : null, created: false, others }
    if (!make) return null
    const { disk } = await pageDisk(ids ? root : null, settings.commentsHint === true)
    const made = await makeDailyPage(disk, root, settings, title, ids)
    return { path: made, title, id: ids ? ((await scanFile(root, made)).id ?? null) : null, created: true, others: [] }
  })
}
