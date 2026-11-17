/**
 * The main process's disk for `@shared/pageBirth` (YAZ-4269 D1): `main/fs` and the vault's door. Electron-free, so the
 * command (`desktop/src/cli`) makes a page by the same rules and through the same create as the app.
 */
import type { PageDisk } from '@shared/pageBirth'
import { createDir, createFile } from '../fs/create'
import { readFile } from '../fs/file'
import { BridgeFailure } from '../fs/fsUtils'
import { doorOf } from '../vaultIndex/mint'

const code = (err: unknown): string | undefined => (err instanceof BridgeFailure ? err.code : undefined)

/** The disk of the vault at `root` — the vault whose IDs a page is in (`idVault`), or null for one that does not use IDs — and whether it gives them. */
export async function pageDisk(root: string | null, hint = false): Promise<{ disk: PageDisk; ids: boolean }> {
  const door = root === null ? null : await doorOf(root)
  const disk: PageDisk = {
    read: (path) =>
      readFile(path).then(
        (file) => file.content,
        (err: unknown) => {
          if (code(err) !== 'NOT_FOUND') throw err
          return null
        },
      ),
    // YAZ-4615 D10: the comment hint, when Settings › Comments says so.
    createFile: (req) => createFile(req, door, { hint }),
    createDir: (req) => createDir(req, door),
    mintId: async () => {
      if (door === null) throw new Error('this vault does not use IDs')
      return (await door.mint(1))[0]
    },
    isThere: (err) => code(err) === 'ALREADY_EXISTS',
  }
  return { disk, ids: door !== null }
}
