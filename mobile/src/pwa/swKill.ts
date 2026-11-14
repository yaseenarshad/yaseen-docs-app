import { wireKillSwitch } from './killSwitch'
import type { SwScope } from './swCore'

/** The kill-switch worker file (`dist/sw.js` when built with `NOTECARDS_KILL_SWITCH=1`; YAZ-5285). */
declare const self: unknown

wireKillSwitch(self as SwScope)
