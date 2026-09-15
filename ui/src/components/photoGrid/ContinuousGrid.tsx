import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { clampColumns, MAX_COLUMNS } from './gridZoom'

/** gap between tiles, as a fraction of the tile size */
export const GAP_RATIO = 0.06

export type ContinuousGridHandle = {
  /**
   * Lay out the grid for the given visual tile size, keeping `anchorIndex`
   * at `anchorScreenY` (viewport px). Called every frame by the gesture.
   * Returns the vertical offset applied to the container (to fold into the
   * scroll when the gesture settles).
   */
  setView(
    tile: number,
    anchorIndex: number,
    anchorScreenY: number,
    scrollY: number
  ): number
  /** Current content height (px). */
  contentHeight(): number
}

type ContinuousGridProps<T> = {
  items: T[]
  itemKey(item: T): string
  width: number
  /** committed column count; the mounted tiles are sized for this */
  initialColumns: number
  renderItem(item: T, index: number, baseSize: number): React.ReactNode
  handleRef?: React.MutableRefObject<ContinuousGridHandle | null>
  onVisibleRange?: (first: number, last: number) => void
}

/** Natural tile size for `columns` columns filling `width`. */
export function tileForColumns(
  width: number,
  columns: number,
  gapRatio = GAP_RATIO
): number {
  const c = Math.max(1, columns)
  return width / (c + (c - 1) * gapRatio)
}

/** Fractional column count for a given tile size. */
export function columnsForTile(
  width: number,
  tile: number,
  gapRatio = GAP_RATIO
): number {
  if (tile <= 0) return MAX_COLUMNS
  return (width / tile + gapRatio) / (1 + gapRatio)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * A single continuous photo grid.
 *
 * There is no "per level page": the layout is interpolated between the two
 * adjacent integer column counts that bracket the current visual tile size.
 * Because adjacent counts differ by one column, every photo only moves by up
 * to one cell, continuously - so zooming out grows the extra column out of
 * the right edge instead of swapping in a second page.
 *
 * Positions are written imperatively (transform only) so a gesture never
 * re-renders React; the tiles themselves are rendered once per column change
 * at the tile size of the preceding column and then scaled with CSS.
 */
const ContinuousGrid = <T,>({
  items,
  itemKey,
  width,
  initialColumns,
  renderItem,
  handleRef,
  onVisibleRange,
}: ContinuousGridProps<T>) => {
  const count = items.length
  const containerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const tileEls = useRef(new Map<number, HTMLDivElement>())
  const latest = useRef({ width, count, gapRatio: GAP_RATIO })
  latest.current = { width, count, gapRatio: GAP_RATIO }

  // tokens that describe which items are mounted and at which base size
  const [render, setRender] = useState(() => ({
    columns: 5,
    base: width / 5,
    first: 0,
    last: Math.min(count, 120),
  }))
  const renderRef = useRef(render)
  renderRef.current = render
  const lastView = useRef<{
    tile: number
    anchorIndex: number
    anchorScreenY: number
    scrollY: number
  } | null>(null)

  // (re)initialise the mounted range / base when data or width changes
  useLayoutEffect(() => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0
    const columns = clampColumns(initialColumns)
    const base = tileForColumns(width, columns)
    const pitch = base * (1 + GAP_RATIO)
    const perScreen = Math.max(1, Math.ceil((vh / pitch) * columns))
    const first = Math.max(0, Math.floor(scrollY / pitch) * columns - perScreen)
    const last = Math.min(count, first + perScreen * 2 + columns)
    setRender({ columns, base, first, last })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, count, initialColumns])

  const handle = useMemo<ContinuousGridHandle>(
    () => ({
      contentHeight() {
        const inner = innerRef.current
        return inner ? inner.offsetHeight : 0
      },
      setView(tile, anchorIndex, anchorScreenY, scrollY) {
        const { width: w, count: n, gapRatio: r } = latest.current
        if (tile <= 0 || w <= 0 || n === 0) return 0
        lastView.current = { tile, anchorIndex, anchorScreenY, scrollY }
        const pitch = tile * (1 + r)
        const cv = columnsForTile(w, tile, r)
        const c0 = Math.max(1, Math.min(MAX_COLUMNS, Math.floor(cv)))
        const c1 = c0 + 1
        const f = Math.max(0, Math.min(1, cv - c0))

        const rc = renderRef.current

        // mount a wider range if the visible window has drifted
        const effCols = 1 / lerp(1 / c0, 1 / c1, f)
        const vh = window.innerHeight || 800
        const wantFirst = Math.max(0, Math.floor((scrollY / pitch) * effCols) - effCols * 2)
        const wantLast = Math.min(n, Math.ceil(((scrollY + vh) / pitch) * effCols) + effCols * 2)
        if (wantFirst < rc.first || wantLast > rc.last) {
          const nextFirst = Math.max(0, Math.min(rc.first, wantFirst - effCols))
          const nextLast = Math.min(n, Math.max(rc.last, wantLast + effCols))
          setRender(prev => ({ ...prev, first: nextFirst, last: nextLast }))
        }

        const base = rc.base > 0 ? rc.base : tile
        const scale = tile / base
        for (const [i, el] of tileEls.current) {
          const xA = (i % c0) * pitch
          const xB = (i % c1) * pitch
          const yA = Math.floor(i / c0) * pitch
          const yB = Math.floor(i / c1) * pitch
          const x = lerp(xA, xB, f)
          const y = lerp(yA, yB, f)
          el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
        }

        const inner = innerRef.current
        const hA = Math.ceil(n / c0) * pitch
        const hB = Math.ceil(n / c1) * pitch
        const height = lerp(hA, hB, f)
        if (inner != null) inner.style.height = `${height}px`

        // keep the anchored photo at the same viewport position (a negative
        // anchor means "no gesture": render at the natural position)
        let offsetY = 0
        if (anchorIndex >= 0) {
          const aA = Math.floor(anchorIndex / c0) * pitch
          const aB = Math.floor(anchorIndex / c1) * pitch
          const anchorTop = lerp(aA, aB, f)
          offsetY = anchorScreenY + scrollY - anchorTop
        }
        if (inner != null) inner.style.transform = `translateY(${offsetY}px)`

        onVisibleRange?.(wantFirst, wantLast)
        return offsetY
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useLayoutEffect(() => {
    if (handleRef != null) handleRef.current = handle
  }, [handleRef, handle])

  // re-apply the last view whenever the mounted tiles (or their base size)
  // change, so newly mounted tiles are positioned immediately
  useLayoutEffect(() => {
    const v = lastView.current
    const tile = v?.tile ?? tileForColumns(width, initialColumns)
    handle.setView(
      tile,
      v?.anchorIndex ?? -1,
      v?.anchorScreenY ?? 0,
      v?.scrollY ?? window.scrollY
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render.first, render.last, render.base, width, initialColumns])

  const rendered = []
  for (let i = render.first; i < render.last && i < count; i++) {
    const item = items[i]
    if (item == null) continue
    rendered.push(
      <div
        key={itemKey(item)}
        ref={el => {
          if (el != null) tileEls.current.set(i, el)
          else tileEls.current.delete(i)
        }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: render.base,
          height: render.base,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {renderItem(item, i, render.base)}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', overflow: 'hidden' }}
    >
      <div ref={innerRef} style={{ position: 'relative', width: '100%' }}>
        {rendered}
      </div>
    </div>
  )
}

export default ContinuousGrid
