import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import {
  computeLayout,
  GridLayout,
  GridSectionData,
  ZoomAnchor,
  scrollForZoomAnchor,
  visibleRowRange,
  GRID_GAP,
  SECTION_HEADER_HEIGHT,
} from './gridLayout'
import { prefersReducedMotion, TILE_TRANSITION_MS } from './motion'

const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** sub-pixel moves below this are ignored (avoids pointless animations) */
const FLIP_MIN_PX = 0.5
/** scale differences below this are treated as "no size change" */
const FLIP_MIN_SCALE = 0.002

/** Visual position/size of a tile in document space (for the FLIP start). */
export type TileVisual = { x: number; y: number; w: number }

export type TileRegistry = Map<string, HTMLDivElement>

type VirtualGridProps<T> = {
  sections: GridSectionData<T>[]
  /** column count (the zoom level); tiles fill the container edge to edge */
  columns: number
  gap?: number
  /**
   * Render sticky header bars for titled sections (few column levels).
   * When false, titled sections reserve no header space and the title is
   * expected to be shown by a floating overlay.
   */
  renderHeaders?: boolean
  /** extra rows rendered above/below the viewport */
  overscanRows?: number
  /** stable identity of an item, so DOM nodes survive list reorders */
  itemKey(item: T): string
  renderItem: (
    item: T,
    absoluteIndex: number,
    tileSize: number
  ) => React.ReactNode
  renderSectionTitle?: (title: string, sectionKey: string) => React.ReactNode
  /** Called whenever the layout is recomputed (width / columns / data changed) */
  onLayoutChange?: (layout: GridLayout) => void
  /**
   * Called with the absolute index range of the rendered items (including
   * overscan). Lets the parent prefetch assets for what is on screen.
   */
  onVisibleRange?: (first: number, last: number) => void
  /**
   * Content point that must stay under the user's fingers while the grid
   * reflows (zoom). When set, every layout change restores the scroll so the
   * anchored item keeps its viewport position, and the tiles that move are
   * FLIP-animated from their current visual position/size.
   */
  zoomAnchor?: ZoomAnchor | null
  /** Live registry of rendered tile elements (shared with the owner). */
  tiles: React.MutableRefObject<TileRegistry>
  /**
   * Visual rects captured in the gesture handler *before* the layout update.
   * When present it is used as the FLIP start, which keeps an interrupted
   * animation continuous; otherwise the previous layout geometry is used.
   */
  pendingRects?: React.MutableRefObject<Map<string, TileVisual> | null>
}

type ViewportState = {
  top: number
  bottom: number
}

/** One rendered tile: its identity and its absolute position in the grid. */
type GridEntry<T> = {
  id: string
  item: T
  absoluteIndex: number
  /** absolute top offset inside the grid container */
  top: number
  /** left offset inside the grid container */
  left: number
}

type Move = {
  el: HTMLElement
  dx: number
  dy: number
  scale: number
}

/**
 * Window-scroll based virtualized grid.
 *
 * Every tile is a keyed, absolutely positioned box and all tiles are siblings
 * in a single flat list, regardless of the section (= date group) they belong
 * to. Keeping one stable list is what makes zooming smooth: changing the zoom
 * level changes the date grouping and the tile size, but the tile DOM nodes
 * (and therefore their decoded images) survive, so only their position/size
 * changes.
 *
 * Geometry changes are animated with a FLIP: on each layout change every
 * survivor is translated/scaled from its previous visual position back to
 * zero. The start position comes from rects captured right before the update
 * (so an in-flight animation interrupted by the next zoom step continues from
 * where it is) or, for list changes, from the previous layout. Nothing is
 * ever remounted or re-fetched because of a zoom - the containers just move
 * and the images inside load independently.
 */
const VirtualGrid = <T,>({
  sections,
  columns,
  gap = GRID_GAP,
  renderHeaders = true,
  overscanRows = 3,
  itemKey,
  renderItem,
  renderSectionTitle,
  onLayoutChange,
  onVisibleRange,
  zoomAnchor,
  tiles,
  pendingRects,
}: VirtualGridProps<T>) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [viewport, setViewport] = useState<ViewportState>({ top: 0, bottom: 0 })

  // measure container width
  useEffect(() => {
    const elem = containerRef.current
    if (elem == null) return

    const updateWidth = () => setWidth(elem.clientWidth)
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      // fallback for environments without ResizeObserver (e.g. jsdom)
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(elem)
    return () => observer.disconnect()
  }, [])

  // track window scroll (rAF throttled)
  useEffect(() => {
    let raf = 0
    const updateViewport = () => {
      raf = 0
      // some test environments report 0; fall back to a sane height
      const viewportHeight = window.innerHeight || 800
      setViewport({
        top: window.scrollY,
        bottom: window.scrollY + viewportHeight,
      })
    }
    const onScroll = () => {
      if (raf == 0) raf = window.requestAnimationFrame(updateViewport)
    }

    updateViewport()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf != 0) window.cancelAnimationFrame(raf)
    }
  }, [])

  const layout = useMemo(
    () =>
      computeLayout(
        sections,
        // jsdom and pre-layout measurements report 0; fall back to the
        // window width so column computation stays sane
        width || (typeof window !== 'undefined' ? window.innerWidth : 0),
        columns,
        { gap, renderHeaders }
      ),
    [sections, width, columns, gap, renderHeaders]
  )

  useLayoutEffect(() => {
    onLayoutChange?.(layout)
  }, [layout, onLayoutChange])

  // The vertical layout uses the integer tile size (so section heights and
  // scroll anchoring stay exact); horizontally we fill the container to the
  // pixel with the un-rounded tile width/fractional pitch.
  const renderWidth =
    width || (typeof window !== 'undefined' ? window.innerWidth : 0)
  const horizontalPitch =
    layout.columns > 0 ? (renderWidth + gap) / layout.columns : 0
  const tileWidth =
    layout.columns > 0
      ? renderWidth / layout.columns -
        (gap * (layout.columns - 1)) / layout.columns
      : layout.tileSize

  const visibleSections = useMemo(() => {
    const rowPitch = layout.tileSize + gap
    return layout.sections
      .map(section => {
        const rowRange = visibleRowRange(
          section,
          layout,
          viewport.top,
          viewport.bottom,
          overscanRows
        )
        if (rowRange == null) return null

        const [firstRow, lastRow] = rowRange
        const sectionData = sections.find(s => s.key == section.key)
        if (sectionData == null) return null

        const start = firstRow * section.cols
        const end = Math.min(
          sectionData.items.length,
          (lastRow + 1) * section.cols
        )

        const gridTop =
          section.offset + (section.hasHeader ? layout.headerHeight : 0)
        const entries: GridEntry<T>[] = []
        for (let i = start; i < end; i++) {
          const item = sectionData.items[i]
          if (item == null) continue
          entries.push({
            id: itemKey(item),
            item,
            absoluteIndex: section.firstIndex + i,
            top: gridTop + Math.floor(i / section.cols) * rowPitch,
            left: (i % section.cols) * horizontalPitch,
          })
        }

        return { section, entries }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
  }, [
    layout,
    sections,
    viewport,
    overscanRows,
    gap,
    horizontalPitch,
    itemKey,
  ])

  // Flat list of every visible tile, all siblings in one container so React
  // reuses their DOM nodes across zoom level changes.
  const entries = useMemo(
    () => visibleSections.flatMap(section => section.entries),
    [visibleSections]
  )

  const prevGeo = React.useRef(new Map<string, { top: number; left: number }>())
  const prevTile = React.useRef<number | null>(null)
  const prevLayout = React.useRef<GridLayout | null>(null)
  const prevWidth = React.useRef<number | null>(null)

  const registerTile = useCallback(
    (el: HTMLDivElement | null) => {
      if (el == null) return
      const id = el.dataset.tileId
      if (id != null) tiles.current.set(id, el)
    },
    [tiles]
  )

  useLayoutEffect(() => {
    const layoutChanged = prevLayout.current !== layout
    const widthChanged =
      prevWidth.current != null &&
      Math.abs(prevWidth.current - renderWidth) > 0.5

    const canAnimate =
      layoutChanged &&
      !widthChanged &&
      prevLayout.current != null &&
      !prefersReducedMotion()

    // 1. decide the FLIP start rects. Prefer the rects captured before the
    //    update (zoom gestures); otherwise fall back to the previous layout.
    const pending = pendingRects?.current ?? null
    // only consume the captured rects on an actual layout change; a stray
    // re-render (e.g. an atlas update) must not throw them away
    if (layoutChanged && pendingRects != null) pendingRects.current = null

    let measured: Map<string, TileVisual> | null = null
    if (canAnimate) {
      if (pending != null) {
        measured = pending
      } else {
        measured = new Map()
        const prevTileSize = prevTile.current
        for (const entry of entries) {
          const prev = prevGeo.current.get(entry.id)
          if (prev == null) continue
          measured.set(entry.id, {
            x: prev.left,
            y: prev.top,
            w: prevTileSize ?? tileWidth,
          })
        }
      }
    }

    // rects captured in the gesture handler are in document space; tile
    // positions are relative to the grid container, so normalize by its
    // document origin (scroll-independent)
    let originX = 0
    let originY = 0
    if (measured != null && pending != null) {
      const cRect = containerRef.current?.getBoundingClientRect()
      originX = (cRect?.left ?? 0) + window.scrollX
      originY = (cRect?.top ?? 0) + window.scrollY
    }

    // 2. restore the scroll so the anchored content point stays under the
    //    fingers while the layout reflows
    const oldScroll = window.scrollY
    if (layoutChanged && zoomAnchor != null && layout.itemCount > 0) {
      const target = scrollForZoomAnchor(zoomAnchor, layout)
      if (Math.abs(target - window.scrollY) >= 0.5) window.scrollTo(0, target)
    }
    const scrollDelta = window.scrollY - oldScroll

    // 3. FLIP each survivor from its start rect to its new geometry
    const moves: Move[] = []
    if (measured != null) {
      for (const entry of entries) {
        const m = measured.get(entry.id)
        const el = tiles.current.get(entry.id)
        if (m == null || el == null) continue

        const dx = m.x - originX - entry.left
        const dy = m.y - originY - entry.top + scrollDelta
        const scale = tileWidth > 0 ? m.w / tileWidth : 1
        if (
          Math.abs(dx) < FLIP_MIN_PX &&
          Math.abs(dy) < FLIP_MIN_PX &&
          Math.abs(scale - 1) < FLIP_MIN_SCALE
        ) {
          continue
        }
        moves.push({ el, dx, dy, scale })
      }
    }

    if (moves.length > 0) {
      for (const { el, dx, dy, scale } of moves) {
        el.style.willChange = 'transform'
        el.style.transition = 'none'
        el.style.transformOrigin = '0 0'
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
      }
      // force a single reflow so the browser acknowledges the start state
      void containerRef.current?.offsetHeight
      for (const { el } of moves) {
        el.style.transition = `transform ${TILE_TRANSITION_MS}ms ${FLIP_EASING}`
        el.style.transform = ''
      }
      window.setTimeout(() => {
        for (const { el } of moves) el.style.willChange = ''
      }, TILE_TRANSITION_MS + 80)
    }

    // 4. prune dead refs, remember the layout and report the rendered range
    const nextGeo = new Map<string, { top: number; left: number }>()
    const liveIds = new Set<string>()
    let first = -1
    let last = -1
    for (const entry of entries) {
      liveIds.add(entry.id)
      nextGeo.set(entry.id, { left: entry.left, top: entry.top })
      if (first < 0 || entry.absoluteIndex < first) first = entry.absoluteIndex
      if (entry.absoluteIndex > last) last = entry.absoluteIndex
    }
    for (const id of Array.from(tiles.current.keys())) {
      if (!liveIds.has(id)) tiles.current.delete(id)
    }

    prevGeo.current = nextGeo
    prevTile.current = tileWidth
    prevLayout.current = layout
    prevWidth.current = renderWidth

    onVisibleRange?.(first, last)
  }, [
    entries,
    layout,
    tileWidth,
    renderWidth,
    zoomAnchor,
    onVisibleRange,
    tiles,
    pendingRects,
  ])

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ height: layout.totalHeight, position: 'relative' }}>
        {/* section headers live in their own overlay layer so that the tile
            list below stays a single, stable set of DOM nodes */}
        {renderHeaders &&
          visibleSections.map(({ section }) =>
            section.hasHeader ? (
              <div
                key={`header:${section.key}`}
                style={{
                  position: 'absolute',
                  top: section.offset,
                  left: 0,
                  right: 0,
                  height: section.height,
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    height: SECTION_HEADER_HEIGHT,
                    pointerEvents: 'auto',
                  }}
                  className="backdrop-blur bg-white/85 dark:bg-dark-bg/85"
                >
                  {renderSectionTitle
                    ? renderSectionTitle(section.title!, section.key)
                    : defaultSectionTitle(section.title!)}
                </div>
              </div>
            ) : null
          )}

        {entries.map(entry => (
          <div
            key={entry.id}
            ref={registerTile}
            data-tile-id={entry.id}
            style={{
              position: 'absolute',
              top: entry.top,
              left: entry.left,
              width: tileWidth,
              height: tileWidth,
            }}
          >
            {renderItem(entry.item, entry.absoluteIndex, tileWidth)}
          </div>
        ))}
      </div>
    </div>
  )
}

const defaultSectionTitle = (title: string) => (
  <div className="h-full flex items-center px-1">
    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
      {title}
    </span>
  </div>
)

export default VirtualGrid
