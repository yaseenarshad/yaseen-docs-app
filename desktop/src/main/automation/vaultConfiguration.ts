import { AutomationFailure, pageOf } from '@shared/automation'
import { stat } from 'node:fs/promises'
import { getNewPlaces, patchNewPlace } from '../newPlaces'
import { isRecord } from '@shared/guards'
import { sanitizeReviewSettings } from '@shared/reviews'
import { isHeadingStyle, isTextStyle } from '@shared/textFormatting'
import { isLineDefaults } from '@shared/line'
import { HEADING_KEYS, type AppState } from '@shared/types'
import { iconMatcher, pickableIconIds } from '@shared/vaultIcons'
import { getProperties, patchProperty, removeProperty } from '../properties'
import { getIcons, patchIcons } from '../icons'
import { patchConfig, readConfigDetailed } from '../vaultConfig'
import { scopeRoots, resolveTarget, absolute } from './resources'

let shipped: Promise<ReadonlySet<string>> | undefined
/** Material's icon ids, as the app ships them: loaded on the first icon command, then kept. */
export const shippedIcons = () => shipped ??= import('@shared/materialIconData').then(data => new Set(data.MATERIAL_IDS.split(' ')))
/** The picker offers only icons the app ships; a CLI name must be one too (YAZ-4518). */
export async function requireShippedIcon(icon: string) {
  if (!(await shippedIcons()).has(icon)) throw new AutomationFailure('INVALID_INPUT', `The app ships no icon named ${icon}. Run icon.names to find one.`)
}

function patchPublic(name: string, current: unknown, changes: Record<string, unknown>) {
  if (current !== null && !isRecord(current)) throw new AutomationFailure('INVALID_CONFIG', 'The existing configuration is not an object.')
  const next = { ...current as Record<string, unknown> }
  if (name === 'review.json') {
    for (const [key, value] of Object.entries(changes)) {
      if (!['algorithm', 'enabled', 'baseDays', 'growth', 'maxDays', 'reviewByDefault'].includes(key)) throw new AutomationFailure('INVALID_INPUT', 'Unknown review setting.')
      if (value === null) delete next[key]; else next[key] = value
    }
    const clean = sanitizeReviewSettings(next)
    for (const [key, value] of Object.entries(next)) if (Object.hasOwn(clean, key) && clean[key as keyof typeof clean] !== value) throw new AutomationFailure('INVALID_INPUT', 'A review setting is invalid or conflicts with another value.')
  } else {
    if (next.version !== undefined && next.version !== 1) throw new AutomationFailure('INVALID_CONFIG', 'This text-formatting version cannot be changed by this app.')
    for (const [key, value] of Object.entries(changes)) {
      const check = key === 'text' ? isTextStyle : key === 'line' ? isLineDefaults : (HEADING_KEYS as readonly string[]).includes(key) ? isHeadingStyle : undefined
      if (!check) throw new AutomationFailure('INVALID_INPUT', 'Unknown text-formatting setting.')
      if (value === null) { delete next[key]; continue }
      if (!isRecord(value)) throw new AutomationFailure('INVALID_INPUT', 'A formatting patch must be an object or null.')
      const merged = { ...(isRecord(next[key]) ? next[key] : {}), ...value }
      for (const [field, value] of Object.entries(merged)) if (value === null) delete merged[field]
      if (!check(merged)) throw new AutomationFailure('INVALID_INPUT', 'A text-formatting field is invalid.')
      next[key] = merged
    }
    next.version = 1
  }
  return next
}
export async function vaultConfiguration(state: AppState, command: string, args: Record<string, unknown>) {
  if (command === 'icon.names') return pageOf(pickableIconIds(await shippedIcons()).sort().filter(iconMatcher(args.query as string ?? '')), args)
  const { roots: [root] } = await scopeRoots(state, { root: args.root as string })
  if (command === 'newPlace.list') return { root, places: await getNewPlaces(root) }
  if (command === 'newPlace.set') {
    const folder = args.folder === null ? null : await resolveTarget([root], { path: args.folder as string })
    if (folder !== null && !(await stat(folder)).isDirectory()) throw new AutomationFailure('INVALID_INPUT', 'A new place must be a folder.')
    return { root, places: await patchNewPlace(root, args.slot as number, folder), diskSaved: true }
  }
  if (command.startsWith('declaration.')) {
    if (command === 'declaration.patch') await patchProperty(root, args.name as string, args.changes as Record<string, unknown>)
    else if (command === 'declaration.remove') await removeProperty(root, args.name as string)
    const value = await getProperties(root)
    return { root, version: value.version, ...(value.error ? { error: value.error } : {}), ...pageOf(Object.entries(value.properties).map(([name, declaration]) => ({ name, ...declaration })), args), ...(command === 'declaration.list' ? {} : { diskSaved: true }) }
  }
  if (command.startsWith('icon.')) {
    const path = command === 'icon.list' ? undefined : absolute(args.path as string)
    if (command === 'icon.set') { await resolveTarget([root], { path }); await requireShippedIcon(args.icon as string) }
    const value = command === 'icon.list' ? await getIcons(root) : await patchIcons(root, { [path!]: command === 'icon.remove' ? null : args.icon as string })
    return { root, ...pageOf(Object.entries(value.paths).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, icon]) => ({ path, icon })), args), ...(command === 'icon.list' ? {} : { diskSaved: true }) }
  }
  const name = args.name as string
  if (!['review.json', 'text-formatting.json'].includes(name)) throw new AutomationFailure('INVALID_INPUT', 'Use a named command for this configuration area.')
  if (command === 'vaultConfig.patch') return { root, name, value: await patchConfig(root, name, current => patchPublic(name, current, args.changes as Record<string, unknown>)), diskSaved: true }
  const value = await readConfigDetailed(root, name)
  if (value.state === 'malformed') throw new AutomationFailure('INVALID_CONFIG', 'The configuration is malformed.')
  return { root, name, value: value.state === 'ok' ? value.value : null }
}
