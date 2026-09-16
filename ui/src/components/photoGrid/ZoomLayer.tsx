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
  /** absolute row range to render (inclusive) */
  r0: number
  r1: number
  renderItem(item: T, index: number, tileSize: number): React.ReactNode
  layerRef?: React.MutableRefObject<HTMLDivElement | null>
}

/**
 * One zoom layer: a plain grid of photos for a (columns, wrap origin) layout,
 * laid out in the layer's own coordinates (tile (r,c) at
 * `(c*pitch, (r-rowMin)*pitch)`). The owner moves/scales the whole layer with
 * a single transform, so nothing re-renders while zooming.
 */
const ZoomLayer = <T,>({
  items,
  columns,
  wrapOrigin,
  width,
  gapRatio = GAP_RATIO,
  r0,
  r1,
  renderItem,
  layerRef,
}: ZoomLayerProps<T>) => {
  const tile = tileForColumns(width, columns, gapRatio)
  const pitch = tile * (1 + gapRatio)
  const rowMin = rowMinFor(wrapOrigin, columns)
  const count = items.length

  const tiles: React.ReactNode[] = []
  for (let r = Math.max(rowMin, r0); r <= r1; r++) {
    for (let c = 0; c < columns; c++) {
      const index = wrapOrigin + r * columns + c
      if (index < 0 || index >= count) continue
      tiles.push(
        <div
          key={index}
          style={{
            position: 'absolute',
            left: c * pitch,
            top: (r - rowMin) * pitch,
            width: tile,
            height: tile,
          }}
        >
          {renderItem(items[index], index, tile)}
        </div>
      )
    }
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
      {tiles}
    </div>
  )
}

export default ZoomLayer
