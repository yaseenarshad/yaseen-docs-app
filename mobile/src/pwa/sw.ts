import { wire, type ShellBuild, type SwScope } from './swCore'

/** The service worker file (`dist/sw.js`, built by `publish/pwaPlugin.ts`): this build's shell list, and the logic. */
declare const __NOTECARDS_SHELL__: ShellBuild
declare const self: unknown

wire(self as SwScope, __NOTECARDS_SHELL__)
