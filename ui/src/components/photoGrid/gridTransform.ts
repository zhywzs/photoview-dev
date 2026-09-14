/**
 * Zoom follow/commit mechanics for the photo grid.
 *
 * While pinching, the whole grid host element is scaled with a plain CSS
 * transform (updated every touchmove) so the photos track the fingers 1:1,
 * with zero layout work. When the visual tile size crosses the geometric
 * midpoint between two zoom levels, the new level's layout takes over:
 * the scroll is restored so the anchored photo stays under the fingers,
 * and the difference between the current visual size and the new level's
 * tile size is applied as a *residual* transform, then folded into the
 * follow baseline - making the takeover visually seamless.
 *
 * On release the residual transform settles back to identity so the grid
 * ends up at the exact tile size of the committed level.
 */

import { COLUMN_LEVELS } from './useZoomLevels'
import { GRID_GAP, isDenseLevel, tileSizeForColumns } from './gridLayout'

/** settle animation when the fingers are lifted mid-transition */
export const SETTLE_DURATION_MS = 180
/** settle animation used by double tap level jumps */
export const TAP_SETTLE_DURATION_MS = 260
/**
 * How long the residual transform is absorbed after a level commit:
 * the photos glide from their continuous (pinch-continuous) size to the
 * exact tile size of the committed level.
 */
export const RESIDUAL_ABSORB_MS = 200
/**
 * Commit thresholds sit at the geometric midpoints between adjacent level
 * tile sizes, widened by this factor so the direction can reverse without
 * thrashing between two levels.
 */
export const PINCH_HYSTERESIS = 1.04
/** how far past the extreme levels the transform may track the fingers */
export const MAX_OVERSCALE = 1.35
export const MIN_OVERSCALE = 0.75

export function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Residual factor at `elapsed` ms after a commit, easing from `r0`
 * towards 1 (the exact tile size of the committed level).
 *
 * Pure function of time so the follow frames stay self-correcting.
 */
export function residualAt(r0: number, elapsedMs: number): number {
  if (r0 == 1) return 1
  if (elapsedMs <= 0) return r0
  if (elapsedMs >= RESIDUAL_ABSORB_MS) return 1

  const p = elapsedMs / RESIDUAL_ABSORB_MS
  // ease-out cubic
  const eased = 1 - Math.pow(1 - p, 3)
  return r0 + (1 - r0) * eased
}

/** Tile size of every zoom level for the given container width. */
export function levelTiles(containerWidth: number): number[] {
  return COLUMN_LEVELS.map(cols =>
    tileSizeForColumns(
      containerWidth,
      cols,
      isDenseLevel(cols) ? 0 : GRID_GAP
    )
  )
}

/**
 * The level the grid should commit to for the given visual tile size
 * (the size photos currently appear at: rendered tile * follow scale).
 *
 * Returns the new level index, or null to keep following.
 */
export function commitLevelForVisualTile(
  level: number,
  visualTile: number,
  tiles: number[]
): number | null {
  if (level > 0) {
    const midpoint = Math.sqrt(tiles[level] * tiles[level - 1])
    if (visualTile >= midpoint * PINCH_HYSTERESIS) return level - 1
  }
  if (level < tiles.length - 1) {
    const midpoint = Math.sqrt(tiles[level] * tiles[level + 1])
    if (visualTile <= midpoint / PINCH_HYSTERESIS) return level + 1
  }
  return null
}

/** Clamp the follow scale at the extreme levels (no further level there). */
export function clampFollowScale(
  scale: number,
  level: number,
  maxLevel: number
): number {
  if (level <= 0) return Math.min(scale, MAX_OVERSCALE)
  if (level >= maxLevel) return Math.max(scale, MIN_OVERSCALE)
  return scale
}

// ---------------------------------------------------------------------------
// Imperative host transform helpers. The origin coordinates are relative to
// the host element's untransformed box.
// ---------------------------------------------------------------------------

/** Write the follow transform (no transition - tracks the fingers directly). */
export function applyFollowTransform(
  host: HTMLElement,
  scale: number,
  originX: number,
  originY: number
): void {
  host.style.transition = 'none'
  host.style.willChange = 'transform'
  host.style.transformOrigin = `${originX}px ${originY}px`
  host.style.transform = `scale(${scale})`
}

/** Remove the transform entirely (back to the plain layout). */
export function clearZoomTransform(host: HTMLElement): void {
  host.style.transition = 'none'
  host.style.willChange = ''
  host.style.transform = ''
  host.style.transformOrigin = ''
}

/**
 * Animate the current transform to identity so the grid settles at the
 * exact tile size of the committed level. `onSettled` runs after the
 * transform is fully cleared. Returns a cancel function that freezes the
 * animation at its current value.
 */
export function settleZoomTransform(
  host: HTMLElement,
  durationMs: number = SETTLE_DURATION_MS,
  onSettled?: () => void
): () => void {
  if (durationMs <= 0) {
    clearZoomTransform(host)
    onSettled?.()
    return () => undefined
  }

  host.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`
  host.style.transform = 'scale(1)'

  let timer: number | undefined = window.setTimeout(() => {
    timer = undefined
    clearZoomTransform(host)
    onSettled?.()
  }, durationMs + 60)

  return () => {
    if (timer != null) window.clearTimeout(timer)
    timer = undefined
    host.style.transition = 'none'
  }
}
