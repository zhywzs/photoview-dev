import React, { useLayoutEffect, useMemo, useRef } from 'react'
import {
  computeLayout,
  GridLayout,
  GridSectionData,
  flattenSections,
  visibleRowRange,
  GRID_GAP,
} from './gridLayout'

/** Visual rect of a tile in grid-container coordinates. */
export type MorphRect = { x: number; y: number; w: number }
/** A captured tile: its rect plus its flat index (to resolve the item). */
export type MorphCapture = MorphRect & { index: number }

export type MorphHandle = {
  /** 0 = source layout, 1 = target layout. */
  setProgress(progress: number): void
  /** Vertical offset currently applied to keep the anchor under the fingers. */
  getOffsetY(): number
}

type MorphTile = {
  id: string
  item: unknown
  index: number
  start: MorphRect
  end: MorphRect
  /** tile only exists in the source layout: it fades out in place */
  fadeOut: boolean
}

type MorphLayerProps<T> = {
  /** Grouped sections (not flattened); the layer flattens for dense targets. */
  sections: GridSectionData<T>[]
  /** Flat items in timeline order (resolves captured indices to items). */
  flatItems: T[]
  width: number
  fromColumns: number
  fromDense: boolean
  toColumns: number
  toDense: boolean
  fromRects: Map<string, MorphCapture>
  fromHeight: number
  anchorId: string | null
  anchorScreenY: number
  containerDocTop: number
  scrollY: number
  viewportHeight: number
  itemKey(item: T): string
  renderItem(item: T, index: number, tileSize: number): React.ReactNode
  handleRef?: React.MutableRefObject<MorphHandle | null>
}

const OVERSCAN_ROWS = 4

function tileWidthFor(
  width: number,
  columns: number,
  dense: boolean
): number {
  const gap = dense ? 0 : GRID_GAP
  return Math.max(1, width / columns - (gap * (columns - 1)) / columns)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Morph layer used while a pinch zoom is in flight.
 *
 * The source layout is whatever is currently on screen (captured as rects),
 * the target layout is precomputed for the level the gesture is heading to.
 * The union of both is rendered once; every tile then interpolates between its
 * source and target position/size as the gesture progresses. Tiles that only
 * exist in the target (the ones that were off-screen) start parked just
 * outside the viewport and slide in immediately, and tiles that only exist in
 * the source fade out - so the two layouts continuously trade places instead
 * of snapping.
 */
const MorphLayer = <T,>({
  sections,
  flatItems,
  width,
  fromColumns,
  fromDense,
  toColumns,
  toDense,
  fromRects,
  fromHeight,
  anchorId,
  anchorScreenY,
  containerDocTop,
  scrollY,
  viewportHeight,
  itemKey,
  renderItem,
  handleRef,
}: MorphLayerProps<T>) => {
  const outerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const tileRefs = useRef(new Map<string, HTMLDivElement>())

  const toTileWidth = tileWidthFor(width, toColumns, toDense)
  const fromTileWidth = tileWidthFor(width, fromColumns, fromDense)

  const toGap = toDense ? 0 : GRID_GAP
  const preparedSections = useMemo<GridSectionData<T>[]>(
    () =>
      toDense && sections.length > 0
        ? [{ key: '__dense__', items: flattenSections(sections).items }]
        : sections,
    [sections, toDense]
  )

  // ---- target layout (the level the gesture is heading towards) ----
  const toLayout = useMemo<GridLayout>(
    () =>
      computeLayout(preparedSections, width, toColumns, {
        gap: toGap,
        renderHeaders: !toDense && sections.some(s => s.title != null),
      }),
    [preparedSections, width, toColumns, toDense, toGap, sections]
  )

  // ---- union of source and target tiles ----
  const tiles = useMemo<MorphTile[]>(() => {
    const byId = new Map<string, MorphTile>()

    // source-only tiles (rendered now, off the target view): fade out in place
    for (const [id, rect] of fromRects) {
      byId.set(id, {
        id,
        item: flatItems[rect.index],
        index: rect.index,
        start: { x: rect.x, y: rect.y, w: rect.w },
        end: { x: rect.x, y: rect.y, w: toTileWidth },
        fadeOut: true,
      })
    }

    // target tiles: start where they are now, or parked outside the viewport
    const margin = viewportHeight
    const parkTop = scrollY - containerDocTop - margin
    const parkBottom = scrollY - containerDocTop + viewportHeight + margin
    const rowPitch = toLayout.tileSize + toGap
    const hPitch = toColumns > 0 ? (width + toGap) / toColumns : 0

    for (const section of toLayout.sections) {
      const range = visibleRowRange(
        section,
        toLayout,
        parkTop,
        parkBottom,
        OVERSCAN_ROWS
      )
      if (range == null) continue
      const [firstRow, lastRow] = range
      const sectionData = preparedSections.find(s => s.key == section.key)
      if (sectionData == null) continue

      const start = firstRow * section.cols
      const end = Math.min(
        sectionData.items.length,
        (lastRow + 1) * section.cols
      )
      const gridTop =
        section.offset + (section.hasHeader ? toLayout.headerHeight : 0)

      for (let i = start; i < end; i++) {
        const item = sectionData.items[i]
        if (item == null) continue
        const id = itemKey(item)
        const index = section.firstIndex + i
        const endX = (i % section.cols) * hPitch
        const endY = gridTop + Math.floor(i / section.cols) * rowPitch
        const existing = byId.get(id)

        if (existing != null) {
          // already a source tile: give it its target position/size
          existing.start = fromRects.get(id) ?? {
            x: endX,
            y: clamp(endY, parkTop, parkBottom),
            w: fromTileWidth,
          }
          existing.end = { x: endX, y: endY, w: toTileWidth }
          existing.fadeOut = false
          existing.item = item
          existing.index = index
          continue
        }

        byId.set(id, {
          id,
          item,
          index,
          start: {
            x: endX,
            y: clamp(endY, parkTop, parkBottom),
            w: fromTileWidth,
          },
          end: { x: endX, y: endY, w: toTileWidth },
          fadeOut: false,
        })
      }
    }

    return Array.from(byId.values())
  }, [
    fromRects,
    flatItems,
    preparedSections,
    toLayout,
    toColumns,
    toGap,
    toTileWidth,
    fromTileWidth,
    itemKey,
    scrollY,
    containerDocTop,
    viewportHeight,
    width,
  ])

  // ---- anchor offset so the content under the fingers stays put ----
  const anchor = useMemo(() => {
    if (anchorId == null) return { startY: 0, endY: 0 }
    const tile = tiles.find(t => t.id == anchorId)
    if (tile == null) return { startY: 0, endY: 0 }
    return { startY: tile.start.y, endY: tile.end.y }
  }, [tiles, anchorId])

  const offsetAt = (progress: number): number => {
    const y = lerp(anchor.startY, anchor.endY, progress)
    const screenY = containerDocTop + y - scrollY
    return anchorScreenY - screenY
  }

  // ---- imperative progress updates (no React re-render per frame) ----
  const progressRef = useRef(0)
  const apply = (progress: number) => {
    const p = Math.max(0, Math.min(1, progress))
    progressRef.current = p
    // the anchor offset is baked into every tile so that, at a commit, it can
    // be folded into the scroll by simply shifting the scroll by -offset
    const offsetY = offsetAt(p)
    for (const tile of tiles) {
      const el = tileRefs.current.get(tile.id)
      if (el == null) continue
      const x = lerp(tile.start.x, tile.end.x, p)
      const y = lerp(tile.start.y, tile.end.y, p) + offsetY
      const w = lerp(tile.start.w, tile.end.w, p)
      el.style.transform = `translate(${x}px, ${y}px) scale(${w / tile.end.w})`
      el.style.opacity = tile.fadeOut ? `${1 - p}` : '1'
    }
    if (innerRef.current != null) {
      innerRef.current.style.height = `${lerp(
        fromHeight,
        toLayout.totalHeight,
        p
      )}px`
    }
  }

  useLayoutEffect(() => {
    if (handleRef != null) {
      handleRef.current = {
        setProgress: apply,
        getOffsetY: () => offsetAt(progressRef.current),
      }
    }
    apply(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, toLayout, fromHeight])

  return (
    <div
      ref={outerRef}
      style={{ position: 'relative', width: '100%', pointerEvents: 'none' }}
    >
      <div ref={innerRef} style={{ position: 'relative', height: fromHeight }}>
        {tiles.map(tile => (
          <div
            key={tile.id}
            ref={el => {
              if (el != null) tileRefs.current.set(tile.id, el)
              else tileRefs.current.delete(tile.id)
            }}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: tile.end.w,
              height: tile.end.w,
              transformOrigin: '0 0',
              willChange: 'transform, opacity',
            }}
          >
            {renderItem(
              tile.item as T,
              tile.index,
              tile.end.w
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default MorphLayer
