/**
 * The card skill (YAZ-5059 decision 1, YAZ-5107): a folder of plain pages that ships with the app — `skills/card-skill`
 * in the repo, `Resources/card-skill` in the app — and its copy in the profile, `<userData>/card-skill`, which is the
 * only one the rest of the app uses. The shipped folder is never opened as a vault: a write there can break the app's
 * signature on macOS.
 *
 * The copy is made at the start, before a window opens, and never while the app runs (suggestions 6, 12). It is
 * replaced whole when its `.version` is not the app's version, or when `.version` or a shipped file is missing. Its
 * files are read only on disk (suggestion 8); its folders stay writable, so the next replace can delete the files.
 */
import { createHash } from 'node:crypto'
import { chmod, cp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** The copy's folder in the profile, and the shipped folder's name in `Resources`. */
export const CARD_SKILL_DIR = 'card-skill'
/** The app version the copy was made from, in the copy only (never shipped). */
export const CARD_SKILL_VERSION_FILE = '.version'

/** Where the skill ships: `Resources/card-skill` in the app, `skills/card-skill` in a checkout (found from main's own folder, as `spellerPath`). */
export function shippedCardSkill({ isPackaged, resourcesPath, mainDir }: { isPackaged: boolean; resourcesPath: string; mainDir: string }): string {
  return isPackaged ? join(resourcesPath, CARD_SKILL_DIR) : resolve(mainDir, '..', '..', '..', 'skills', CARD_SKILL_DIR)
}

/** Every file under `root`, by its path from `root` with `/`, in a fixed order. */
async function filesOf(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await filesOf(root, path)))
    else if (entry.isFile()) out.push(path)
  }
  return out.sort()
}

/** Each file under `root` writable (true) or read only (false). A folder that is not there has no files. */
async function setWritable(root: string, writable: boolean): Promise<void> {
  const files = await filesOf(root).catch(() => [])
  await Promise.all(files.map((file) => chmod(join(root, file), writable ? 0o644 : 0o444)))
}

/**
 * The version a checkout passes (`npm run dev`): the app's version and a hash of the shipped files' paths and bytes.
 * An edit of `skills/card-skill` then counts as a new version, so the copy never keeps old text. A packed app passes
 * its plain version.
 */
export async function cardSkillStamp(shipped: string, appVersion: string): Promise<string> {
  const hash = createHash('sha1')
  for (const file of await filesOf(shipped)) hash.update(file).update('\0').update(await readFile(join(shipped, file))).update('\0')
  return `${appVersion}+dev.${hash.digest('hex').slice(0, 12)}`
}

/** True when the copy at `copy` was made from `appVersion` and still has every shipped file. */
async function copyIsCurrent(copy: string, shipped: readonly string[], appVersion: string): Promise<boolean> {
  const version = await readFile(join(copy, CARD_SKILL_VERSION_FILE), 'utf8').catch(() => null)
  if (version !== appVersion) return false
  const present = await Promise.all(shipped.map((file) => stat(join(copy, file)).then((s) => s.isFile(), () => false)))
  return present.every(Boolean)
}

/**
 * The copy the app shows, `<userData>/card-skill`, made from `shipped` when it is not current. The new copy is made
 * beside the old one (`.version` written last), then it takes the old one's place: a failed copy leaves the old copy
 * as it was. A shipped folder that is not there is refused.
 */
export async function ensureCardSkill(userData: string, shipped: string, appVersion: string): Promise<string> {
  const copy = join(userData, CARD_SKILL_DIR)
  const files = await filesOf(shipped)
  if (await copyIsCurrent(copy, files, appVersion)) return copy
  const next = `${copy}.new-${process.pid}`
  await rm(next, { recursive: true, force: true })
  try {
    await cp(shipped, next, { recursive: true })
    await writeFile(join(next, CARD_SKILL_VERSION_FILE), appVersion)
    await setWritable(next, false)
    // Windows does not delete a read-only file: the old copy's files are made writable first.
    await setWritable(copy, true)
    await rm(copy, { recursive: true, force: true })
    await rename(next, copy)
  } catch (err) {
    await setWritable(next, true)
    await rm(next, { recursive: true, force: true })
    throw err
  }
  return copy
}
