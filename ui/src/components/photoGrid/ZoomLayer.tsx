import React from 'react'

/** gap between tiles, as a fraction of the tile size */
export const GAP_RATIO = 0.06

/** Natural tile size for `columns` columns filling `width`. */
export function tileForColumns(
  width: number,
  columns: number,
  gapRatio = GAP_RATIO
): number {
  const c = Math.max(1, columns)
  return width / (c + (c - 1) * gapRatio)
}

export function pitchForColumns(
  width: number,
  columns: number,
  gapRatio = GAP_RATIO
): number {
  return tileForColumns(width, columns, gapRatio) * (1 + gapRatio)
}

export function rowMinFor(wrapOrigin: number, columns: number): number {
  return Math.floor(-wrapOrigin / Math.max(1, columns))
}

export function rowMaxFor(
  wrapOrigin: number,
  columns: number,
  count: number
): number {
  return Math.floor((Math.max(1, count) - 1 - wrapOrigin) / Math.max(1, columns))
}

/**
 * Rows of a layer that intersect the viewport, for the virtualization window.
 *
 * A row `r` sits at on-screen y = `hostTop + panY + scale*(r-rowMin)*pitch`
 * (the layer is absolutely positioned at the host's top and then transformed),
 * so solving `y in [0, viewportHeight]` gives the visible rows.
 */
export function layerVisibleRows(
  hostTop: number,
  panY: number,
  scale: number,
  pitch: number,
  rowMin: number,
  rowMax: number,
  viewportHeight: number,
  margin = 2
): readonly [number, number] {
  const s = scale > 0 ? scale : 1
  const top = (-hostTop - panY) / (s * pitch)
  const bottom = (viewportHeight - hostTop - panY) / (s * pitch)
  const r0 = Math.max(rowMin, rowMin + Math.floor(top) - margin)
  const r1 = Math.min(rowMax, rowMin + Math.ceil(bottom) + margin)
  return [r0, r1] as const
}

export type ZoomLayerProps<T> = {
  items: T[]
  columns: number
  /** ordered index placed at slot (0,0) */
  wrapOrigin: number
  width: number
  /** first/last row to render (virtualization window) */
  r0: number
  r1: number
  gapRatio?: number
  renderItem(item: T, index: number, tileSize: number): React.ReactNode
  layerRef?: React.MutableRefObject<HTMLDivElement | null>
}

/**
 * One zoom layer: a grid of photos for a (columns, wrap origin) layout, laid
 * out in the layer's own coordinates (tile (r,c) at
 * `(c*pitch, (r-rowMin)*pitch)`). The owner moves/scales the whole layer with a
 * single transform and decides which rows exist via the `r0..r1` window.
 */
const ZoomLayer = <T,>({
  items,
  columns,
  wrapOrigin,
  width,
  r0,
  r1,
  gapRatio = GAP_RATIO,
  renderItem,
  layerRef,
}: ZoomLayerProps<T>) => {
  const tile = tileForColumns(width, columns, gapRatio)
  const pitch = tile * (1 + gapRatio)
  const rowMin = rowMinFor(wrapOrigin, columns)
  const rowMax = rowMaxFor(wrapOrigin, columns, items.length)
  const count = items.length

  const first = Math.max(rowMin, r0)
  const last = Math.min(rowMax, r1)

  const rows: React.ReactNode[] = []
  for (let r = first; r <= last; r++) {
    const cells: React.ReactNode[] = []
    for (let c = 0; c < columns; c++) {
      const index = wrapOrigin + r * columns + c
      if (index < 0 || index >= count) continue
      cells.push(
        <div
          key={index}
          style={{
            position: 'absolute',
            left: c * pitch,
            top: 0,
            width: tile,
            height: tile,
          }}
        >
          {renderItem(items[index], index, tile)}
        </div>
      )
    }
    rows.push(
      <div
        key={r}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: (r - rowMin) * pitch,
          height: tile,
        }}
      >
        {cells}
      </div>
    )
  }

  return (
    <div
      ref={layerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        transformOrigin: '0 0',
        willChange: 'transform, opacity',
      }}
    >
      {rows}
    </div>
  )
}

export default ZoomLayer
