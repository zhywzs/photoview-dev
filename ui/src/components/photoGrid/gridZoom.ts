import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Continuous grid zoom expressed as a column count. Any integer column count
 * is valid, so a pinch reflows the grid one column at a time instead of
 * snapping between a few fixed levels.
 */
export const MIN_COLUMNS = 3
export const MAX_COLUMNS = 30

/** Named stops used by double tap and ctrl + wheel. */
export const COLUMN_STOPS = [3, 5, 15, 30] as const

const DEFAULT_COLUMNS = 5
const STORAGE_KEY = 'photoview.zoomLevel'

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) return DEFAULT_COLUMNS
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(columns)))
}

/** The named stop nearest to an arbitrary column count. */
export function nearestStop(columns: number): number {
  let best: number = COLUMN_STOPS[0]
  let bestDist = Infinity
  for (const stop of COLUMN_STOPS) {
    const d = Math.abs(stop - columns)
    if (d < bestDist) {
      bestDist = d
      best = stop
    }
  }
  return best
}

export function readStoredColumns(): number {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored == null) return DEFAULT_COLUMNS
    const value = parseInt(stored)
    if (isNaN(value)) return DEFAULT_COLUMNS
    return nearestStop(clampColumns(value))
  } catch {
    return DEFAULT_COLUMNS
  }
}

export function persistColumns(columns: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, `${clampColumns(columns)}`)
  } catch {
    // storage unavailable, keep in-memory value
  }
}

export type GridZoom = {
  columns: number
  setColumns(columns: number): void
}

export const useGridZoom = (): GridZoom => {
  const [columns, setColumnsState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_COLUMNS : readStoredColumns()
  )

  const setColumns = useCallback((next: number) => {
    setColumnsState(nearestStop(clampColumns(next)))
  }, [])

  const persistTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (persistTimer.current != null) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => persistColumns(columns), 300)
    return () => {
      if (persistTimer.current != null)
        window.clearTimeout(persistTimer.current)
    }
  }, [columns])

  return useMemo(() => ({ columns, setColumns }), [columns, setColumns])
}
