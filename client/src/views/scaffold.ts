import { createPage as birth, folderPath, type PageDisk, type Seed } from '@shared/pageBirth'
import type { IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { typedFolders } from '@shared/linkResolver'

export { folderPath }

/** The renderer's disk for `@shared/pageBirth` (YAZ-4269 D1): the bridge. A missing template is null; any other read failure propagates. */
export const bridgeDisk: PageDisk = {
  read: (path) =>
    api.readFile(path).then(
      (file) => file.content,
      (err: unknown) => {
        if (!(err instanceof BridgeRequestError && err.code === 'NOT_FOUND')) throw err
        return null
      },
    ),
  createFile: (req) => api.createFile(req),
  createDir: (req) => api.createDir(req),
  mintId: (path) => takePageId(path),
  isThere: (err) => err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS',
}

/** Birth of a page (`@shared/pageBirth` `createPage`, where its rules are told) over the bridge. Every caller in the app keeps this call. */
export const createPage = (dir: string, title: string, ids: boolean, seed?: Seed, id?: string, templateAt?: string): Promise<string> => birth(bridgeDisk, dir, title, ids, seed, id, templateAt)

/**
 * The next ID of the vault that holds `path`, from the door in the main process (`fs:mint-page-id`,
 * YAZ-2677 🔒 D4): the ONE way the front end gets an ID. The number is saved before it comes back,
 * so one that is then not used is a gap. Refused where the vault does not use IDs: a window one
 * answer behind makes nothing.
 */
export async function takePageId(path: string): Promise<string> {
  const id = await api.mintPageId(path)
  if (id === null) throw new Error('this vault does not use IDs')
  return id
}

/**
 * Create `<root>/<folder>` level by level (existing levels tolerated); resolves the absolute dir.
 * `folders`, the index's as it stands, when `folder` is typed text and not a path on disk: each
 * level is then a folder's title. A level that names a folder already there is that folder
 * (`typedFolders`, YAZ-2478); only one that names none is made, as "New folder" makes it
 * (`folderPath`). The dir resolved is the one that was reached.
 */
export async function ensureFolder(root: string, folder: string, folders?: readonly IndexRecord[]): Promise<string> {
  const titled = folders !== undefined
  const held = titled ? typedFolders(folders) : undefined
  let dir = root
  for (const segment of folder.split('/').filter((s) => s !== '')) {
    const found = held?.(dir.slice(root.length + 1), segment)
    if (found !== undefined) {
      dir = `${root}/${found}`
      continue
    }
    dir = titled ? folderPath(dir, segment, true) : `${dir}/${segment}`
    try {
      await api.createDir(titled ? { path: dir, title: segment } : { path: dir })
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  return dir
}
