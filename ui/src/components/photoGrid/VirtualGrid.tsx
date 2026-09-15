import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  computeLayout,
  GridLayout,
  GridSectionData,
  visibleRowRange,
  GRID_GAP,
  SECTION_HEADER_HEIGHT,
} from './gridLayout'
import { prefersReducedMotion } from './gridTransform'

/** duration of the gap-closing slide when tiles reflow (e.g. after a delete) */
const FLIP_DURATION_MS = 240
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** sub-pixel moves below this are ignored (avoids pointless animations) */
const FLIP_MIN_PX = 0.5

type VirtualGridProps<T> = {
  sections: GridSectionData<T>[]
  /** column count (the zoom level); tiles fill the container edge to edge */
  columns: number
  gap?: number
  /**
   * Render sticky header bars for titled sections (3/5 column levels).
   * When false, titled sections reserve no header space and the title is
   * expected to be shown by a floating overlay (15/30 column levels).
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
}

type ViewportState = {
  top: number
  bottom: number
}

/** One rendered tile: its identity and its position inside its section. */
type GridEntry<T> = {
  id: string
  item: T
  absoluteIndex: number
  /** top offset inside the owning section (already below its header) */
  top: number
  /** left offset inside the section */
  left: number
}

type Move = {
  el: HTMLElement
  dx: number
  dy: number
}

/**
 * Window-scroll based virtualized grid.
 *
 * Renders only the rows of the sections that intersect the viewport, so the
 * DOM stays small (~columns x visible rows) even with thousands of items.
 *
 * Every tile is a keyed, absolutely positioned box. Keying by media id (and
 * not by position) means a list change - most importantly deleting a photo -
 * reuses the existing DOM nodes: photos slide to fill the gap and their
 * already loaded images stay put instead of flashing. The slide is a FLIP
 * animation (measure the old position from the previous layout, transform
 * from there to zero) that is only armed when the geometry (tile size,
 * columns, width) is unchanged, so zooming and resizing do not fight it.
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
}: VirtualGridProps<T>) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
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

        const topBase = section.hasHeader ? layout.headerHeight : 0
        const rowPitch = layout.tileSize + gap
        const entries: GridEntry<T>[] = []
        for (let i = start; i < end; i++) {
          const item = sectionData.items[i]
          if (item == null) continue
          entries.push({
            id: itemKey(item),
            item,
            absoluteIndex: section.firstIndex + i,
            top: topBase + Math.floor(i / section.cols) * rowPitch,
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

  // ---- FLIP bookkeeping ----
  const sectionRefs = useRef(new Map<string, HTMLDivElement>())
  const tileRefs = useRef(new Map<string, HTMLDivElement>())
  const prevTilePos = useRef(
    new Map<string, { top: number; left: number; sectionKey: string }>()
  )
  const prevSectionOffsets = useRef(new Map<string, number>())
  const prevSig = useRef<string | null>(null)

  const registerSection = useCallback((el: HTMLDivElement | null) => {
    if (el == null) return
    const key = el.dataset.sectionKey
    if (key != null) sectionRefs.current.set(key, el)
  }, [])

  const registerTile = useCallback((el: HTMLDivElement | null) => {
    if (el == null) return
    const id = el.dataset.tileId
    if (id != null) tileRefs.current.set(id, el)
  }, [])

  useLayoutEffect(() => {
    const sig = [
      layout.columns,
      layout.tileSize,
      layout.headerHeight,
      gap,
      renderHeaders ? 1 : 0,
      Math.round(renderWidth),
    ].join('|')

    // Only animate when the geometry is stable: a column change (zoom) or a
    // resize relayouts everything and is handled elsewhere (the zoom host
    // transform), so FLIP would fight it.
    const canAnimate = prevSig.current === sig && !prefersReducedMotion()

    const nextTilePos = new Map<
      string,
      { top: number; left: number; sectionKey: string }
    >()
    const nextSectionOffsets = new Map<string, number>()
    const moves: Move[] = []

    for (const { section, entries } of visibleSections) {
      nextSectionOffsets.set(section.key, section.offset)

      if (canAnimate) {
        const sectionEl = sectionRefs.current.get(section.key)
        const prevOffset = prevSectionOffsets.current.get(section.key)
        if (sectionEl != null && prevOffset != null) {
          const dy = prevOffset - section.offset
          if (Math.abs(dy) >= FLIP_MIN_PX) moves.push({ el: sectionEl, dx: 0, dy })
        }
      }

      for (const entry of entries) {
        nextTilePos.set(entry.id, {
          top: entry.top,
          left: entry.left,
          sectionKey: section.key,
        })

        if (!canAnimate) continue
        const tileEl = tileRefs.current.get(entry.id)
        const prev = prevTilePos.current.get(entry.id)
        if (tileEl == null || prev == null || prev.sectionKey !== section.key)
          continue

        const dx = prev.left - entry.left
        const dy = prev.top - entry.top
        if (Math.abs(dx) >= FLIP_MIN_PX || Math.abs(dy) >= FLIP_MIN_PX) {
          moves.push({ el: tileEl, dx, dy })
        }
      }
    }

    if (moves.length > 0) {
      // First pin every moving element at its old position ...
      for (const { el, dx, dy } of moves) {
        el.style.transition = 'none'
        el.style.transform = `translate(${dx}px, ${dy}px)`
      }
      // ... force a single reflow so the browser acknowledges the start ...
      void containerRef.current?.offsetHeight
      // ... then release to zero and let the transition glide them over.
      for (const { el } of moves) {
        el.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`
        el.style.transform = ''
      }
    }

    // prune refs for nodes that are gone, then remember this layout
    for (const id of Array.from(tileRefs.current.keys())) {
      if (!nextTilePos.has(id)) tileRefs.current.delete(id)
    }
    for (const key of Array.from(sectionRefs.current.keys())) {
      if (!nextSectionOffsets.has(key)) sectionRefs.current.delete(key)
    }

    prevTilePos.current = nextTilePos
    prevSectionOffsets.current = nextSectionOffsets
    prevSig.current = sig
  }, [visibleSections, layout, gap, renderHeaders, renderWidth])

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ height: layout.totalHeight, position: 'relative' }}>
        {visibleSections.map(({ section, entries }) => (
          <div
            key={section.key}
            ref={registerSection}
            data-section-key={section.key}
            style={{
              position: 'absolute',
              top: section.offset,
              left: 0,
              right: 0,
              height: section.height,
            }}
          >
            {section.hasHeader && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  height: SECTION_HEADER_HEIGHT,
                }}
                className="backdrop-blur bg-white/85 dark:bg-dark-bg/85"
              >
                {renderSectionTitle
                  ? renderSectionTitle(section.title!, section.key)
                  : defaultSectionTitle(section.title!)}
              </div>
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
