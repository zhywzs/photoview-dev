/** Whether the user asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Duration of the tile geometry (zoom / reflow) transition. */
export const TILE_TRANSITION_MS = 180
