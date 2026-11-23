import { createContext } from 'react'

/** Shared open-state ref for Properties panel inside mini windows (extracted for lazy splitting, YAZ-6008 D3). */
export const PropertiesOpenMemory = createContext<{ current: boolean | null } | null>(null)
