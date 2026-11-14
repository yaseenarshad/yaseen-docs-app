import { describe, expect, it, vi } from 'vitest'
import { listenTour, onTourShow, setTourPlaces, showTourPlace, subscribeTourPlaces, tourEvent, tourPlaces } from './tourBus'

describe('the tour bus (YAZ-5123)', () => {
  it('with no tour running an event goes nowhere; the running tour hears each one once; after it stops, none', () => {
    expect(() => tourEvent('card-edit-done')).not.toThrow()
    const heard = vi.fn()
    const stop = listenTour(heard)
    tourEvent('folder-menu-open', '/v/Course Cards')
    expect(heard).toHaveBeenCalledExactlyOnceWith('folder-menu-open', '/v/Course Cards')
    stop()
    tourEvent('card-edit-done')
    expect(heard).toHaveBeenCalledOnce()
  })

  it('the places tell their watchers on a change only; null clears them', () => {
    const watch = vi.fn()
    const stop = subscribeTourPlaces(watch)
    setTourPlaces({ folder: '/v/C', page: '/v/C/Course page.md' })
    setTourPlaces({ folder: '/v/C', page: '/v/C/Course page.md' })
    expect(watch).toHaveBeenCalledOnce()
    expect(tourPlaces().folder).toBe('/v/C')
    setTourPlaces(null)
    expect(tourPlaces()).toEqual({ folder: null, page: null })
    stop()
  })

  it('Show me reaches App only while App listens', () => {
    expect(() => showTourPlace({ kind: 'sidebar' })).not.toThrow()
    const show = vi.fn()
    const stop = onTourShow(show)
    showTourPlace({ kind: 'folder', path: '/v/C' })
    expect(show).toHaveBeenCalledExactlyOnceWith({ kind: 'folder', path: '/v/C' })
    stop()
  })
})
