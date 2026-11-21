import { titleWithKey, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { CogIcon } from '../components/CogIcon'

/**
 * The cog in the sidebar footer (GRO-2024; since YAZ-1679 it only OPENS the settings dialog —
 * App mounts the dialog, so ⌘, and the app menu open the same one). The gear is the popover's
 * own glyph; the title names the shortcut because nothing else in the footer does — the key as it is
 * now (YAZ-3410), none with "No key".
 */
interface SettingsButtonProps {
  onClick: () => void
  /** `settings.hotkeys` (YAZ-3397 D2). */
  hotkeys: HotkeyOverrides
}

export function SettingsButton({ onClick, hotkeys }: SettingsButtonProps) {
  return (
    <button type="button" className="settings-button" onClick={onClick} title={titleWithKey('Settings', 'settings', hotkeys)} aria-label="Settings">
      <CogIcon size={15} />
    </button>
  )
}
