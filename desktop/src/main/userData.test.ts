import { describe, expect, it, vi } from 'vitest'
import { applyUserDataOverride, userDataDir } from './userData'

describe('applyUserDataOverride', () => {
  it('does nothing when the override is absent or blank', () => {
    const app = { setPath: vi.fn() }
    applyUserDataOverride(app, undefined)
    applyUserDataOverride(app, '   ')
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('sets only the userData path when an override is present', () => {
    const app = { setPath: vi.fn() }
    applyUserDataOverride(app, '/Users/yasin/Desktop/YAZ-966-right-panel-demo-profile')
    expect(app.setPath).toHaveBeenCalledExactlyOnceWith(
      'userData',
      '/Users/yasin/Desktop/YAZ-966-right-panel-demo-profile',
    )
  })
})

describe("userDataDir (YAZ-2556 D2: the app's user-data folder, without Electron)", () => {
  it('is where Electron puts an app named "Yaseen Docs": Application Support on macOS, %APPDATA% on Windows', () => {
    expect(userDataDir({}, 'darwin', '/Users/me')).toBe('/Users/me/Library/Application Support/Yaseen Docs')
    expect(userDataDir({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', 'C:\\Users\\me')).toBe('C:\\Users\\me\\AppData\\Roaming\\Yaseen Docs')
  })

  it("S13: YASEEN_DOCS_USER_DATA_DIR wins on each platform, by applyUserDataOverride's rule: trimmed, and blank is no override", () => {
    expect(userDataDir({ YASEEN_DOCS_USER_DATA_DIR: ' /tmp/isolated-profile ' }, 'darwin', '/Users/me')).toBe('/tmp/isolated-profile')
    expect(userDataDir({ YASEEN_DOCS_USER_DATA_DIR: '/tmp/isolated-profile', APPDATA: 'C:\\Roaming' }, 'win32', 'C:\\Users\\me')).toBe('/tmp/isolated-profile')
    expect(userDataDir({ YASEEN_DOCS_USER_DATA_DIR: '   ' }, 'darwin', '/Users/me')).toBe('/Users/me/Library/Application Support/Yaseen Docs')
  })
})
