/**
 * How a card may load media (YAZ-5209). The Mac leaves it as it is: a card's web picture loads, as it always did. The
 * phone app (`mobile/src/main.tsx`) calls `onlyLocalMedia()` once at start: every card it draws then goes through the
 * local-only sanitiser (`localOnly.ts`), which lets nothing load from another host. No import: this file is tiny, so
 * the phone's first load takes it without the card renderer.
 */
export const cardSafety = { local: false }

/** From now on, `renderCard` draws with local media only (the phone). */
export function onlyLocalMedia(): void {
  cardSafety.local = true
}
