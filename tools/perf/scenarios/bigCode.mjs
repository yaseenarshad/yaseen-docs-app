/**
 * The 5 MB code file of the code tab's two scenarios (`open-big-code`, `typing-code`; YAZ-3501): the
 * demo vault's `speed/big-5mb.ts` shape, 52,000 exported object constants, 260,000 symbols. `codeTab.spec.ts`
 * types into the same shape.
 */
import fs from 'node:fs'
import path from 'node:path'

export const BIG_CODE_LINES = 52_000
export const BIG_CODE_FIRST_LINE = 'export const value0 ='

/** The file's text: a comment, then one constant per line. */
export function bigCodeText(lines = BIG_CODE_LINES) {
  return `// About 5 MB.\n${Array.from({ length: lines }, (_, i) => `export const value${i} = { id: ${i}, name: 'row ${i}', tags: ['alpha', 'beta', 'gamma'], active: ${i % 2 === 0 ? 'false' : 'true'} }`).join('\n')}\n`
}

/** Writes `big-5mb.ts` into `vault` (afresh) and returns its path. */
export function writeBigCode(vault) {
  fs.mkdirSync(vault, { recursive: true })
  const file = path.join(vault, 'big-5mb.ts')
  fs.writeFileSync(file, bigCodeText())
  return file
}

/** In the page: true once the code tab in front shows the file's first constant. */
export const CODE_SHOWN = `(document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .editor--code .view-lines')?.textContent.includes(${JSON.stringify(BIG_CODE_FIRST_LINE)}) ?? false)`
