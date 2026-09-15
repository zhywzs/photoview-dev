import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@apollo/client'
import VirtualGrid, { type TileVisual } from './VirtualGrid'
import PhotoTile from './PhotoTile'
import {
  GRID_GAP,
  GridLayout,
  GridSectionData,
  ZoomAnchor,
  captureZoomAnchor,
  flattenSections,
  groupForIndex,
  indexAtY,
  isDenseLevel,
  tileSizeForColumns,
} from './gridLayout'
import { clampColumns, useGridZoom } from './gridZoom'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import {
  AtlasTileMap,
  MEDIA_ATLASES_QUERY,
  buildAtlasMap,
  mediaAtlases,
  mediaAtlasesVariables,
} from './atlas'

/** accumulated wheel delta that advances one zoom step */
const WHEEL_LEVEL_THRESHOLD = 60
/** how long the floating date bar stays visible after scrolling stops */
const FLOATING_DATE_HIDE_DELAY = 1000
/** taps within this window after a pinch are swallowed */
const PINCH_TAP_SWALLOW_MS = 350
/** delay after the last zoom step before the new grouping is committed */
const ZOOM_SETTLE_MS = 150
/** how long the zoom anchor stays active after the last zoom step */
const ZOOM_ANCHOR_LINGER_MS = 600
/**
 * Single atlas sheet size for every zoom level. Because the image source no
 * longer depends on the zoom level, zooming never swaps or re-fetches an
 * image: only the tile container changes size, which is what keeps the zoom
 * itself perfectly smooth.
 */
const ATLAS_TILE_SIZE = 256

type PhotoGridProps<T extends MediaGalleryFields> = {
  /** Sectioned data (e.g. timeline grouped by day). Mutually exclusive with `items`. */
  sections?: GridSectionData<T>[]
  /** Flat data. Mutually exclusive with `sections`. */
  items?: T[]
  renderSectionTitle?: (title: string, sectionKey: string) => React.ReactNode
  /** Tap / click on a tile */
  onItemActivate(item: T, index: number): void
  /** Toggle favorite (hover action on large tiles) */
  onItemFavorite?(item: T, index: number): void
  /** id of the currently active (selected) media */
  activeId?: string
  /**
   * Column count the current `sections` were grouped for. While the user
   * zooms, the grid keeps using this grouping (and its dense/sparse mode) so
   * date headers and group boundaries do not jump mid-gesture; the new column
   * count is reported through `onColumnsChange` once the zoom settles and the
   * parent re-groups.
   */
  modeColumns?: number
  /** Called once a zoom gesture has settled, with the new column count. */
  onColumnsChange?(columns: number): void
}

/**
 * The photo grid: virtualized, zoomable and mobile friendly.
 *
 * Zoom interaction
 * ----------------
 *  - the zoom is a *continuous column count* in [MIN_COLUMNS, MAX_COLUMNS].
 *    A pinch maps the finger distance straight to a tile size, which is
 *    quantized to the nearest column count and reflows the grid one column at
 *    a time. There is no full-grid scale transform: the tile containers
 *    change size/position and each image loads independently.
 *  - the content point under the fingers is kept fixed by restoring the
 *    scroll for the new layout, and the surviving tiles are FLIP-animated
 *    from their previous position/size, so the change reads as continuous.
 *  - double tap toggles between the sparse (5) and dense (15) views; ctrl +
 *    wheel / trackpad pinch steps one column at a time.
 *  - the date grouping is frozen while zooming and only recomputed once the
 *    gesture settles.
 *
 * Date display
 * ------------
 *  - sparse modes render sticky section header bars
 *  - dense modes render no headers; instead a floating date pill appears
 *    while scrolling and fades out after 1s of inactivity
 */
const PhotoGrid = <T extends MediaGalleryFields>({
  sections: sectionsProp,
  items,
  renderSectionTitle,
  onItemActivate,
  onItemFavorite,
  activeId,
  modeColumns,
  onColumnsChange,
}: PhotoGridProps<T>) => {
  const zoom = useGridZoom()
  const columns = zoom.columns
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const sections = useMemo<GridSectionData<T>[]>(() => {
    if (sectionsProp != null) return sectionsProp
    if (items != null) return [{ key: '__all__', items }]
    return []
  }, [sectionsProp, items])

  // while zooming, the layout mode follows the grouping the parent gave us
  // (which lags until the zoom settles), so headers/gaps stay put during the
  // gesture and only switch once the new grouping arrives
  const mode = modeColumns ?? columns
  const hasTitles = sections.some(s => s.title != null)
  const dense = isDenseLevel(mode)
  const gap = dense ? 0 : GRID_GAP
  const renderHeaders = hasTitles && !dense
  const floatingDates = hasTitles && dense

  const gapRef = useRef(gap)
  gapRef.current = gap

  // dense modes render the whole list as one seamless block: all sections
  // are flattened so no group boundary interrupts the photo wall. The group
  // start indexes are kept for the floating date overlay.
  const { layoutSections, dateGroups } = useMemo(() => {
    if (!dense || sections.length == 0) {
      return { layoutSections: sections, dateGroups: [] }
    }
    const { items: flatItems, groups } = flattenSections(sections)
    return {
      layoutSections: [{ key: '__dense__', items: flatItems }],
      dateGroups: groups,
    }
  }, [sections, dense])

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef<GridLayout | null>(null)
  const tileRegistryRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const pendingRectsRef = useRef<Map<string, TileVisual> | null>(null)

  // ---- settle: report the new column count and drop the anchor ----
  const onColumnsChangeRef = useRef(onColumnsChange)
  onColumnsChangeRef.current = onColumnsChange
  const settleTimerRef = useRef<number | undefined>(undefined)
  const anchorTimerRef = useRef<number | undefined>(undefined)

  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current != null)
      window.clearTimeout(settleTimerRef.current)
    if (anchorTimerRef.current != null)
      window.clearTimeout(anchorTimerRef.current)

    settleTimerRef.current = window.setTimeout(() => {
      onColumnsChangeRef.current?.(columnsRef.current)
    }, ZOOM_SETTLE_MS)
    anchorTimerRef.current = window.setTimeout(() => {
      setZoomAnchor(null)
    }, ZOOM_ANCHOR_LINGER_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (settleTimerRef.current != null)
        window.clearTimeout(settleTimerRef.current)
      if (anchorTimerRef.current != null)
        window.clearTimeout(anchorTimerRef.current)
    }
  }, [])

  // ---- thumbnail atlas (one size for every zoom level) ----
  const [tileSize, setTileSize] = useState(0)

  const onLayoutChange = useCallback((layout: GridLayout) => {
    layoutRef.current = layout
    setTileSize(layout.tileSize)
  }, [])

  const atlasIds = useMemo(
    () =>
      layoutSections.flatMap(section => section.items.map(item => item.id)),
    [layoutSections]
  )

  const { data: atlasData } = useQuery<
    mediaAtlases,
    mediaAtlasesVariables
  >(MEDIA_ATLASES_QUERY, {
    variables: { ids: atlasIds, tileSize: ATLAS_TILE_SIZE },
    skip: atlasIds.length == 0 || tileSize == 0,
    fetchPolicy: 'no-cache',
  })

  const incomingAtlasMap = useMemo(() => buildAtlasMap(atlasData), [atlasData])

  // ---- atlas sheet loading (on demand) ----
  // Sheets are fetched only for tiles that are (or are about to become)
  // visible, and a tile moves to a newer sheet only once that sheet has
  // decoded, so the previous image stays on screen instead of flashing.
  const loadedAtlasUrlsRef = useRef<Set<string>>(new Set())
  const loadingAtlasUrlsRef = useRef<Set<string>>(new Set())
  const [atlasTick, setAtlasTick] = useState(0)
  const tickRafRef = useRef(0)

  const bumpAtlasTick = useCallback(() => {
    if (tickRafRef.current != 0) return
    tickRafRef.current = window.requestAnimationFrame(() => {
      tickRafRef.current = 0
      setAtlasTick(tick => tick + 1)
    })
  }, [])

  const preloadAtlasSheet = useCallback(
    (url: string) => {
      if (
        loadedAtlasUrlsRef.current.has(url) ||
        loadingAtlasUrlsRef.current.has(url)
      ) {
        return
      }
      loadingAtlasUrlsRef.current.add(url)
      const preload = new Image()
      const done = () => {
        loadingAtlasUrlsRef.current.delete(url)
        loadedAtlasUrlsRef.current.add(url)
        bumpAtlasTick()
      }
      preload.onload = done
      preload.onerror = done
      preload.src = url
    },
    [bumpAtlasTick]
  )

  const atlasMapRef = useRef<AtlasTileMap>(new Map())
  const atlasMap = useMemo(() => {
    const live = atlasMapRef.current
    for (const [mediaId, tile] of incomingAtlasMap) {
      const sheetReady =
        loadedAtlasUrlsRef.current.has(tile.url) || !live.has(mediaId)
      if (sheetReady) live.set(mediaId, tile)
    }
    if (atlasIds.length > 0) {
      const idSet = new Set(atlasIds)
      for (const mediaId of Array.from(live.keys())) {
        if (!idSet.has(mediaId)) live.delete(mediaId)
      }
    }
    return new Map(live)
    // atlasTick re-runs this once a preloaded sheet has decoded
  }, [incomingAtlasMap, atlasIds, atlasTick])

  const visibleRangeRef = useRef<[number, number]>([-1, -1])

  const onVisibleRange = useCallback(
    (first: number, last: number) => {
      visibleRangeRef.current = [first, last]
      if (first < 0) return
      for (let i = first; i <= last; i++) {
        const id = atlasIds[i]
        if (id == null) continue
        const tile = incomingAtlasMap.get(id) ?? atlasMapRef.current.get(id)
        if (tile != null) preloadAtlasSheet(tile.url)
      }
    },
    [atlasIds, incomingAtlasMap, preloadAtlasSheet]
  )

  /**
   * Predictively load the sheets for the photos a zoom to `targetColumns`
   * will reveal, so they are already cached and show up as soon as they
   * mount rather than popping in one by one.
   */
  const prefetchZoomLevel = useCallback(
    (targetColumns: number) => {
      const cols = clampColumns(targetColumns)
      const levelGap = isDenseLevel(cols) ? 0 : GRID_GAP
      const width = wrapperRef.current?.clientWidth || window.innerWidth
      const tile = tileSizeForColumns(width, cols, levelGap)
      const rowPitch = tile + levelGap
      const rows = Math.ceil((window.innerHeight || 800) / rowPitch) + 2

      const [first, last] = visibleRangeRef.current
      const anchor = first < 0 ? 0 : Math.floor((first + last) / 2)
      const start = Math.max(0, anchor - cols)
      const end = Math.min(atlasIds.length, anchor + rows * cols)

      for (let i = start; i < end; i++) {
        const id = atlasIds[i]
        if (id == null) continue
        const tileInfo = atlasMapRef.current.get(id) ?? incomingAtlasMap.get(id)
        if (tileInfo != null) preloadAtlasSheet(tileInfo.url)
      }
    },
    [atlasIds, incomingAtlasMap, preloadAtlasSheet]
  )
  const prefetchZoomLevelRef = useRef(prefetchZoomLevel)
  prefetchZoomLevelRef.current = prefetchZoomLevel

  // ---- zoom ----
  const [zoomAnchor, setZoomAnchor] = useState<ZoomAnchor | null>(null)

  const captureAnchor = useCallback((clientY: number): ZoomAnchor | null => {
    const layout = layoutRef.current
    if (layout == null || layout.itemCount == 0) return null
    return captureZoomAnchor(layout, window.scrollY + clientY, clientY)
  }, [])

  const applyZoom = useCallback(
    (targetColumns: number, clientY: number) => {
      const clamped = clampColumns(targetColumns)
      if (clamped === columnsRef.current) return

      // capture the current visual rects *before* the layout changes, so a
      // zoom step that interrupts an in-flight animation continues from
      // wherever the tiles are right now (no jump)
      const rects = new Map<string, TileVisual>()
      const scrollX = window.scrollX
      const scrollY = window.scrollY
      for (const [id, el] of tileRegistryRef.current) {
        const rect = el.getBoundingClientRect()
        rects.set(id, {
          x: rect.left + scrollX,
          y: rect.top + scrollY,
          w: rect.width,
        })
      }
      pendingRectsRef.current = rects

      const anchor = captureAnchor(clientY)
      if (anchor != null) setZoomAnchor(anchor)

      zoom.setColumns(clamped)
      prefetchZoomLevelRef.current(clamped)
      scheduleSettle()
    },
    [captureAnchor, zoom, scheduleSettle]
  )

  // stable ref so the once-registered gesture listeners always see the latest
  const applyZoomRef = useRef(applyZoom)
  applyZoomRef.current = applyZoom

  // ---- gesture state ----
  const pinchRef = useRef<{ startDist: number; startTile: number } | null>(
    null
  )
  const wheelAccRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const pinchEndAtRef = useRef(0)

  // ---- gestures (native listeners so preventDefault works) ----
  useEffect(() => {
    const elem = wrapperRef.current
    if (elem == null) return

    const touchDistance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      )

    const touchMidY = (touches: TouchList) => (touches[0].clientY + touches[1].clientY) / 2

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length != 2) return
      event.preventDefault()
      const layout = layoutRef.current
      pinchRef.current = {
        startDist: touchDistance(event.touches),
        startTile:
          layout?.tileSize ??
          tileSizeForColumns(
            elem.clientWidth,
            columnsRef.current,
            gapRef.current
          ),
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current
      if (pinch == null || event.touches.length < 2) return
      event.preventDefault()

      const dist = touchDistance(event.touches)
      if (dist <= 0 || pinch.startDist <= 0) return

      // fingers apart -> bigger tiles -> fewer columns
      const targetTile = pinch.startTile * (dist / pinch.startDist)
      const targetColumns = Math.round(
        (elem.clientWidth + gapRef.current) / (targetTile + gapRef.current)
      )
      applyZoomRef.current(targetColumns, touchMidY(event.touches))
    }

    const onTouchEnd = (event: TouchEvent) => {
      const wasPinch = pinchRef.current != null

      if (wasPinch && event.touches.length < 2) {
        pinchRef.current = null
        pinchEndAtRef.current = Date.now()
        lastTapRef.current = null // a pinch release must not count as a tap
        return
      }

      // double tap: toggle between the sparse and dense views
      if (
        !wasPinch &&
        event.changedTouches.length == 1 &&
        Date.now() - pinchEndAtRef.current > PINCH_TAP_SWALLOW_MS
      ) {
        const touch = event.changedTouches[0]
        const now = Date.now()
        const prev = lastTapRef.current

        if (
          prev != null &&
          now - prev.time < 320 &&
          Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) < 40
        ) {
          event.preventDefault()
          lastTapRef.current = null
          const current = columnsRef.current
          const target = current <= 5 ? 15 : 5
          if (target != current) applyZoomRef.current(target, touch.clientY)
        } else {
          lastTapRef.current = {
            time: now,
            x: touch.clientX,
            y: touch.clientY,
          }
        }
      }
    }

    // desktop / trackpad pinch (ctrl + wheel): one column per threshold
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()

      wheelAccRef.current += -event.deltaY
      const direction =
        wheelAccRef.current > WHEEL_LEVEL_THRESHOLD
          ? -1
          : wheelAccRef.current < -WHEEL_LEVEL_THRESHOLD
          ? 1
          : 0

      if (direction == 0) return
      wheelAccRef.current = 0

      applyZoomRef.current(columnsRef.current + direction, event.clientY)
    }

    // Safari fires proprietary gesture events for page pinch zoom
    const onGestureStart = (event: Event) => event.preventDefault()

    elem.addEventListener('touchstart', onTouchStart, { passive: false })
    elem.addEventListener('touchmove', onTouchMove, { passive: false })
    elem.addEventListener('touchend', onTouchEnd, { passive: false })
    elem.addEventListener('wheel', onWheel, { passive: false })
    elem.addEventListener('gesturestart', onGestureStart)
    elem.addEventListener('gesturechange', onGestureStart)

    return () => {
      elem.removeEventListener('touchstart', onTouchStart)
      elem.removeEventListener('touchmove', onTouchMove)
      elem.removeEventListener('touchend', onTouchEnd)
      elem.removeEventListener('wheel', onWheel)
      elem.removeEventListener('gesturestart', onGestureStart)
      elem.removeEventListener('gesturechange', onGestureStart)
    }
  }, [])

  // ---- floating date bar (dense levels) ----
  const [floatingDate, setFloatingDate] = useState<{
    title: string
    visible: boolean
  } | null>(null)

  const dateGroupsRef = useRef(dateGroups)
  dateGroupsRef.current = dateGroups

  useEffect(() => {
    if (!floatingDates) {
      setFloatingDate(null)
      return
    }

    let raf = 0
    let hideTimer: number | undefined

    const onScroll = () => {
      if (raf != 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        const layout = layoutRef.current
        if (layout == null || layout.itemCount == 0) return

        const index = indexAtY(layout, window.scrollY + 8)
        const group = groupForIndex(dateGroupsRef.current, index)
        const title: string | undefined = group?.title
        if (title != null) {
          setFloatingDate(prev =>
            prev && prev.title == title
              ? { ...prev, visible: true }
              : { title, visible: true }
          )
        }

        if (hideTimer != null) window.clearTimeout(hideTimer)
        hideTimer = window.setTimeout(() => {
          setFloatingDate(prev => (prev ? { ...prev, visible: false } : prev))
        }, FLOATING_DATE_HIDE_DELAY)
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf != 0) window.cancelAnimationFrame(raf)
      if (hideTimer != null) window.clearTimeout(hideTimer)
    }
  }, [floatingDates])

  const itemKey = useCallback((media: T) => media.id, [])

  const renderItem = useCallback(
    (media: T, absoluteIndex: number, tileSize: number) => (
      <PhotoTile
        media={media}
        tileSize={tileSize}
        fluidWidth={dense}
        atlas={atlasMap.get(media.id)}
        active={activeId != null && media.id == activeId}
        onClick={() => onItemActivate(media, absoluteIndex)}
        onFavorite={
          onItemFavorite ? () => onItemFavorite(media, absoluteIndex) : undefined
        }
      />
    ),
    [dense, atlasMap, activeId, onItemActivate, onItemFavorite]
  )

  return (
    <>
      <div ref={wrapperRef} style={{ touchAction: 'pan-y' }}>
        <VirtualGrid
          sections={layoutSections}
          columns={columns}
          gap={gap}
          renderHeaders={renderHeaders}
          overscanRows={3}
          itemKey={itemKey}
          renderItem={renderItem}
          renderSectionTitle={renderSectionTitle}
          onLayoutChange={onLayoutChange}
          onVisibleRange={onVisibleRange}
          zoomAnchor={zoomAnchor}
          tiles={tileRegistryRef}
          pendingRects={pendingRectsRef}
        />
      </div>

      {floatingDates && floatingDate != null && (
        <div
          aria-hidden={!floatingDate.visible}
          className={`fixed left-1/2 -translate-x-1/2 z-20 pointer-events-none rounded-full px-3.5 py-1 text-xs font-medium text-white bg-gray-900/75 dark:bg-black/75 backdrop-blur shadow-lg transition-opacity duration-300 ${
            floatingDate.visible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)' }}
        >
          {floatingDate.title}
        </div>
      )}
    </>
  )
}

export default PhotoGrid
