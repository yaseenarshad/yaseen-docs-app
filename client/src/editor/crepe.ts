/**
 * Crepe, with ONLY the features this app can load (YAZ-2184).
 *
 * `@milkdown/crepe`'s root module imports every feature statically — its `loadFeature()` is a
 * switch, so no bundler can drop the disabled ones — and `katex` (+ `remark-math`, the AI and
 * top-bar code) rode into the main chunk although `featureConfig.ts` turns Latex off. Here the same
 * class is rebuilt from Crepe's own public parts: `CrepeBuilder` plus the per-feature entry points,
 * loaded in Crepe's own order with Crepe's own CodeMirror defaults. `crepe.test.ts` holds it to the
 * package's `Crepe`: same loaded features, schema, plugins and rendered DOM.
 *
 * 🔒 No production module may import a VALUE from '@milkdown/crepe' (types are fine): the bundler
 * must treat the root module as side-effectful, so a single value import brings katex back.
 */
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { blockEdit } from '@milkdown/crepe/feature/block-edit'
import { codeMirror } from '@milkdown/crepe/feature/code-mirror'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { table } from '@milkdown/crepe/feature/table'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import type { CrepeConfig, CrepeFeature as PackageCrepeFeature } from '@milkdown/crepe'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'

/** The package enum's values, without importing the module that declares it (`crepe.test.ts` pins equality). */
export const CrepeFeature = {
  CodeMirror: 'code-mirror',
  ListItem: 'list-item',
  LinkTooltip: 'link-tooltip',
  Cursor: 'cursor',
  ImageBlock: 'image-block',
  BlockEdit: 'block-edit',
  Toolbar: 'toolbar',
  Placeholder: 'placeholder',
  Table: 'table',
  Latex: 'latex',
  TopBar: 'top-bar',
  AI: 'ai',
} as unknown as typeof PackageCrepeFeature
export type CrepeFeature = PackageCrepeFeature

type Loader = (editor: CrepeBuilder['editor'], config?: never) => void

/** The bundled features — `featureConfig.ts`'s `ENABLED_FEATURES`. Enabling any other one throws. */
const LOADERS: Partial<Record<CrepeFeature, Loader>> = {
  [CrepeFeature.Cursor]: cursor as Loader,
  [CrepeFeature.ListItem]: listItem as Loader,
  [CrepeFeature.LinkTooltip]: linkTooltip as Loader,
  [CrepeFeature.BlockEdit]: blockEdit as Loader,
  [CrepeFeature.Placeholder]: placeholder as Loader,
  [CrepeFeature.Toolbar]: toolbar as Loader,
  [CrepeFeature.CodeMirror]: codeMirror as Loader,
  [CrepeFeature.Table]: table as Loader,
}

/** Crepe's own `defaultFeatures`, in its key order, which is its load order. */
const DEFAULT_FEATURES: Record<CrepeFeature, boolean> = {
  [CrepeFeature.Cursor]: true,
  [CrepeFeature.ListItem]: true,
  [CrepeFeature.LinkTooltip]: true,
  [CrepeFeature.ImageBlock]: true,
  [CrepeFeature.BlockEdit]: true,
  [CrepeFeature.Placeholder]: true,
  [CrepeFeature.Toolbar]: true,
  [CrepeFeature.CodeMirror]: true,
  [CrepeFeature.Table]: true,
  [CrepeFeature.Latex]: true,
  [CrepeFeature.TopBar]: false,
  [CrepeFeature.AI]: false,
}

export class Crepe extends CrepeBuilder {
  constructor({ features = {}, featureConfigs = {}, ...builderConfig }: CrepeConfig = {}) {
    super(builderConfig)
    const enabled = { ...DEFAULT_FEATURES, ...features }
    for (const feature of Object.keys(enabled) as CrepeFeature[]) {
      if (!enabled[feature]) continue
      const load = LOADERS[feature]
      if (load === undefined) throw new Error(`Crepe feature "${feature}" is not bundled (editor/crepe.ts)`)
      // Crepe's own `defaultConfig` sets only these two that the feature does not already default:
      // the One Dark theme and the language list (its icons and labels equal the feature's defaults).
      const config = feature === CrepeFeature.CodeMirror ? { theme: oneDark, languages, ...featureConfigs[feature] } : featureConfigs[feature]
      load(this.editor, config as never)
    }
  }
}
