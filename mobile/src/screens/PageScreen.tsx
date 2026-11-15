import { lazyScreen } from './LazyScreen'

/** A route screen while its chunk loads: the empty screen (no bars). The page view never shows it once preloaded. */
export const routeWaiting = <div className="app" aria-busy="true" />

/**
 * The reader (4C): a chunk of its own, with the Markdown renderer, so the tabs do not load it. In a file of its own so
 * the Today button can load it ahead (`PageView.preload()`, YAZ-5589) without a cycle through the shell.
 */
export const PageView = lazyScreen(() => import('../page/PageView'), { waiting: routeWaiting })
