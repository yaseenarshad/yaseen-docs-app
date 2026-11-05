/**
 * YAZ-4312 N5: the fold arrow types have two copies, one in `shared/types.ts` and one in the engine
 * (`textFoldArrows.ts`), because neither side may import the other. This type test keeps them equal: a mode or a
 * thickness added on one side only fails `npm run typecheck`.
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { FoldArrowPrefs as EngineFoldArrowPrefs } from '@excalidraw/excalidraw'
import type { FoldArrowMode, FoldArrowPrefs, FoldArrowThickness } from '@shared/types'

describe('YAZ-4312 N5: the fold arrow types of shared/ and of the engine', () => {
  it('are the same types', () => {
    expectTypeOf<FoldArrowMode>().toEqualTypeOf<EngineFoldArrowPrefs['openArrows']>()
    expectTypeOf<FoldArrowThickness>().toEqualTypeOf<EngineFoldArrowPrefs['thickness']>()
    expectTypeOf<FoldArrowPrefs>().toEqualTypeOf<EngineFoldArrowPrefs>()
  })
})
