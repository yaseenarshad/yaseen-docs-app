import { join, relative } from 'node:path'
import { stat } from 'node:fs/promises'
import { AutomationFailure } from '@shared/automation'
import { dayOf } from '@shared/calendarDay'
import { MAX_FILE_BYTES, type AppState } from '@shared/types'
import { sanitizeReviewSettings, REVIEW_SETTINGS_FILE } from '@shared/reviews'
import { dueAt, reviewQueue } from '@shared/schedule'
import { dailyNote } from '../notes/daily'
import { readSaved, resolveTarget, scopeRoots } from './resources'
import { createDurable, fsCall } from '../fs/fsUtils'
import { decodeViewOnlyText, writeFile } from '../fs/file'
import { readConfig } from '../vaultConfig'
import { getIndex } from '../vaultIndex/live'

export async function noteCommand(state: AppState, command: string, args: Record<string, unknown>, body: Buffer): Promise<unknown> {
  const { roots } = await scopeRoots(state, { root: args.root as string })
  const root = roots[0]
  if (command.startsWith('daily.')) {
    let day: Date
    try { day = dayOf(args.date as string | undefined) } catch (error) { throw new AutomationFailure('INVALID_INPUT', (error as Error).message) }
    if (!state.settings.dailyNotes) throw new AutomationFailure('DAILY_DISABLED', 'Daily notes are off in Settings.')
    return { note: await dailyNote(root, state.settings, day, command === 'daily.create') }
  }
  if (command === 'review.queue') {
    const folder = args.folder === undefined ? '' : relative(root, await resolveTarget(roots, { path: args.folder as string })).replace(/\\/g, '/')
    const settings = sanitizeReviewSettings(await readConfig(root, REVIEW_SETTINGS_FILE))
    const index = await getIndex(root, { readOnly: true })
    const items = reviewQueue(index.records, settings, Date.now(), folder).map(record => ({ path: record.path, title: record.title, due: dueAt(record, settings) }))
    const offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
    return { root, items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }
  }
  const folder = await resolveTarget(roots, { path: args.folder as string })
  if (!(await stat(folder)).isDirectory()) throw new AutomationFailure('INVALID_INPUT', 'The template belongs to a folder.')
  const path = join(folder, '.template.md')
  if (command === 'template.read') {
    const exists = await stat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    return exists ? { ...await readSaved(path), exists: true } : { path, exists: false, revision: null, source: 'disk' }
  }
  if (body.length > MAX_FILE_BYTES) throw new AutomationFailure('TOO_LARGE', 'The template exceeds the text file size limit.')
  const content = decodeViewOnlyText(body, path)
  if (args.revision === null) await fsCall(path, () => createDurable(path, content))
  else await writeFile({ path, content, expectedRevision: args.revision as string })
  return { ...await readSaved(path), diskSaved: true, rendererMerged: false }
}
