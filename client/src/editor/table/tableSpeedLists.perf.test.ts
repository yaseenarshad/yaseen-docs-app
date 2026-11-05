/** S6 with a list in one body cell in five (YAZ-3818 D3): its own file, so a fresh worker (`tableSpeedKit.ts`). */
import { afterEach, describe, expect, it } from 'vitest'
import { budgetMs, median } from '../../test-perf'
import { BIG, LISTS, bulletText, cellText, closeAll, mount, typeInTurn } from './tableSpeedKit'

afterEach(closeAll)

describe('S6: a 500 × 10 table with cell lists stays fast', () => {
  // YAZ-3818 D3: 1,000 lists in the cells give the fold scan 1,000 foldable bullets; a key in a cell bullet rescans
  // its own row only (`entriesOfBlock`). The plain table takes its keys in turn, for scale.
  it('perf smoke: with a list in one cell in five, a key in a cell bullet stays under 60 ms', async () => {
    const keys = { table: [] as number[], lists: [] as number[] }
    // Opened once for the three runs, as the cell-notes case below: a table of this size takes hundreds of MB.
    const tables = [await mount(BIG), await mount(LISTS)]
    for (let run = 0; run < 3; run++) {
      const [table, lists] = typeInTurn(tables.map((t) => t.view), (doc, v) => (v === 0 ? cellText(doc, 250, 3) : bulletText(doc, 250, 5)))
      keys.table.push(...table!)
      keys.lists.push(...lists!)
    }
    for (const t of tables) await t.close()
    const [table, lists] = [median(keys.table), median(keys.lists)]
    console.log(`S6 lists: type ms/key: table ${table.toFixed(2)}, cell bullet in a table with 1,000 cell lists ${lists.toFixed(2)} (medians of 48 keys, typed in turn; ratio ${(lists / table).toFixed(2)}, jsdom)`)
    expect(lists).toBeLessThan(budgetMs(60))
  }, 120_000)
})
