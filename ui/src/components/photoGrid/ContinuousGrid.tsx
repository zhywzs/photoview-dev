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
  /** ordered-photo index placed at slot (0,0) of the committed layout */
  originFrom: number
  /** ordered-photo index placed at slot (0,0) of the target layout */
  originTo: number
  /** column the anchored photo is placed at in the target layout */
  centerCol: number
  screenX: number
  screenY: number
  scrollY: number
}

export type ContinuousGridHandle = {
  /** Lay the grid out for this view. Returns the scroll to settle at. */
  setView(view: ContinuousView): number
  contentHeight(): number
}

type ContinuousGridProps<T> = {
  /** photos in visual order: index 0 is the oldest / top-left */
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
  fromC: number
  toC: number | null
  originFrom: number
  originTo: number
}

/**
 * The photo grid.
 *
 * A slot (row, column) shows the ordered photo `origin + row*columns + col`.
 * `origin` shifts the row wrapping, so the photo under the gesture can sit at
 * the middle column of its row - columns then grow and shrink out of *both*
 * sides of the fingers instead of only the right. The wrapping shift between
 * the committed and target layouts is absorbed by the crossfade, so the grid
 * never jumps.
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
    new Map<
      string,
      { root: HTMLDivElement; base: HTMLDivElement; overlay?: HTMLDivElement }
    >()
  )
  const latest = useRef({ width, count })
  latest.current = { width, count }

  const [render, setRender] = useState<RenderState>(() => ({
    r0: 0,
    r1: 4,
    fromC: initialColumns,
    toC: null,
    originFrom: 0,
    originTo: 0,
  }))
  const renderRef = useRef(render)
  renderRef.current = render
  const lastView = useRef<ContinuousView | null>(null)
  const [crossfade, setCrossfade] = useState(false)
  const crossfadeRef = useRef(false)

  useLayoutEffect(() => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const c = Math.max(1, initialColumns)
    const pitch = tileForColumns(width, c) * (1 + GAP_RATIO)
    setRender({
      r0: 0,
      r1: Math.ceil(vh / pitch) + 4,
      fromC: c,
      toC: null,
      originFrom: 0,
      originTo: 0,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, count, initialColumns])

  const handle = useMemo<ContinuousGridHandle>(
    () => ({
      contentHeight() {
        return innerRef.current ? innerRef.current.offsetHeight : 0
      },
      setView(view) {
        const { width: w, count: n } = latest.current
        const { tile, fromColumns, toColumns, originFrom, originTo, centerCol } =
          view
        if (tile <= 0 || w <= 0) return view.scrollY
        lastView.current = view
        const pitch = tile * (1 + GAP_RATIO)
        const toC = toColumns ?? fromColumns
        const fromTile = tileForColumns(w, fromColumns)
        const toTile = toColumns != null ? tileForColumns(w, toColumns) : fromTile
        const step = fromTile - toTile
        const prog = step === 0 ? 1 : clamp((fromTile - tile) / step, 0, 1)
        const x =
          toColumns == null
            ? 0
            : clamp((prog - FADE_START) / (1 - FADE_START), 0, 1)
        const shouldFade = toColumns != null && x > 0
        if (shouldFade !== crossfadeRef.current) {
          crossfadeRef.current = shouldFade
          setCrossfade(shouldFade)
        }

        const rect = containerRef.current?.getBoundingClientRect()
        const hostLeft = rect?.left ?? 0
        const hostTop = rect?.top ?? 0
        const vh = window.innerHeight || 800

        const row0 = Math.floor((0 - originTo) / toC)
        const rowN = Math.floor((Math.max(1, n) - 1 - originTo) / toC)
        const totalRows = Math.max(1, rowN - row0 + 1)

        const innerY =
          view.screenY < 0
            ? -row0 * pitch
            : view.screenY - hostTop + view.scrollY + row0 * pitch
        const offsetX =
          view.screenY < 0 ? 0 : view.screenX - hostLeft - centerCol * pitch

        // rows whose (r - row0)*pitch falls in the viewport
        const firstRow = Math.floor(
          (view.scrollY - hostTop - innerY) / pitch
        )
        const lastRow = firstRow + Math.ceil(vh / pitch) + 2
        const r0 = Math.max(row0 - 2, firstRow - 2)
        const r1 = Math.min(rowN + 2, lastRow + 2)

        const rc = renderRef.current
        if (
          rc.fromC !== fromColumns ||
          rc.toC !== toColumns ||
          rc.originFrom !== originFrom ||
          rc.originTo !== originTo ||
          r0 < rc.r0 ||
          r1 > rc.r1
        ) {
          setRender({
            r0: Math.min(rc.r0, r0),
            r1: Math.max(rc.r1, r1),
            fromC: fromColumns,
            toC: toColumns,
            originFrom,
            originTo,
          })
        }

        const base = tileForColumns(w, rc.fromC)
        const scale = base > 0 ? tile / base : 1

        for (const [key, els] of slotEls.current) {
          const [rs, cs] = key.split(':')
          const row = +rs
          const col = +cs
          els.root.style.transform = `translate(${col * pitch}px, ${(row - row0) * pitch}px) scale(${scale})`
          const source = rc.originFrom + row * rc.fromC + col
          const hasSource = source >= 0 && source < n
          const hasTarget = col < toC
          els.base.style.opacity = hasSource && !hasTarget ? `${1 - x}` : '1'
          if (els.overlay) els.overlay.style.opacity = `${x}`
        }

        const inner = innerRef.current
        if (inner != null) {
          inner.style.height = `${totalRows * pitch}px`
          inner.style.transform = `translate(${offsetX}px, ${innerY}px)`
        }

        onVisibleRange?.(
          Math.max(0, rc.originTo + r0 * toC),
          Math.min(n - 1, rc.originTo + r1 * toC)
        )
        // scroll that puts the inner at its natural document position
        return hostTop - view.screenY - row0 * pitch
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
        originFrom: 0,
        originTo: 0,
        centerCol: 0,
        screenX: 0,
        screenY: -1,
        scrollY: window.scrollY,
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    render.r0,
    render.r1,
    render.fromC,
    render.toC,
    render.originFrom,
    render.originTo,
    width,
    count,
    crossfade,
  ])

  const rr = renderRef.current
  const baseSize = tileForColumns(width, rr.fromC)
  const cMax = Math.max(rr.fromC, rr.toC ?? rr.fromC)
  const slots: React.ReactNode[] = []
  for (let row = rr.r0; row < rr.r1; row++) {
    for (let col = 0; col < cMax; col++) {
      const sourceIndex = rr.originFrom + row * rr.fromC + col
      const targetIndex = rr.originTo + row * (rr.toC ?? rr.fromC) + col
      const sourceOk = sourceIndex >= 0 && sourceIndex < count
      const targetOk = owner(targetIndex)
      const baseIndex = sourceOk ? sourceIndex : targetOk ? targetIndex : -1
      if (baseIndex < 0) continue
      const overlayIndex =
        sourceOk && targetOk && targetIndex !== sourceIndex ? targetIndex : -1
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
            {renderItem(items[baseIndex], baseIndex, baseSize)}
          </div>
          {overlayIndex >= 0 && crossfade && (
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
              {renderItem(items[overlayIndex], overlayIndex, baseSize)}
            </div>
          )}
        </div>
      )
    }
  }

  function owner(index: number): boolean {
    return index >= 0 && index < count
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
