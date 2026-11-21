/** The vault's word for a page in a Settings label (YAZ-4938): `label: (ctx) => unit(ctx, 'New pages are in review')`. "page" with no vault open. */
import { SAME_WORD } from '../vault/unitWord'
import type { SettingsCtx } from './registry'

export const unit = (ctx: SettingsCtx, text: string): string => (ctx.unitWord?.unit ?? SAME_WORD)(text)
