import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@apollo/client'
import VirtualGrid, { type VirtualGridHandle } from './VirtualGrid'
import MorphLayer, {
  type MorphCapture,
  type MorphHandle,
} from './MorphLayer'
import PhotoTile from './PhotoTile'
import {
  GRID_GAP,
  GridLayout,
  GridSectionData,
  flattenSections,
  groupForIndex,
  indexAtY,
  isDenseLevel,
  tileSizeForColumns,
} from './gridLayout'
import { COLUMN_LEVELS, useZoomLevels } from './useZoomLevels'
import { prefersReducedMotion } from './gridTransform'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import {
  AtlasTileMap,
  MEDIA_ATLASES_QUERY,
  buildAtlasMap,
  mediaAtlases,
  mediaAtlasesVariables,
} from './atlas'

/** accumulated wheel delta that advances one zoom level */
const WHEEL_LEVEL_THRESHOLD = 60
/** how long the floating date bar stays visible after scrolling stops */
const FLOATING_DATE_HIDE_DELAY = 1000
/** taps within this window after a pinch are swallowed */
const PINCH_TAP_SWALLOW_MS = 350
/** how long the morph takes to settle to an endpoint on release */
const MORPH_SETTLE_MS = 260
/** single atlas sheet size for every zoom level (no source change on zoom) */
const ATLAS_TILE_SIZE = 256

/** In-flight zoom morph between two precomputed layouts. */
type MorphState = {
  fromLevel: number
  toLevel: number
  fromRects: Map<string, MorphCapture>
  fromHeight: number
  anchorId: string | null
  anchorScreenY: number
  containerDocTop: number
  scrollY: number
  progress: number
}

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
   * Controlled zoom level (index into COLUMN_LEVELS). The timeline passes
   * its own state so the date grouping granularity can follow the zoom.
   */
  zoomLevel?: number
  onZoomLevelChange?: (level: number) => void
}

/**
 * The photo grid: virtualized, zoomable, mobile friendly.
 *
 * Zoom interaction
 * ----------------
 * A pinch morphs continuously between two precomputed layouts (the current
 * level and the level the gesture heads towards). As soon as the gesture
 * starts, the union of both layouts is rendered: the photos that were off
 * screen at the current level are already parked just outside the viewport in
 * the target layout and slide in, while every photo interpolates from its
 * current position/size to its target one. Nothing is remounted or re-fetched
 * - the containers just move and the images inside stay (a single atlas size
 * is used at every level). On release the morph settles to the nearest level.
 *
 * Double tap toggles between two levels and ctrl + wheel steps one level;
 * both run the same morph.
 *
 * Date display
 * ------------
 *  - sparse levels render sticky section header bars
 *  - dense levels render no headers; a floating date pill appears while
 *    scrolling and fades out after 1s of inactivity
 */
const PhotoGrid = <T extends MediaGalleryFields>({
  sections: sectionsProp,
  items,
  renderSectionTitle,
  onItemActivate,
  onItemFavorite,
  activeId,
  zoomLevel: controlledLevel,
  onZoomLevelChange,
}: PhotoGridProps<T>) => {
  const internalZoom = useZoomLevels()

  // in controlled mode the parent owns the level (e.g. the timeline,
  // whose date grouping granularity follows the zoom level)
  const zoom = useMemo(() => {
    if (controlledLevel == null) return internalZoom
    return {
      level: controlledLevel,
      setLevel: (level: number) =>
        onZoomLevelChange != null
          ? onZoomLevelChange(level)
          : internalZoom.setLevel(level),
    }
  }, [controlledLevel, onZoomLevelChange, internalZoom])

  const sections = useMemo<GridSectionData<T>[]>(() => {
    if (sectionsProp != null) return sectionsProp
    if (items != null) return [{ key: '__all__', items }]
    return []
  }, [sectionsProp, items])

  const columns = COLUMN_LEVELS[zoom.level]
  const hasTitles = sections.some(s => s.title != null)
  const dense = isDenseLevel(columns)
  const renderHeaders = hasTitles && !dense
  const floatingDates = hasTitles && dense

  // dense levels render the whole list as one seamless block: all sections
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
  const levelRef = useRef(zoom.level)
  levelRef.current = zoom.level

  // ---- thumbnail atlas (one size for every zoom level) ----
  // A single 256px atlas is used at every level. Because the image source no
  // longer depends on the zoom level, zooming never swaps or re-fetches a
  // sheet - only the container changes, which keeps the morph free of flicker.
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

  const prefetchZoomLevel = useCallback(
    (targetLevel: number) => {
      const level = Math.max(0, Math.min(COLUMN_LEVELS.length - 1, targetLevel))
      const cols = COLUMN_LEVELS[level]
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

  // ---- morph state ----
  const flatItems = useMemo(() => flattenSections(sections).items, [sections])
  const itemKey = useCallback((media: T) => media.id, [])
  const allIds = useMemo(() => flatItems.map(itemKey), [flatItems, itemKey])
  const allIdsRef = useRef(allIds)
  allIdsRef.current = allIds

  const gridHandleRef = useRef<VirtualGridHandle | null>(null)
  const morphHandleRef = useRef<MorphHandle | null>(null)
  const morphStateRef = useRef<MorphState | null>(null)
  const settleRafRef = useRef(0)
  const pendingScrollRef = useRef<number | null>(null)
  const [morph, setMorph] = useState<MorphState | null>(null)

  // apply the post-commit scroll once the new level's layout is on screen
  // (before that the document height is still the old one and would clamp it)
  React.useLayoutEffect(() => {
    if (pendingScrollRef.current != null) {
      window.scrollTo(0, pendingScrollRef.current)
      pendingScrollRef.current = null
    }
  }, [zoom.level])

  const commitMorph = useCallback(
    (state: MorphState, target: number) => {
      const offsetY = morphHandleRef.current?.getOffsetY() ?? 0
      // fold the anchor offset into the scroll so the normal grid lines up
      const newScroll = state.scrollY - offsetY
      pendingScrollRef.current = newScroll
      morphStateRef.current = null
      setMorph(null)
      zoom.setLevel(target >= 0.5 ? state.toLevel : state.fromLevel)
    },
    [zoom]
  )

  const finishMorph = useCallback(
    (target: number) => {
      const state = morphStateRef.current
      if (state == null) return
      if (settleRafRef.current != 0) {
        window.cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = 0
      }
      if (prefersReducedMotion()) {
        morphHandleRef.current?.setProgress(target)
        commitMorph(state, target)
        return
      }

      const from = state.progress
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / MORPH_SETTLE_MS)
        const eased = 1 - Math.pow(1 - k, 3)
        const p = from + (target - from) * eased
        state.progress = p
        morphHandleRef.current?.setProgress(p)
        if (k < 1) {
          settleRafRef.current = window.requestAnimationFrame(step)
        } else {
          settleRafRef.current = 0
          commitMorph(state, target)
        }
      }
      settleRafRef.current = window.requestAnimationFrame(step)
    },
    [commitMorph]
  )

  const beginMorph = useCallback(
    (toLevel: number, anchorScreenY: number) => {
      if (morphStateRef.current != null) return
      const captured = gridHandleRef.current?.capture()
      if (captured == null || captured.size == 0) return
      const layout = layoutRef.current
      const wrapper = wrapperRef.current
      const containerDocTop =
        (wrapper?.getBoundingClientRect().top ?? 0) + window.scrollY
      const index =
        layout != null ? indexAtY(layout, window.scrollY + anchorScreenY) : 0
      const state: MorphState = {
        fromLevel: levelRef.current,
        toLevel,
        fromRects: captured,
        fromHeight: layout?.totalHeight ?? 0,
        anchorId: allIdsRef.current[index] ?? null,
        anchorScreenY,
        containerDocTop,
        scrollY: window.scrollY,
        progress: 0,
      }
      morphStateRef.current = state
      setMorph(state)
      prefetchZoomLevelRef.current(toLevel)

      // MorphLayer mounts on the next commit; as soon as it has a handle,
      // push the progress we already have so the very first frame is right
      // (otherwise a quick gesture could finish before anything moved).
      window.requestAnimationFrame(() => {
        const current = morphStateRef.current
        if (current != null) morphHandleRef.current?.setProgress(current.progress)
      })
    },
    []
  )

  const beginMorphRef = useRef(beginMorph)
  beginMorphRef.current = beginMorph
  const finishMorphRef = useRef(finishMorph)
  finishMorphRef.current = finishMorph

  // ---- gesture state ----
  const pinchRef = useRef<{
    startDist: number
    startLevel: number
  } | null>(null)
  const wheelAccRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const alternateLevelRef = useRef<number | null>(null)
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
    const touchMidY = (touches: TouchList) =>
      (touches[0].clientY + touches[1].clientY) / 2

    const levelTile = (level: number) => {
      const cols = COLUMN_LEVELS[level]
      return tileSizeForColumns(
        elem.clientWidth,
        cols,
        isDenseLevel(cols) ? 0 : GRID_GAP
      )
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length != 2) return
      event.preventDefault()
      pinchRef.current = {
        startDist: touchDistance(event.touches),
        startLevel: levelRef.current,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current
      if (pinch == null || event.touches.length < 2) return
      event.preventDefault()

      const dist = touchDistance(event.touches)
      if (dist <= 0 || pinch.startDist <= 0) return
      const scale = dist / pinch.startDist

      if (morphStateRef.current == null) {
        // wait until the gesture clearly indicates a direction
        if (Math.abs(scale - 1) < 0.03) return
        const direction = scale < 1 ? 1 : -1
        const toLevel = Math.max(
          0,
          Math.min(COLUMN_LEVELS.length - 1, pinch.startLevel + direction)
        )
        if (toLevel == pinch.startLevel) return
        beginMorphRef.current(toLevel, touchMidY(event.touches))
      }

      const state = morphStateRef.current
      if (state == null) return

      // Map the finger scale onto the morph progress [0, 1]. The morph is
      // complete at the geometric midpoint between the two tile sizes (the
      // point the old level switch used), so one gesture crosses a level
      // without having to pinch all the way down to the target tile size.
      const fromTile = levelTile(state.fromLevel)
      const toTile = levelTile(state.toLevel)
      const visualTile = fromTile * scale
      const midTile = Math.sqrt(fromTile * toTile)
      const p =
        toTile < fromTile
          ? (fromTile - visualTile) / (fromTile - midTile)
          : (visualTile - fromTile) / (midTile - fromTile)
      const clamped = Math.max(0, Math.min(1, p))
      state.progress = clamped
      morphHandleRef.current?.setProgress(clamped)
    }

    const onTouchEnd = (event: TouchEvent) => {
      const wasPinch = pinchRef.current != null

      if (wasPinch && event.touches.length < 2) {
        pinchRef.current = null
        pinchEndAtRef.current = Date.now()
        lastTapRef.current = null // a pinch release must not count as a tap
        if (morphStateRef.current != null) {
          // a deliberate pinch in one direction should cross the level, so the
          // commit threshold is forgiving
          finishMorphRef.current(
            morphStateRef.current.progress >= 0.4 ? 1 : 0
          )
        }
        return
      }

      // double tap: morph between the current level and the previous one
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

          const current = levelRef.current
          const alternate =
            alternateLevelRef.current ?? (current === 0 ? 2 : 0)
          alternateLevelRef.current = current

          if (alternate != current && morphStateRef.current == null) {
            beginMorphRef.current(alternate, touch.clientY)
            window.requestAnimationFrame(() => finishMorphRef.current(1))
          }
        } else {
          lastTapRef.current = {
            time: now,
            x: touch.clientX,
            y: touch.clientY,
          }
        }
      }
    }

    // desktop / trackpad pinch (ctrl + wheel): one level per threshold
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (morphStateRef.current != null) return

      wheelAccRef.current += -event.deltaY
      const direction =
        wheelAccRef.current > WHEEL_LEVEL_THRESHOLD
          ? -1
          : wheelAccRef.current < -WHEEL_LEVEL_THRESHOLD
          ? 1
          : 0

      if (direction == 0) return
      wheelAccRef.current = 0

      const current = levelRef.current
      const newLevel = Math.max(
        0,
        Math.min(COLUMN_LEVELS.length - 1, current + direction)
      )
      if (newLevel == current) return

      beginMorphRef.current(newLevel, event.clientY)
      window.requestAnimationFrame(() => finishMorphRef.current(1))
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
      if (settleRafRef.current != 0) {
        window.cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = 0
      }
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
        {morph != null ? (
          <MorphLayer
            sections={sections}
            flatItems={flatItems}
            width={wrapperRef.current?.clientWidth || window.innerWidth}
            fromColumns={COLUMN_LEVELS[morph.fromLevel]}
            fromDense={isDenseLevel(COLUMN_LEVELS[morph.fromLevel])}
            toColumns={COLUMN_LEVELS[morph.toLevel]}
            toDense={isDenseLevel(COLUMN_LEVELS[morph.toLevel])}
            fromRects={morph.fromRects}
            fromHeight={morph.fromHeight}
            anchorId={morph.anchorId}
            anchorScreenY={morph.anchorScreenY}
            containerDocTop={morph.containerDocTop}
            scrollY={morph.scrollY}
            viewportHeight={window.innerHeight || 800}
            itemKey={itemKey}
            renderItem={renderItem}
            handleRef={morphHandleRef}
          />
        ) : (
          <VirtualGrid
            sections={layoutSections}
            columns={columns}
            gap={dense ? 0 : undefined}
            renderHeaders={renderHeaders}
            overscanRows={3}
            itemKey={itemKey}
            renderItem={renderItem}
            renderSectionTitle={renderSectionTitle}
            onLayoutChange={onLayoutChange}
            onVisibleRange={onVisibleRange}
            handleRef={gridHandleRef}
          />
        )}
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
