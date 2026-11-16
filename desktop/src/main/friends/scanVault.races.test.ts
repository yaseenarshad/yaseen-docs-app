/**
 * CHECKER round 5 (YAZ-5252): the closed-vault scan against the races and links that a path check cannot see.
 * Made-up vaults in temp folders only. Taken into the repo by the builder of the round 5 fixes, with one more test for
 * `O_NOFOLLOW` by itself (the checker's mutation check: no test was red with only `O_NOFOLLOW` taken out).
 */
import { link, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const hook: { beforeOpen: ((p: string) => Promise<void>) | null; afterOpen: ((p: string) => Promise<void>) | null } = { beforeOpen: null, afterOpen: null }
vi.mock('node:fs/promises', async (orig) => {
  const real = (await orig()) as typeof fsp
  return {
    ...real,
    open: async (p: string, flags: number) => {
      if (hook.beforeOpen) await hook.beforeOpen(p)
      const fh = await real.open(p, flags)
      if (hook.afterOpen) await hook.afterOpen(p)
      return fh
    },
  }
})
const { scanClosedVault } = await import('./scanVault')

const R1 = '2026-11-14T13:00:00.000Z good 7s'
let dir: string
beforeEach(async () => void (dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yd-c5-')))))
afterEach(async () => {
  hook.beforeOpen = null
  hook.afterOpen = null
  await rm(dir, { recursive: true, force: true })
})
const page = (n: number, letters = 'WIKI', from = 1) => `# P\n\n${Array.from({ length: n }, (_, i) => `\`\`\`card\nQ ${i}\n\`\`\`\n<!-- card: ${letters}-${from + i}, ${R1} -->\n`).join('\n')}`
async function vault(): Promise<string> {
  const root = path.join(dir, 'vault')
  await mkdir(path.join(root, '.yaseendocs'), { recursive: true })
  await writeFile(path.join(root, '.yaseendocs', 'ids.json'), '{"enabled":true,"letters":"WIKI"}')
  await writeFile(path.join(root, 'Own.md'), page(1))
  return root
}
const count = (r: { vault: unknown }) => ((r.vault as { pages: { cards: unknown[] }[] }).pages ?? []).reduce((s, p) => s + p.cards.length, 0)

it('a HARD link inside the vault to a file outside it: the scan reads it (its card lines are counted)', async () => {
  const root = await vault()
  await mkdir(path.join(dir, 'outside'))
  await writeFile(path.join(dir, 'outside', 'secret.md'), page(5, 'WIKI', 100))
  await link(path.join(dir, 'outside', 'secret.md'), path.join(root, 'Linked.md'))
  const r = await scanClosedVault(root)
  console.log('HARDLINK cards counted:', count(r), '(1 own + 5 from the file outside)')
  expect(count(r)).toBe(6)
})

it('a folder swapped for a symlink just before the open and swapped back just after it: refused only by the inode check', async () => {
  const root = await vault()
  await mkdir(path.join(root, 'sub'))
  await writeFile(path.join(root, 'sub', 'Page.md'), page(1, 'WIKI', 50))
  await mkdir(path.join(dir, 'outside'))
  await writeFile(path.join(dir, 'outside', 'Page.md'), page(7, 'WIKI', 200))
  const target = path.join(root, 'sub', 'Page.md')
  let raced = 0
  hook.beforeOpen = async (p) => {
    if (p !== target || raced > 0) return
    raced++
    await rename(path.join(root, 'sub'), path.join(dir, 'sub.real'))
    await symlink(path.join(dir, 'outside'), path.join(root, 'sub'))
  }
  hook.afterOpen = async (p) => {
    if (p !== target || raced !== 1) return
    raced++
    await rm(path.join(root, 'sub'))
    await rename(path.join(dir, 'sub.real'), path.join(root, 'sub'))
  }
  const got = await scanClosedVault(root).then((r) => ({ ok: true, cards: count(r) }), (e: Error) => ({ ok: false, err: e.name }))
  console.log('RACE', JSON.stringify({ raced, got }))
  expect(raced).toBe(2)
  expect(got.ok).toBe(false)
})

it('a PAGE swapped for a symlink to a device (`/dev/null`) just before the open: refused at the open (`O_NOFOLLOW`), never read as "not a file"', async () => {
  // The walk saw a real file. Without O_NOFOLLOW the open follows the link to a device, which is "not a file": the page
  // is skipped in silence and the vault is counted as if all was well. With it, the open itself refuses the link.
  const root = await vault()
  await writeFile(path.join(root, 'Page.md'), page(2, 'WIKI', 70))
  const target = path.join(root, 'Page.md')
  let swapped = false
  hook.beforeOpen = async (p) => {
    if (p !== target || swapped) return
    swapped = true
    await rename(target, path.join(dir, 'Page.real'))
    await symlink('/dev/null', target)
  }
  const got = await scanClosedVault(root).then((r) => ({ ok: true, cards: count(r) }), (e: Error) => ({ ok: false, err: e.name }))
  expect(swapped).toBe(true)
  expect(got.ok).toBe(false)
})
