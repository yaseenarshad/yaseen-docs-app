/**
 * S6 (YAZ-3696): the speed of a big page table on the real editor in jsdom — open a 500 × 10 table, type in a
 * cell, paste 50 × 4 tab-separated cells; then the same table frozen and styled (`freeze 1 row 2 cols, stripes,
 * fill`). jsdom has no layout, so the numbers are the editor's own work (parse, transactions, DOM updates), not
 * paint. Runs in the `perf` project (YAZ-740), each budget on the MEDIAN (`src/test-perf.ts`). The frozen tables'
 * keys are typed in turn with the plain one's, and their ratios to it print. "No change in typing speed" is held by
 * counts, not by this ratio (YAZ-3796): `tableSpeed.test.ts` fails when a key reads layout or does work on the
 * freeze's or the styles' decorations. The measured numbers print, with a plain note of the same text for scale.
 * Last, the same table with a list in one body cell in five, typed in a cell bullet (YAZ-3818 D3); and with 500 cell
 * notes too, typed in a cell bullet of a cell with a mark (YAZ-4263).
 */
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { budgetMs, median } from '../../test-perf'
import { BIG, FROZEN, PLAIN, STYLED, TSV, cellText, clipboard, closeAll, mount, typeAt, typeInTurn } from './tableSpeedKit'

afterEach(closeAll)

describe('S6: a 500 × 10 table stays fast', () => {
  it('perf smoke: opens, types, and pastes 50 × 4 in under 150 ms; frozen and styled, it types as fast', async () => {
    const opens: number[] = []
    const keys = { note: [] as number[], table: [] as number[], frozen: [] as number[], styled: [] as number[] }
    const pastes: number[] = []
    const kinds = ['table', 'frozen', 'styled'] as const
    // Three runs. In each, the three tables are open at once and take their keys in turn.
    for (let run = 0; run < 3; run++) {
      const note = await mount(PLAIN)
      keys.note.push(typeAt(note.view, 300).median)
      await note.close()
      const tables = []
      for (const kind of kinds) tables.push(await mount({ table: BIG, frozen: FROZEN, styled: STYLED }[kind]))
      opens.push(tables[0]!.ms)
      typeInTurn(tables.map((t) => t.view)).forEach((ms, k) => keys[kinds[k]!].push(...ms))
      const { view } = tables[0]!
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellText(view.state.doc, 100, 2))))
      const start = performance.now()
      view.pasteText(TSV, clipboard(TSV))
      pastes.push(performance.now() - start)
      for (const t of tables) await t.close()
    }
    const [note, table, frozen, styled, paste] = [median(keys.note), median(keys.table), median(keys.frozen), median(keys.styled), median(pastes)]
    console.log(
      `S6: open ${median(opens).toFixed(0)} ms · type ms/key: note ${note.toFixed(2)}, table ${table.toFixed(2)}, frozen table ${frozen.toFixed(2)}, frozen styled table ${styled.toFixed(2)} (medians of 48 keys, typed in turn; ratios ${(frozen / table).toFixed(2)} / ${(styled / table).toFixed(2)}) · paste 50×4 ${paste.toFixed(1)} ms (median of 3, jsdom)`,
    )
    // The note is for the log: a table types slower than a note of the same text (its cells are nodes, and the table
    // plugins map their decorations on each key). Milkdown's `keepTableAlignPlugin`, which once walked every cell per
    // key, is removed in `createCrepe.ts` (YAZ-4869 item 26). 60 ms catches a rescan of our own.
    expect(table).toBeLessThan(budgetMs(60))
    // The ratios only print (YAZ-3796): the round-1 freeze cost 1.17–1.24, and a loaded machine reached 1.21 with
    // the fix, so no time ceiling tells them apart. `tableSpeed.test.ts` holds "no change in typing speed" (YAZ-3790)
    // by counts; the 60 ms ceiling above still catches a gross cost in a frozen table.
    expect(frozen).toBeLessThan(budgetMs(60))
    expect(styled).toBeLessThan(budgetMs(60))
    // The approved number (YAZ-3697): ~15 ms measured. The GitHub runner takes 60–87 ms (jsdom) since PR #219, and a
    // loaded Mac 115 ms, so 50 failed every CI run on `main` (YAZ-3743, Yaseen's OK). 150 ms still catches a rescan of
    // the table per pasted cell, which costs seconds.
    expect(paste).toBeLessThan(budgetMs(150))
  }, 120_000)
})
