import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Creates a temp vault and returns its root; caller removes it via `cleanup`. */
export async function makeFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'mdapp-'))
  await mkdir(path.join(root, 'Zeta', 'inner'), { recursive: true })
  await mkdir(path.join(root, 'alpha'), { recursive: true })
  await mkdir(path.join(root, 'Empty'), { recursive: true })
  await mkdir(path.join(root, 'assets-only'), { recursive: true })
  await mkdir(path.join(root, '.obsidian'), { recursive: true })
  await mkdir(path.join(root, '.git'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, 'b.md'), '# b\n'),
    writeFile(path.join(root, 'A.md'), '# A\n'),
    writeFile(path.join(root, 'notes.txt'), 'not markdown'),
    writeFile(path.join(root, '.hidden.md'), 'hidden'),
    writeFile(path.join(root, 'Zeta', 'inner', 'deep.md'), 'deep'),
    writeFile(path.join(root, 'Zeta', 'z.markdown'), 'z'),
    writeFile(path.join(root, 'alpha', 'a.md'), 'a'),
    writeFile(path.join(root, 'assets-only', 'img.png'), 'png'),
    writeFile(path.join(root, '.obsidian', 'workspace.md'), 'ws'),
    writeFile(path.join(root, 'node_modules', 'pkg', 'README.md'), 'readme'),
  ])
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}
