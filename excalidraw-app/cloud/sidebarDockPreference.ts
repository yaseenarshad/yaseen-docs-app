const SIDEBAR_DOCK_PREFERENCE_PREFIX = "yaseen-whiteboard-sidebar-docked:";

const getStorageKey = (username: string) =>
  `${SIDEBAR_DOCK_PREFERENCE_PREFIX}${username.trim().toLowerCase()}`;

export const readProfileSidebarDockPreference = (username: string) => {
  try {
    return window.localStorage.getItem(getStorageKey(username)) === "true";
  } catch {
    return false;
  }
};

export const writeProfileSidebarDockPreference = (
  username: string,
  docked: boolean,
) => {
  try {
    window.localStorage.setItem(getStorageKey(username), String(docked));
  } catch {
    // Storage may be unavailable in privacy-restricted contexts.
  }
};
