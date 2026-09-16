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

export type ZoomLayerProps<T> = {
  items: T[]
  columns: number
  /** ordered index placed at slot (0,0) */
  wrapOrigin: number
  width: number
  gapRatio?: number
  renderItem(item: T, index: number, tileSize: number): React.ReactNode
  layerRef?: React.MutableRefObject<HTMLDivElement | null>
}

/**
 * One zoom layer: a grid of photos for a (columns, wrap origin) layout, laid
 * out in the layer's own coordinates (tile (r,c) at
 * `(c*pitch, (r-rowMin)*pitch)`). The owner moves/scales the whole layer with a
 * single transform.
 *
 * Every row is rendered; off-screen rows are skipped by the browser thanks to
 * `content-visibility: auto`, so the grid is never missing a row (no blank
 * areas) while still staying cheap to scroll.
 */
const ZoomLayer = <T,>({
  items,
  columns,
  wrapOrigin,
  width,
  gapRatio = GAP_RATIO,
  renderItem,
  layerRef,
}: ZoomLayerProps<T>) => {
  const tile = tileForColumns(width, columns, gapRatio)
  const pitch = tile * (1 + gapRatio)
  const rowMin = rowMinFor(wrapOrigin, columns)
  const rowMax = rowMaxFor(wrapOrigin, columns, items.length)
  const count = items.length

  const rows: React.ReactNode[] = []
  for (let r = rowMin; r <= rowMax; r++) {
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
          contentVisibility: 'auto',
        } as React.CSSProperties}
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
