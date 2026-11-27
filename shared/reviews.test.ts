import { describe, expect, it } from 'vitest'
import {
  CARD_LOCATION_MODES,
  DEFAULT_REVIEW_SETTINGS,
  REVIEW_INBOX_OPEN_AT,
  REVIEW_SETTINGS_KEYS,
  SPACE_BEHAVIORS,
  sanitizeReviewSettings,
} from './reviews'

describe('shared/reviews (YAZ-6591 / YAZ-6597)', () => {
  it('defaults all four vault-only Inbox fields and registers them in REVIEW_SETTINGS_KEYS', () => {
    expect(DEFAULT_REVIEW_SETTINGS.spaceBehavior).toBe('scroll')
    expect(DEFAULT_REVIEW_SETTINGS.cardLocation).toBe('focus-hide')
    expect(DEFAULT_REVIEW_SETTINGS.focusHidesSidebar).toBe(false)
    expect(DEFAULT_REVIEW_SETTINGS.inboxOpenAt).toBe('top')

    for (const key of ['spaceBehavior', 'cardLocation', 'focusHidesSidebar', 'inboxOpenAt']) {
      expect(REVIEW_SETTINGS_KEYS).toContain(key)
    }
  })

  it('sanitizes missing or non-object input to defaults', () => {
    for (const raw of [undefined, null, 'bad', 42, [], {}]) {
      const s = sanitizeReviewSettings(raw)
      expect(s.spaceBehavior).toBe('scroll')
      expect(s.cardLocation).toBe('focus-hide')
      expect(s.focusHidesSidebar).toBe(false)
      expect(s.inboxOpenAt).toBe('top')
    }
  })

  it('keeps every valid value of spaceBehavior, cardLocation, focusHidesSidebar, and inboxOpenAt', () => {
    for (const spaceBehavior of SPACE_BEHAVIORS) {
      expect(sanitizeReviewSettings({ spaceBehavior }).spaceBehavior).toBe(spaceBehavior)
    }
    for (const cardLocation of CARD_LOCATION_MODES) {
      expect(sanitizeReviewSettings({ cardLocation }).cardLocation).toBe(cardLocation)
    }
    for (const focusHidesSidebar of [false, true] as const) {
      expect(sanitizeReviewSettings({ focusHidesSidebar }).focusHidesSidebar).toBe(focusHidesSidebar)
    }
    for (const inboxOpenAt of REVIEW_INBOX_OPEN_AT) {
      expect(sanitizeReviewSettings({ inboxOpenAt }).inboxOpenAt).toBe(inboxOpenAt)
    }
  })

  it('falls back each invalid Inbox field to its default independently while keeping valid fields', () => {
    expect(
      sanitizeReviewSettings({
        spaceBehavior: 'teleport',
        cardLocation: 'always',
        focusHidesSidebar: 'yes',
        inboxOpenAt: 'bottom',
        buttons: 4,
      }),
    ).toMatchObject({
      spaceBehavior: 'scroll',
      cardLocation: 'focus-hide',
      focusHidesSidebar: false,
      inboxOpenAt: 'top',
      buttons: 4,
    })

    expect(
      sanitizeReviewSettings({
        spaceBehavior: 'jump',
        cardLocation: null,
        focusHidesSidebar: true,
        inboxOpenAt: 123,
        unknownFutureKey: 'ignored',
      }),
    ).toMatchObject({
      spaceBehavior: 'jump',
      cardLocation: 'focus-hide',
      focusHidesSidebar: true,
      inboxOpenAt: 'top',
    })
  })
})
