import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Column counts per zoom level, from most zoomed in to most zoomed out. */
export const COLUMN_LEVELS = [3, 5, 15, 30] as const
export const MIN_LEVEL = 0
export const MAX_LEVEL = COLUMN_LEVELS.length - 1

/** default level: 5 columns */
const DEFAULT_LEVEL = 1

const STORAGE_KEY = 'photoview.zoomLevel'

function readStoredLevel(): number | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored == null) return null
    const value = parseInt(stored)
    if (isNaN(value)) return null
    return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, value))
  } catch {
    return null
  }
}

export type ZoomLevels = {
  /** index into COLUMN_LEVELS (0 = 3 columns / biggest photos) */
  level: number
  /** column count of the current level */
  columns: number
  setLevel(level: number): void
  zoomIn(): void
  zoomOut(): void
  canZoomIn: boolean
  canZoomOut: boolean
}

/**
 * Persisted gallery zoom level as a discrete set of column counts.
 */
export const useZoomLevels = (): ZoomLevels => {
  const [level, setLevelState] = useState(
    () =>
      typeof window === 'undefined'
        ? DEFAULT_LEVEL
        : readStoredLevel() ?? DEFAULT_LEVEL
  )

  const persistTimer = useRef<number | undefined>(undefined)

  const setLevel = useCallback((newLevel: number) => {
    const clamped = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(newLevel)))
    setLevelState(clamped)

    if (persistTimer.current != null) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, `${clamped}`)
      } catch {
        // storage unavailable, keep in-memory value
      }
    }, 300)
  }, [])

  useEffect(() => {
    return () => {
      if (persistTimer.current != null) window.clearTimeout(persistTimer.current)
    }
  }, [])

  return useMemo(
    () => ({
      level,
      columns: COLUMN_LEVELS[level],
      setLevel,
      zoomIn: () => setLevel(level - 1),
      zoomOut: () => setLevel(level + 1),
      canZoomIn: level > MIN_LEVEL,
      canZoomOut: level < MAX_LEVEL,
    }),
    [level, setLevel]
  )
}
