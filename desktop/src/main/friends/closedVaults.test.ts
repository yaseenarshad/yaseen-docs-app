/**
 * YAZ-5252 (Yaseen's delegation: "holds a vault" means "on this Mac"): a vault that counts for friends and is closed is
 * found among the vaults the app knows (recent, open or keyed), by its GitHub remote. Only a real folder at the known
 * place: a symlink is not followed, a folder that is gone or not a repo or of another remote is "not on this Mac".
 */
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { knownClosedVaults, type FolderFacts } from './closedVaults'

let dir: string
// The real path: on macOS the temp folder itself is under a symlink (/var → /private/var), which the rule refuses.
beforeEach(async () => void (dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yd-closed-')))))
afterEach(() => rm(dir, { recursive: true, force: true }))

const remotes = new Map<string, FolderFacts>()
const facts = async (root: string) => remotes.get(root) ?? null

describe('knownClosedVaults (YAZ-5252)', () => {
  it('finds a closed vault by its remote, with a change key of its HEAD and its changed files', async () => {
    const cards = path.join(dir, 'cards')
    await mkdir(cards)
    remotes.set(cards, { remoteUrl: 'git@github.com:Me/Cards.git', head: 'abc', dirty: ['b.md', 'a.md'] })
    const found = await knownClosedVaults([cards], new Set(), facts)
    expect([...found]).toEqual([['me/cards', { root: cards, key: 'abc\na.md\nb.md' }]])
  })

  it('an open vault is not "closed"; a folder that is gone, not a repo, or of another host is not found', async () => {
    const open = path.join(dir, 'open')
    const plain = path.join(dir, 'plain')
    const gitlab = path.join(dir, 'gitlab')
    for (const d of [open, plain, gitlab]) await mkdir(d)
    remotes.set(open, { remoteUrl: 'git@github.com:me/open.git', head: 'a', dirty: [] })
    remotes.set(gitlab, { remoteUrl: 'git@gitlab.com:me/cards.git', head: 'a', dirty: [] })
    const found = await knownClosedVaults([open, plain, gitlab, path.join(dir, 'gone'), 'relative/path'], new Set([open]), facts)
    expect([...found.keys()]).toEqual([])
  })

  it('a known place that is a symlink is not followed (the folder it points to is not read)', async () => {
    const real = path.join(dir, 'real')
    const link = path.join(dir, 'link')
    await mkdir(real)
    await symlink(real, link)
    remotes.set(link, { remoteUrl: 'git@github.com:me/cards.git', head: 'a', dirty: [] })
    remotes.set(real, { remoteUrl: 'git@github.com:me/cards.git', head: 'a', dirty: [] })
    expect([...(await knownClosedVaults([link], new Set(), facts)).keys()]).toEqual([])
  })

  it('a folder inside a symlinked folder is not followed either', async () => {
    const real = path.join(dir, 'real')
    await mkdir(path.join(real, 'inner'), { recursive: true })
    await symlink(real, path.join(dir, 'via'))
    const inner = path.join(dir, 'via', 'inner')
    remotes.set(inner, { remoteUrl: 'git@github.com:me/cards.git', head: 'a', dirty: [] })
    expect([...(await knownClosedVaults([inner], new Set(), facts)).keys()]).toEqual([])
  })
})
