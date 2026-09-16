import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { MAX_COLUMNS } from './gridZoom'

/** gap between tiles, as a fraction of the tile size */
export const GAP_RATIO = 0.06

export type ContinuousGridHandle = {
  /**
   * Lay the slot grid out for the given visual tile size, keeping the content
   * point `anchorContentY` at `anchorScreenY`. Returns the container offset.
   */
  setView(
    tile: number,
    anchorContentY: number,
    anchorScreenY: number,
    scrollY: number
  ): number
  contentHeight(): number
}

type ContinuousGridProps<T> = {
  items: T[]
  width: number
  /** committed column count (used for the first paint before setView) */
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** where the per-slot crossfade runs, as a fraction of the column step */
const FADE_START = 0.55

/**
 * A single continuous grid made of fixed slots.
 *
 * A slot is identified by (row, column); its position only depends on the
 * current pitch, so slots never swap places - zooming scales the whole grid.
 * The photo in a slot is `row * columns + column`, so when the column count
 * changes (crossing the threshold) the slots below the first row change their
 * photo; that change is a crossfade inside the container rather than a
 * re-layout. Columns/rows that come into view enter from the screen edge.
 */
const ContinuousGrid = <T,>({
  items,
  width,
  initialColumns,
  renderItem,
  handleRef,
  onVisibleRange,
}: ContinuousGridProps<T>) => {
  const count = items.length
  const containerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const slotEls = useRef(new Map<string, HTMLDivElement>())
  const overlayEls = useRef(new Map<string, HTMLDivElement>())
  const latest = useRef({ width, count, gapRatio: GAP_RATIO })
  latest.current = { width, count, gapRatio: GAP_RATIO }

  // which slots are mounted (row range + column count at render time)
  const [render, setRender] = useState(() => ({
    r0: 0,
    r1: 4,
    cLo: initialColumns,
    cHi: initialColumns + 1,
    mountedHi: initialColumns + 1,
  }))
  const renderRef = useRef(render)
  renderRef.current = render
  const lastView = useRef<{
    tile: number
    anchorContentY: number
    anchorScreenY: number
    scrollY: number
  } | null>(null)
  // overlay layers are only mounted while a per-slot crossfade is running,
  // so the DOM stays at one tile per slot the rest of the time
  const [crossfade, setCrossfade] = useState(false)
  const crossfadeRef = useRef(false)

  useLayoutEffect(() => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0
    const c = Math.max(3, initialColumns)
    const base = tileForColumns(width, c)
    const pitch = base * (1 + GAP_RATIO)
    const r0 = Math.max(0, Math.floor(scrollY / pitch) - 1)
    const r1 = r0 + Math.ceil(vh / pitch) + 3
    setRender({
      r0,
      r1,
      cLo: c,
      cHi: c + 1,
      mountedHi: c + 1,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, count, initialColumns])

  const handle = useMemo<ContinuousGridHandle>(
    () => ({
      contentHeight() {
        return innerRef.current ? innerRef.current.offsetHeight : 0
      },
      setView(tile, anchorContentY, anchorScreenY, scrollY) {
        const { width: w, count: n, gapRatio: r } = latest.current
        if (tile <= 0 || w <= 0) return 0
        lastView.current = { tile, anchorContentY, anchorScreenY, scrollY }
        const pitch = tile * (1 + r)
        const cv = columnsForTile(w, tile, r)
        const cLo = Math.max(1, Math.min(MAX_COLUMNS - 1, Math.floor(cv)))
        const cHi = cLo + 1
        const frac = clamp(cv - cLo, 0, 1)
        const x = clamp((frac - FADE_START) / (1 - FADE_START), 0, 1)

        const shouldFade = x > 0
        if (shouldFade !== crossfadeRef.current) {
          crossfadeRef.current = shouldFade
          setCrossfade(shouldFade)
        }

        const vh = window.innerHeight || 800
        const r0 = Math.max(0, Math.floor((scrollY - pitch * 2) / pitch))
        const r1 = r0 + Math.ceil(vh / pitch) + 4
        const rc = renderRef.current
        if (cLo !== rc.cLo || cHi !== rc.cHi || r0 < rc.r0 || r1 > rc.r1) {
          setRender({
            r0: Math.min(rc.r0, r0),
            r1: Math.max(rc.r1, r1),
            cLo,
            cHi,
            mountedHi: Math.max(rc.mountedHi, cHi),
          })
        }

        // the tiles are mounted at the render-time base size; scale to the
        // exact current tile size
        const base = tileForColumns(w, rc.cLo)
        const scale = base > 0 ? tile / base : 1
        const offsetY =
          anchorScreenY < 0 ? 0 : anchorScreenY + scrollY - anchorContentY

        for (const [key, el] of slotEls.current) {
          const [rs, cs] = key.split(':')
          el.style.transform = `translate(${+cs * pitch}px, ${+rs * pitch}px) scale(${scale})`
        }
        for (const [, el] of overlayEls.current) {
          el.style.opacity = `${x}`
        }

        const inner = innerRef.current
        if (inner != null) {
          const rows = Math.ceil(n / cLo)
          inner.style.height = `${rows * pitch}px`
          inner.style.transform = `translateY(${offsetY}px)`
        }

        onVisibleRange?.(r0 * cLo, Math.min(n - 1, (r1 + 1) * cLo))
        return offsetY
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useLayoutEffect(() => {
    if (handleRef != null) handleRef.current = handle
  }, [handleRef, handle])

  // position slots whenever the mounted set changes
  useLayoutEffect(() => {
    const v = lastView.current
    if (v != null) {
      handle.setView(v.tile, v.anchorContentY, v.anchorScreenY, v.scrollY)
    } else {
      handle.setView(tileForColumns(width, initialColumns), 0, 0, window.scrollY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render.r0, render.r1, render.cLo, render.cHi, render.mountedHi, width])

  const slots: React.ReactNode[] = []
  const rr = renderRef.current
  for (let row = rr.r0; row < rr.r1; row++) {
    for (let col = 0; col <= rr.mountedHi; col++) {
      const loIndex = row * rr.cLo + col
      const hiIndex = row * rr.cHi + col
      if (loIndex >= count && hiIndex >= count) continue
      const loItem = loIndex < count ? items[loIndex] : null
      const hiItem = hiIndex < count ? items[hiIndex] : null
      const differs = hiItem != null && loItem !== hiItem
      const key = `${row}:${col}`
      slots.push(
        <div
          key={key}
          ref={el => {
            if (el != null) slotEls.current.set(key, el)
            else slotEls.current.delete(key)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: tileForColumns(width, rr.cLo),
            height: tileForColumns(width, rr.cLo),
            transformOrigin: '0 0',
          }}
        >
          {loItem != null && renderItem(loItem, loIndex, tileForColumns(width, rr.cLo))}
          {differs && crossfade && (
            <div
              ref={el => {
                if (el != null) overlayEls.current.set(key, el)
                else overlayEls.current.delete(key)
              }}
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0,
                pointerEvents: 'none',
              }}
            >
              {renderItem(hiItem as T, hiIndex, tileForColumns(width, rr.cLo))}
            </div>
          )}
        </div>
      )
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', overflow: 'hidden' }}
    >
      <div ref={innerRef} style={{ position: 'relative', width: '100%' }}>
        {slots}
      </div>
    </div>
  )
}

export default ContinuousGrid
