/** S6 with cell lists and 500 cell notes (YAZ-4263): its own file, so a fresh worker (`tableSpeedKit.ts`). */
import { afterEach, describe, expect, it } from 'vitest'
import { budgetMs, median } from '../../test-perf'
import { BIG, NOTED, bulletText, cellText, closeAll, mount, typeInTurn } from './tableSpeedKit'

afterEach(closeAll)

describe('S6: a 500 × 10 table with cell notes stays fast', () => {
  // YAZ-4263: the same lists and 500 cell notes. A key in a cell bullet of a cell with a mark only maps the cell note
  // plugins' state (D12: no placement; `tableSpeed.test.ts` counts it). The plain table takes its keys in turn. The
  // two notes open ONCE for the three runs, as the lists case above.
  it('perf smoke: with lists and 500 cell notes, a key in a cell with a mark stays under 60 ms', async () => {
    const keys = { table: [] as number[], notes: [] as number[] }
    const tables = [await mount(BIG), await mount(NOTED)]
    let count = 0
    tables[1]!.view.state.doc.forEach((node) => void (node.type.name === 'cell_note' && count++))
    expect(count).toBe(500)
    for (let run = 0; run < 3; run++) {
      // Body row 250, column 1: a list and the mark of `cell-250`.
      const [table, notes] = typeInTurn(tables.map((t) => t.view), (doc, v) => (v === 0 ? cellText(doc, 250, 3) : bulletText(doc, 250, 0)))
      keys.table.push(...table!)
      keys.notes.push(...notes!)
    }
    for (const t of tables) await t.close()
    const [table, notes] = [median(keys.table), median(keys.notes)]
    console.log(`S6 cell notes: type ms/key: table ${table.toFixed(2)}, cell bullet in a cell with a mark, in a table with 1,000 cell lists and 500 cell notes ${notes.toFixed(2)} (medians of 48 keys, typed in turn; ratio ${(notes / table).toFixed(2)}, jsdom)`)
    expect(notes).toBeLessThan(budgetMs(60))
  }, 120_000)
})
