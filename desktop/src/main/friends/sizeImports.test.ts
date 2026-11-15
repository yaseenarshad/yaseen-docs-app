import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-5509: two shared files are kept light on purpose. `frontmatterSplit.ts` has NO import, so the friends count
 * worker gets `splitFrontmatter` and `keyFold` without the `yaml` library (about 250 KB). `friendStatsFormat.ts` has
 * type imports only, so main's friends code reads and sends the numbers without loading `ts-fsrs` at startup.
 */
const source = (file: string) => readFileSync(fileURLToPath(new URL(`../../../../shared/${file}`, import.meta.url)), 'utf8')
const imports = (text: string) => text.split('\n').filter((line) => /^\s*(import|export)\b[^;]*\bfrom\s+['"]/.test(line) || /^\s*import\s+['"]/.test(line))

describe('light shared files (YAZ-5509)', () => {
  it('frontmatterSplit.ts imports nothing', () => {
    expect(imports(source('frontmatterSplit.ts'))).toEqual([])
  })

  it('friendStatsFormat.ts imports types only', () => {
    expect(imports(source('friendStatsFormat.ts')).filter((line) => !/^\s*import type\b/.test(line))).toEqual([])
  })
})
