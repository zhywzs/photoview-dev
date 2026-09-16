import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/** gap between tiles, as a fraction of the tile size */
export const GAP_RATIO = 0.06

/** where the (single) crossfade runs, as a fraction of the level step */
const FADE_START = 0.6

export type ContinuousView = {
  /** current visual tile size (px) */
  tile: number
  /** committed column count */
  fromColumns: number
  /** target column count, or null when no switch is in flight */
  toColumns: number | null
  /** fractional grid coordinate under the gesture (column) at gesture start */
  anchorCX: number
  /** fractional grid coordinate under the gesture (row) at gesture start */
  anchorCY: number
  /** viewport X the anchor must stay at */
  screenX: number
  /** viewport Y the anchor must stay at */
  screenY: number
  scrollY: number
}

export type ContinuousGridHandle = {
  /** Lay the grid out for this view. Returns the container offset Y. */
  setView(view: ContinuousView): number
  contentHeight(): number
}

type ContinuousGridProps<T> = {
  items: T[]
  width: number
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

type RenderState = {
  r0: number
  r1: number
  cMax: number
  fromC: number
  toC: number | null
}

/**
 * The photo grid.
 *
 * The grid is a set of slots keyed by (row, column); the layout is computed
 * for the *target* column count so slots never swap places - zooming just
 * changes the pitch, which moves/scales every slot together.
 *
 * When a pinch crosses to the next discrete level (3/5/15/30) there is a
 * single crossfade: each slot fades from the photo it had in the committed
 * layout to the photo it has in the target layout. Columns/rows that only
 * exist in the target are rendered directly at their precomputed slot (they
 * slide in from the edge and never fade); columns that only exist in the
 * source fade out.
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
  const slotEls = useRef(
    new Map<string, { root: HTMLDivElement; base: HTMLDivElement; overlay?: HTMLDivElement }>()
  )
  const latest = useRef({ width, count, gapRatio: GAP_RATIO })
  latest.current = { width, count, gapRatio: GAP_RATIO }

  const [render, setRender] = useState<RenderState>(() => ({
    r0: 0,
    r1: 4,
    cMax: initialColumns,
    fromC: initialColumns,
    toC: null,
  }))
  const renderRef = useRef(render)
  renderRef.current = render

  const [crossfade, setCrossfade] = useState(false)
  const crossfadeRef = useRef(false)
  const lastView = useRef<ContinuousView | null>(null)

  useLayoutEffect(() => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0
    const c = Math.max(1, initialColumns)
    const pitch = tileForColumns(width, c) * (1 + GAP_RATIO)
    const r0 = Math.max(0, Math.floor(scrollY / pitch) - 1)
    setRender({
      r0,
      r1: r0 + Math.ceil(vh / pitch) + 4,
      cMax: c,
      fromC: c,
      toC: null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, count, initialColumns])

  const handle = useMemo<ContinuousGridHandle>(
    () => ({
      contentHeight() {
        return innerRef.current ? innerRef.current.offsetHeight : 0
      },
      setView(view) {
        const { width: w, count: n, gapRatio: r } = latest.current
        const {
          tile,
          fromColumns,
          toColumns,
          anchorCX,
          anchorCY,
          screenX,
          screenY,
          scrollY,
        } = view
        if (tile <= 0 || w <= 0) return 0
        lastView.current = view

        const pitch = tile * (1 + r)
        const cMax = Math.max(fromColumns, toColumns ?? 0)
        const fromTile = tileForColumns(w, fromColumns)
        const toTile = toColumns != null ? tileForColumns(w, toColumns) : fromTile
        const step = fromTile - toTile
        const prog = step === 0 ? 1 : clamp((fromTile - tile) / step, 0, 1)
        const x = toColumns == null ? 0 : clamp((prog - FADE_START) / (1 - FADE_START), 0, 1)

        const shouldFade = toColumns != null && x > 0
        if (shouldFade !== crossfadeRef.current) {
          crossfadeRef.current = shouldFade
          setCrossfade(shouldFade)
        }

        const vh = window.innerHeight || 800
        const rect = containerRef.current?.getBoundingClientRect()
        const hostLeft = rect?.left ?? 0
        const hostTop = rect?.top ?? 0
        const r0 = Math.max(0, Math.floor((scrollY - hostTop - pitch * 2) / pitch))
        const r1 = r0 + Math.ceil(vh / pitch) + 4
        const rc = renderRef.current
        if (
          cMax !== rc.cMax ||
          fromColumns !== rc.fromC ||
          toColumns !== rc.toC ||
          r0 < rc.r0 ||
          r1 > rc.r1
        ) {
          setRender({
            r0: Math.min(rc.r0, r0),
            r1: Math.max(rc.r1, r1),
            cMax,
            fromC: fromColumns,
            toC: toColumns,
          })
        }

        const offsetX =
          screenY < 0 ? 0 : screenX - hostLeft - anchorCX * pitch
        const offsetY =
          screenY < 0 ? 0 : screenY - hostTop + scrollY - anchorCY * pitch

        const base = tileForColumns(w, rc.cMax)
        const scale = base > 0 ? tile / base : 1

        for (const [key, els] of slotEls.current) {
          const [rs, cs] = key.split(':')
          const row = +rs
          const col = +cs
          els.root.style.transform = `translate(${col * pitch}px, ${row * pitch}px) scale(${scale})`
          const hasSource = col < rc.fromC
          const hasTarget = rc.toC != null && col < rc.toC
          // a slot that only exists in the source fades out; everything else
          // keeps its (possibly crossfaded) content fully opaque
          els.base.style.opacity = hasSource && !hasTarget ? `${1 - x}` : '1'
          if (els.overlay) els.overlay.style.opacity = `${x}`
        }

        const inner = innerRef.current
        if (inner != null) {
          const rows = Math.ceil(Math.max(1, n) / cMax)
          inner.style.height = `${rows * pitch}px`
          inner.style.transform = `translate(${offsetX}px, ${offsetY}px)`
        }

        onVisibleRange?.(r0 * cMax, Math.min(n - 1, (r1 + 1) * cMax))
        return offsetY
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useLayoutEffect(() => {
    if (handleRef != null) handleRef.current = handle
  }, [handleRef, handle])

  useLayoutEffect(() => {
    const v = lastView.current
    if (v != null) handle.setView(v)
    else
      handle.setView({
        tile: tileForColumns(width, initialColumns),
        fromColumns: initialColumns,
        toColumns: null,
        anchorCX: 0,
        anchorCY: 0,
        screenX: 0,
        screenY: 0,
        scrollY: window.scrollY,
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    render.r0,
    render.r1,
    render.cMax,
    render.fromC,
    render.toC,
    width,
    count,
    crossfade,
  ])

  const rr = renderRef.current
  const baseSize = tileForColumns(width, rr.cMax)
  const slots: React.ReactNode[] = []
  for (let row = rr.r0; row < rr.r1; row++) {
    for (let col = 0; col < rr.cMax; col++) {
      const sourceIndex = col < rr.fromC ? row * rr.fromC + col : -1
      const targetIndex =
        rr.toC != null && col < rr.toC ? row * rr.toC + col : -1
      const baseIndex = sourceIndex >= 0 ? sourceIndex : targetIndex
      if (baseIndex < 0 || baseIndex >= count) continue
      const baseItem = items[baseIndex]
      const overlayItem =
        sourceIndex >= 0 &&
        targetIndex >= 0 &&
        targetIndex !== sourceIndex &&
        targetIndex < count
          ? items[targetIndex]
          : null
      const key = `${row}:${col}`
      slots.push(
        <div
          key={key}
          ref={el => {
            if (el != null) {
              const entry = slotEls.current.get(key)
              if (entry) entry.root = el
              else slotEls.current.set(key, { root: el, base: el })
            } else slotEls.current.delete(key)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: baseSize,
            height: baseSize,
            transformOrigin: '0 0',
          }}
        >
          <div
            ref={el => {
              const entry = slotEls.current.get(key)
              if (entry && el != null) entry.base = el
            }}
            style={{ position: 'absolute', inset: 0 }}
          >
            {renderItem(baseItem, baseIndex, baseSize)}
          </div>
          {overlayItem != null && crossfade && (
            <div
              ref={el => {
                const entry = slotEls.current.get(key)
                if (entry && el != null) entry.overlay = el
              }}
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0,
                pointerEvents: 'none',
              }}
            >
              {renderItem(overlayItem, targetIndex, baseSize)}
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
