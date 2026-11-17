/**
 * The default name style of a daily page (YAZ-3607 D4), alone in its module (YAZ-5470): `types.ts` needs only this, so
 * the phone's first load does not carry the daily page rules (`dailyPage.ts`), which only the Today button's chunk needs.
 */
export const DEFAULT_DAILY_PAGE_FORMAT = 'YYYY-MM-DD'
