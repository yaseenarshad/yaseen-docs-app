import { describe, expect, it } from 'vitest'
import { commandDefinition, validateInput } from '@shared/automationCommands'

describe('approved exact live-tab navigation', () => {
  it('accepts an explicit live tab identity in navigation.open', () => {
    expect(() => validateInput(commandDefinition('navigation.open').input, {
      window: 'live-window', tab: 'live-tab',
    })).not.toThrow()
  })
})

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTarget } from './resources'
import { _evictAll } from '../vaultIndex/live'

it('returns candidates when duplicate target names need disambiguation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checker-nav-'))
  const candidates = [join(root, 'a.md'), join(root, 'b.md')]
  try {
    await mkdir(join(root, '.yaseendocs'))
    await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'NAV' }))
    await Promise.all(candidates.map((path, i) => writeFile(path, `---\nid: NAV-${i + 1}\ntitle: Duplicate\n---\n`)))
    await expect(resolveTarget([root], { name: 'Duplicate' })).rejects.toMatchObject({
      code: 'AMBIGUOUS_TARGET', details: { candidates: expect.arrayContaining(candidates) },
    })
  } finally {
    _evictAll()
    await rm(root, { recursive: true, force: true })
  }
})
