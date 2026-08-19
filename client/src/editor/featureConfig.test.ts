/**
 * Guard for the Crepe feature allowlist (GRO-2014): every `CrepeFeature` is classified exactly
 * once, and the editor `createCrepe()` actually builds loads exactly `ENABLED_FEATURES` —
 * flipping a feature anywhere else (e.g. in createCrepe.ts) turns this red.
 */
import { describe, expect, it } from 'vitest'
import { CrepeFeature, useCrepeFeatures } from '@milkdown/crepe'
import { createCrepe } from './createCrepe'
import { DISABLED_FEATURES, ENABLED_FEATURES, features } from './featureConfig'

const sorted = (xs: readonly string[]) => [...xs].sort()
const ALL_FEATURES = Object.values(CrepeFeature)

describe('Crepe feature allowlist', () => {
  it('classifies every CrepeFeature exactly once', () => {
    expect(sorted([...ENABLED_FEATURES, ...DISABLED_FEATURES])).toEqual(sorted(ALL_FEATURES))
    expect(new Set([...ENABLED_FEATURES, ...DISABLED_FEATURES]).size).toBe(ALL_FEATURES.length)
  })

  it('keeps the explicit v1 surface (ImageBlock, TopBar, AI off)', () => {
    expect(ENABLED_FEATURES).toEqual([
      CrepeFeature.BlockEdit,
      CrepeFeature.CodeMirror,
      CrepeFeature.Cursor,
      CrepeFeature.Latex,
      CrepeFeature.LinkTooltip,
      CrepeFeature.ListItem,
      CrepeFeature.Placeholder,
      CrepeFeature.Table,
      CrepeFeature.Toolbar,
    ])
    expect(DISABLED_FEATURES).toEqual([CrepeFeature.ImageBlock, CrepeFeature.TopBar, CrepeFeature.AI])
    for (const f of ALL_FEATURES) expect(features[f]).toBe((ENABLED_FEATURES as readonly string[]).includes(f))
  })

  it('createCrepe() loads exactly the allowlisted features', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: '# x\n' })
    await crepe.create()
    const loaded = crepe.editor.action((ctx) => useCrepeFeatures(ctx).get())
    await crepe.destroy()
    root.remove()
    expect(sorted(loaded)).toEqual(sorted(ENABLED_FEATURES))
  })
})
