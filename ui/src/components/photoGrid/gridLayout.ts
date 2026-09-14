/**
 * Pure layout math for the virtualized photo grid.
 * Kept free of React so it can be unit tested directly.
 *
 * The grid is defined by a column count (the zoom level); the tile size is
 * derived from the container width so the photos always fill it edge to edge.
 */

export const GRID_GAP = 4
export const SECTION_GAP = 18
export const SECTION_HEADER_HEIGHT = 44

/**
 * Column counts up to this value render sticky section header bars.
 * Denser levels (more columns) show a floating date overlay instead.
 */
export const MAX_COLUMNS_FOR_HEADERS = 5

/**
 * Dense levels (more columns than MAX_COLUMNS_FOR_HEADERS) render the
 * whole list as one continuous block: no tile gaps, no section gaps and
 * no section boundaries in the layout at all.
 */
export function isDenseLevel(columns: number): boolean {
  return columns > MAX_COLUMNS_FOR_HEADERS
}

export type GridSectionData<T> = {
  key: string
  title?: string
  items: T[]
}

export type SectionLayout = {
  key: string
  title?: string
  /** absolute top offset in px inside the grid container */
  offset: number
  height: number
  cols: number
  rows: number
  /** number of items in this section */
  count: number
  /** index of the first item of this section in the flat list */
  firstIndex: number
  /** whether a header bar is rendered above this section's rows */
  hasHeader: boolean
}

export type GridLayout = {
  sections: SectionLayout[]
  totalHeight: number
  itemCount: number
  columns: number
  /** tile size in px, derived from the container width and column count */
  tileSize: number
  /** height of the section header bar (when rendered) */
  headerHeight: number
  gap: number
}

export type ComputeLayoutOptions = {
  gap?: number
  headerHeight?: number
  /** render sticky header bars for titled sections (false = floating mode) */
  renderHeaders?: boolean
  sectionGap?: number
}

/** Tile size that fits `columns` tiles edge to edge into `containerWidth`. */
export function tileSizeForColumns(
  containerWidth: number,
  columns: number,
  gap = GRID_GAP
): number {
  return Math.max(16, Math.floor((containerWidth - (columns - 1) * gap) / columns))
}

/**
 * Sectionized items flattened into a single continuous block, keeping the
 * original group order. Returns the flat list plus the start index and
 * title of every group (used by the floating date overlay).
 */
export function flattenSections<T>(
  sections: GridSectionData<T>[]
): { items: T[]; groups: { firstIndex: number; title?: string }[] } {
  const items: T[] = []
  const groups: { firstIndex: number; title?: string }[] = []

  for (const section of sections) {
    groups.push({ firstIndex: items.length, title: section.title })
    items.push(...section.items)
  }

  return { items, groups }
}

/**
 * The group whose range contains the given flat index.
 */
export function groupForIndex(
  groups: { firstIndex: number; title?: string }[],
  flatIndex: number
): { firstIndex: number; title?: string } | null {
  for (let i = groups.length - 1; i >= 0; i--) {
    if (flatIndex >= groups[i].firstIndex) return groups[i]
  }
  return null
}

export function computeLayout<T>(
  sections: GridSectionData<T>[],
  width: number,
  columns: number,
  options?: ComputeLayoutOptions
): GridLayout {
  const gap = options?.gap ?? GRID_GAP
  const headerHeight = options?.headerHeight ?? SECTION_HEADER_HEIGHT
  const renderHeaders = options?.renderHeaders ?? true
  const sectionGap = options?.sectionGap ?? SECTION_GAP

  const cols = Math.max(1, columns)
  const tileSize = tileSizeForColumns(width, cols, gap)

  let offset = 0
  let firstIndex = 0
  const sectionLayouts: SectionLayout[] = []

  for (const section of sections) {
    const count = section.items.length
    const rows = Math.ceil(count / cols)
    const hasHeader = renderHeaders && section.title != null
    const height =
      (hasHeader ? headerHeight : 0) + rows * tileSize + (rows - 1) * gap

    sectionLayouts.push({
      key: section.key,
      title: section.title,
      offset,
      height,
      cols,
      rows,
      count,
      firstIndex,
      hasHeader,
    })

    offset += height + sectionGap
    firstIndex += count
  }

  return {
    sections: sectionLayouts,
    totalHeight: offset,
    itemCount: firstIndex,
    columns: cols,
    tileSize,
    headerHeight,
    gap,
  }
}

/**
 * Find the section containing (or nearest above) the given absolute flat index.
 */
export function sectionForIndex(
  layout: GridLayout,
  flatIndex: number
): SectionLayout | null {
  for (let i = layout.sections.length - 1; i >= 0; i--) {
    if (flatIndex >= layout.sections[i].firstIndex) {
      return layout.sections[i]
    }
  }
  return null
}

/** Top of the section's row area (below its header bar, if any). */
function gridTopOf(section: SectionLayout, layout: GridLayout): number {
  return section.offset + (section.hasHeader ? layout.headerHeight : 0)
}

/**
 * Absolute Y position of the row containing the given flat index.
 */
export function itemTop(layout: GridLayout, flatIndex: number): number {
  const section = sectionForIndex(layout, flatIndex)
  if (section == null) return 0

  const indexInSection = flatIndex - section.firstIndex
  const row = Math.floor(indexInSection / section.cols)

  return (
    gridTopOf(section, layout) + row * (layout.tileSize + layout.gap)
  )
}

/**
 * The flat index of the first item whose row intersects the given Y position.
 * Used to find the anchor item when zooming.
 */
export function indexAtY(layout: GridLayout, y: number): number {
  const cell = layout.tileSize + layout.gap
  for (const section of layout.sections) {
    const sectionBottom = section.offset + section.height
    if (
      y < sectionBottom ||
      section === layout.sections[layout.sections.length - 1]
    ) {
      const relative = Math.max(0, y - gridTopOf(section, layout))
      const row = Math.floor(relative / cell)
      const clampedRow = Math.max(0, Math.min(section.rows - 1, row))
      return section.firstIndex + clampedRow * section.cols
    }
  }
  return 0
}

/**
 * Range of rows of a section that intersect the viewport [top, bottom].
 * Returns [firstRow, lastRow] inclusive, or null when not visible.
 */
export function visibleRowRange(
  section: SectionLayout,
  layout: GridLayout,
  viewportTop: number,
  viewportBottom: number,
  overscanRows = 2
): [number, number] | null {
  const sectionTop = section.offset
  const sectionBottom = section.offset + section.height
  if (sectionBottom < viewportTop || sectionTop > viewportBottom) return null

  const cell = layout.tileSize + layout.gap
  const gridTop = gridTopOf(section, layout)

  const firstRow = Math.max(
    0,
    Math.floor((viewportTop - gridTop) / cell) - overscanRows
  )
  const lastRow = Math.min(
    section.rows - 1,
    Math.ceil((viewportBottom - gridTop) / cell) + overscanRows
  )

  if (lastRow < firstRow) return null
  return [firstRow, lastRow]
}

/**
 * Zoom anchoring: keeps the content under a viewport point stable while the
 * column count (and therefore the whole list layout) changes.
 *
 * The anchor is the item row containing the anchor point plus the sub-row
 * pixel offset, so restoration is precise to the pixel instead of snapping
 * to row boundaries.
 */
export type ZoomAnchor = {
  /** flat index of the item whose row contains the anchor point */
  index: number
  /** distance from the anchor row's top to the anchor point, in px at capture time */
  offset: number
  /** tile size at capture time; the offset scales proportionally with it */
  tile: number
  /** viewport Y position the anchor should stay at */
  viewportY: number
}

export function captureZoomAnchor(
  layout: GridLayout,
  contentY: number,
  viewportY: number
): ZoomAnchor {
  const index = indexAtY(layout, contentY)
  const top = itemTop(layout, index)
  return { index, offset: Math.max(0, contentY - top), tile: layout.tileSize, viewportY }
}

/**
 * Scroll position that puts the anchor (with its offset scaled to the new
 * tile size) back at its captured viewport position.
 * Always >= 0; larger values are clamped by the browser to the scroll max.
 */
export function scrollForZoomAnchor(
  anchor: ZoomAnchor,
  layout: GridLayout
): number {
  const rowTop = itemTop(layout, anchor.index)
  const scaledOffset = anchor.offset * (layout.tileSize / anchor.tile)
  return Math.max(0, rowTop + scaledOffset - anchor.viewportY)
}

/**
 * Pick the thumbnail URL best suited for a tile of the given CSS size.
 * Uses the device pixel ratio (capped at 3) to choose between the
 * tiny (128px), small (256px) and regular (1024px) renditions.
 */
export function thumbSourceFor(
  tile: number,
  media: {
    thumbnailTiny?: { url: string } | null
    thumbnailSmall?: { url: string } | null
    thumbnail?: { url: string } | null
  },
  devicePixelRatio?: number
): string | undefined {
  const dpr =
    devicePixelRatio ??
    (typeof window === 'undefined'
      ? 1
      : Math.min(window.devicePixelRatio || 1, 3))
  const needed = tile * dpr

  if (needed <= 150 && media.thumbnailTiny?.url) return media.thumbnailTiny.url
  if (needed <= 300 && (media.thumbnailSmall?.url || media.thumbnailTiny?.url))
    return media.thumbnailSmall?.url || media.thumbnailTiny?.url
  return (
    media.thumbnail?.url ||
    media.thumbnailSmall?.url ||
    media.thumbnailTiny?.url
  )
}
