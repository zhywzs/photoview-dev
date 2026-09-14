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

/**
 * Window-scroll based virtualized grid.
 *
 * Renders only the rows of the sections that intersect the viewport, so the
 * DOM stays small (~columns x visible rows) even with thousands of items.
 * All sections are absolutely positioned inside a container with the full
 * computed height, so the window scrollbar reflects the whole list.
 */
const VirtualGrid = <T,>({
  sections,
  columns,
  gap = GRID_GAP,
  renderHeaders = true,
  overscanRows = 3,
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

  const layoutRef = useRef(layout)
  layoutRef.current = layout

  useLayoutEffect(() => {
    onLayoutChange?.(layout)
  }, [layout, onLayoutChange])

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

        return {
          section,
          firstRow,
          items: sectionData.items.slice(start, end),
          startIndex: start,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
  }, [layout, sections, viewport])

  const renderRow = useCallback(
    (sectionIndex: number) => {
      const { section, firstRow, items, startIndex } =
        visibleSections[sectionIndex]
      const tileSize = layout.tileSize

      const rows: React.ReactNode[] = []
      for (let row = 0; row < Math.ceil(items.length / section.cols); row++) {
        const rowTop =
          (section.hasHeader ? layout.headerHeight : 0) +
          (firstRow + row) * (tileSize + gap)

        const rowItems: React.ReactNode[] = []
        for (let col = 0; col < section.cols; col++) {
          const i = row * section.cols + col
          if (i >= items.length) break
          rowItems.push(
            <React.Fragment key={col}>
              {renderItem(
                items[i],
                section.firstIndex + startIndex + i,
                tileSize
              )}
            </React.Fragment>
          )
        }

        rows.push(
          <div
            key={firstRow + row}
            style={{
              position: 'absolute',
              top: rowTop,
              left: 0,
              right: 0,
              display: 'flex',
              gap,
              height: tileSize,
            }}
          >
            {rowItems}
          </div>
        )
      }
      return rows
    },
    [visibleSections, layout, gap, renderItem]
  )

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ height: layout.totalHeight, position: 'relative' }}>
        {visibleSections.map(({ section }, i) => (
          <div
            key={section.key}
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
            {renderRow(i)}
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
