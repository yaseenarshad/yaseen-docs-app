/**
 * "Duplicate into <vault>…" (YAZ-5059 decision 5, YAZ-5109): the app's copy of the card skill, copied into the top of a
 * vault as `Card skill` — the folder `cardSkillFolder` then picks over the app's copy (suggestion 18). The copy is the
 * person's: every file writable, no `.yaseendocs` of its own (else it would be a vault of its own, with IDs off and read
 * only on) and no `.version`. Each page keeps its name and bytes, so `Start here.md` stays where `card guide` reads it.
 * The app's copy is left as it is and keeps its updates; there is no merge.
 *
 * Never over anything: with `Card skill` in the vault the answer is `exists`, and the caller asks first. A second copy
 * (`again`) goes to the next free `Card skill 2`, `Card skill 3`, …; the first stays the one the app uses.
 */
import { chmod, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { CARD_SKILL_FOLDER_NAME, type CardSkillDuplicate } from '@shared/cardSkillFolder'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { CARD_SKILL_VERSION_FILE } from './cardSkill'

const there = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

/** Each file under `dir` writable (0644): the app's copy is read only on disk (suggestion 8), the duplicate is not. */
async function writable(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) await writable(p)
    else if (entry.isFile()) await chmod(p, 0o644)
  }
}

/**
 * Copies `appCopy` into `vault` as `Card skill`; with `again`, as the next free `Card skill N` when `Card skill` is
 * there. The folder is made first (`mkdir`, never over anything), then filled; a copy that fails removes what it made.
 */
export async function duplicateCardSkill(appCopy: string, vault: string, again = false): Promise<CardSkillDuplicate> {
  if (!(await there(appCopy))) throw Object.assign(new Error(`no card skill at ${appCopy}`), { code: 'ENOENT', path: appCopy })
  const first = path.join(vault, CARD_SKILL_FOLDER_NAME)
  let to = first
  if (await there(first)) {
    if (!again) return { exists: first }
    for (let n = 2; await there(to); n++) to = path.join(vault, `${CARD_SKILL_FOLDER_NAME} ${n}`)
  }
  await mkdir(to)
  try {
    // The folder is made (above) and its entries copied into it: `cp` of the folder itself would refuse the one just made.
    for (const entry of await readdir(appCopy)) {
      if (entry === VAULT_CONFIG_DIR || entry === CARD_SKILL_VERSION_FILE) continue
      await cp(path.join(appCopy, entry), path.join(to, entry), { recursive: true, force: false, errorOnExist: true })
    }
    await writable(to)
  } catch (err) {
    await writable(to).catch(() => undefined)
    await rm(to, { recursive: true, force: true })
    throw err
  }
  return { made: to }
}
