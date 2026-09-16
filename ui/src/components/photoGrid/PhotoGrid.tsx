import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@apollo/client'
import ContinuousGrid, {
  type ContinuousGridHandle,
  type ContinuousView,
  GAP_RATIO,
  tileForColumns,
} from './ContinuousGrid'
import PhotoTile from './PhotoTile'
import { GridSectionData, flattenSections, groupForIndex } from './gridLayout'
import { COLUMN_STOPS, nearestStop, useGridZoom } from './gridZoom'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import {
  AtlasTileMap,
  MEDIA_ATLASES_QUERY,
  buildAtlasMap,
  mediaAtlases,
  mediaAtlasesVariables,
} from './atlas'

const WHEEL_LEVEL_THRESHOLD = 60
const PINCH_TAP_SWALLOW_MS = 350
const SETTLE_MS = 220
const ATLAS_TILE_SIZE = 256

type PhotoGridProps<T extends MediaGalleryFields> = {
  sections?: GridSectionData<T>[]
  items?: T[]
  onItemActivate(item: T, index: number): void
  onItemFavorite?(item: T, index: number): void
  activeId?: string
  onColumnsChange?(columns: number): void
}

/**
 * The photo grid. Levels are the discrete column counts 3 / 5 / 15 / 30.
 *
 * A pinch scales the grid about the gesture point (both axes) and, on
 * crossing to the adjacent level, plays a single crossfade: each slot swaps
 * from the committed layout's photo to the target layout's photo. Columns and
 * rows that only exist in the target are rendered straight at their
 * precomputed slot and slide in from the edge - they never fade.
 */
const PhotoGrid = <T extends MediaGalleryFields>({
  sections: sectionsProp,
  items: itemsProp,
  onItemActivate,
  onItemFavorite,
  activeId,
  onColumnsChange,
}: PhotoGridProps<T>) => {
  const zoom = useGridZoom()
  const columns = nearestStop(zoom.columns)
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const onColumnsChangeRef = useRef(onColumnsChange)
  onColumnsChangeRef.current = onColumnsChange

  const sections = useMemo<GridSectionData<T>[]>(() => {
    if (sectionsProp != null) return sectionsProp
    if (itemsProp != null) return [{ key: '__all__', items: itemsProp }]
    return []
  }, [sectionsProp, itemsProp])

  const { flatItems, dateGroups } = useMemo(() => {
    const { items: flat, groups } = flattenSections(sections)
    return { flatItems: flat, dateGroups: groups }
  }, [sections])

  const itemKey = useCallback((media: T) => media.id, [])

  const hostRef = useRef<HTMLDivElement | null>(null)
  const gridHandleRef = useRef<ContinuousGridHandle | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const elem = hostRef.current
    if (elem == null) return
    const update = () => setWidth(elem.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(elem)
    return () => observer.disconnect()
  }, [])

  const effWidth =
    width || (typeof window !== 'undefined' ? window.innerWidth : 0)

  // ---- atlas ----
  const [atlasTick, setAtlasTick] = useState(0)
  const tileRafRef = useRef(0)
  const loadedAtlasUrlsRef = useRef<Set<string>>(new Set())
  const loadingAtlasUrlsRef = useRef<Set<string>>(new Set())
  const atlasMapRef = useRef<AtlasTileMap>(new Map())

  const atlasIds = useMemo(() => flatItems.map(itemKey), [flatItems, itemKey])

  const { data: atlasData } = useQuery<mediaAtlases, mediaAtlasesVariables>(
    MEDIA_ATLASES_QUERY,
    {
      variables: { ids: atlasIds, tileSize: ATLAS_TILE_SIZE },
      skip: atlasIds.length == 0,
      fetchPolicy: 'no-cache',
    }
  )
  const incomingAtlasMap = useMemo(() => buildAtlasMap(atlasData), [atlasData])

  const bumpAtlasTick = useCallback(() => {
    if (tileRafRef.current != 0) return
    tileRafRef.current = window.requestAnimationFrame(() => {
      tileRafRef.current = 0
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

  const atlasMap = useMemo(() => {
    const live = atlasMapRef.current
    for (const [mediaId, tile] of incomingAtlasMap) {
      const ready =
        loadedAtlasUrlsRef.current.has(tile.url) || !live.has(mediaId)
      if (ready) live.set(mediaId, tile)
    }
    if (atlasIds.length > 0) {
      const idSet = new Set(atlasIds)
      for (const mediaId of Array.from(live.keys())) {
        if (!idSet.has(mediaId)) live.delete(mediaId)
      }
    }
    return new Map(live)
  }, [incomingAtlasMap, atlasIds, atlasTick])

  // ---- floating date pill ----
  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const dateGroupsRef = useRef(dateGroups)
  dateGroupsRef.current = dateGroups
  const lastRangeRef = useRef<[number, number]>([-1, -1])

  const onVisibleRange = useCallback(
    (first: number, last: number) => {
      if (first < 0) return
      const group = groupForIndex(dateGroupsRef.current, first)
      setFloatingDate(group?.title ?? null)
      const prev = lastRangeRef.current
      if (prev[0] === first && prev[1] === last) return
      lastRangeRef.current = [first, last]
      for (let i = first; i < Math.min(last, first + 400); i++) {
        const id = atlasIds[i]
        if (id == null) continue
        const tile = incomingAtlasMap.get(id) ?? atlasMapRef.current.get(id)
        if (tile != null) preloadAtlasSheet(tile.url)
      }
    },
    [atlasIds, incomingAtlasMap, preloadAtlasSheet]
  )

  // ---- continuous zoom engine ----
  const visualTileRef = useRef(0)
  const settleRafRef = useRef(0)
  const [viewVersion, setViewVersion] = useState(0)

  const stopIndex = useCallback((cols: number): number => {
    let best = 0
    let bestDist = Infinity
    COLUMN_STOPS.forEach((s, i) => {
      const d = Math.abs(s - cols)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    return best
  }, [])

  const viewFor = useCallback(
    (view: ContinuousView) => gridHandleRef.current?.setView(view),
    []
  )

  const initialView = useCallback(
    (tile: number): ContinuousView => ({
      tile,
      fromColumns: columnsRef.current,
      toColumns: null,
      anchorCX: 0,
      anchorCY: 0,
      screenX: 0,
      screenY: -1, // sentinel: no anchor
      scrollY: window.scrollY,
    }),
    []
  )

  useLayoutEffect(() => {
    if (effWidth <= 0) return
    const tile = tileForColumns(effWidth, columns)
    visualTileRef.current = tile
    viewFor(initialView(tile))
    setViewVersion(v => v + 1)
  }, [columns, effWidth, viewFor, initialView])

  const startPinchRef = useRef({
    active: false,
    startDist: 0,
    startTile: 0,
    lastDist: 0,
    fromColumns: 0,
    toColumns: null as number | null,
    anchorCX: 0,
    anchorCY: 0,
    screenX: 0,
    screenY: 0,
    scrollY: 0,
  })
  const pinchActiveRef = useRef(false)
  const wheelAccRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const alternateRef = useRef<number | null>(null)
  const pinchEndAtRef = useRef(0)

  const settleAnim = useCallback(
    (
      fromColumns: number,
      toColumns: number,
      targetIsTo: boolean,
      anchorCX: number,
      anchorCY: number,
      screenY: number,
      scrollY: number
    ) => {
      if (settleRafRef.current != 0) {
        window.cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = 0
      }
      const width = effWidth
      const rect = hostRef.current?.getBoundingClientRect()
      const hostLeft = rect?.left ?? 0
      const hostTop = rect?.top ?? 0
      const from = visualTileRef.current
      const to = tileForColumns(width, targetIsTo ? toColumns : fromColumns)
      const pitchTarget = to * (1 + GAP_RATIO)
      // animate the horizontal anchor offset to zero so the settled grid
      // fills the width again
      const screenX0 = startPinchRef.current.screenX
      const screenX1 = hostLeft + anchorCX * pitchTarget
      const t0 = performance.now()
      let lastY = 0
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / SETTLE_MS)
        const eased = 1 - Math.pow(1 - k, 3)
        const tile = from + (to - from) * eased
        const screenX = screenX0 + (screenX1 - screenX0) * eased
        visualTileRef.current = tile
        lastY =
          viewFor({
            tile,
            fromColumns,
            toColumns,
            anchorCX,
            anchorCY,
            screenX,
            screenY,
            scrollY,
          }) ?? 0
        if (k < 1) {
          settleRafRef.current = window.requestAnimationFrame(step)
        } else {
          settleRafRef.current = 0
          const newScroll = scrollY - lastY
          window.scrollTo(0, newScroll)
          if (targetIsTo) {
            zoom.setColumns(toColumns)
            onColumnsChangeRef.current?.(toColumns)
          }
          visualTileRef.current = to
          viewFor({
            tile: to,
            fromColumns: targetIsTo ? toColumns : fromColumns,
            toColumns: null,
            anchorCX: (screenX1 - hostLeft) / pitchTarget,
            anchorCY: (newScroll + screenY - hostTop) / pitchTarget,
            screenX: screenX1,
            screenY,
            scrollY: newScroll,
          })
        }
      }
      settleRafRef.current = window.requestAnimationFrame(step)
    },
    [effWidth, viewFor, zoom]
  )

  useEffect(() => {
    const elem = hostRef.current
    if (elem == null) return

    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    })

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length != 2) return
      event.preventDefault()
      if (settleRafRef.current != 0) {
        window.cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = 0
      }
      const rect = elem.getBoundingClientRect()
      const m = mid(event.touches)
      const g = startPinchRef.current
      const fromColumns = nearestStop(columnsRef.current)
      const pitch0 = tileForColumns(effWidth, fromColumns) * (1 + GAP_RATIO)
      g.active = true
      g.startDist = dist(event.touches)
      g.lastDist = g.startDist
      g.startTile = visualTileRef.current || tileForColumns(effWidth, fromColumns)
      g.fromColumns = fromColumns
      g.toColumns = null
      g.anchorCX = (m.x - rect.left) / pitch0
      g.anchorCY = (window.scrollY + m.y - rect.top) / pitch0
      g.screenX = m.x
      g.screenY = m.y
      g.scrollY = window.scrollY
      pinchActiveRef.current = true
    }

    const onTouchMove = (event: TouchEvent) => {
      const g = startPinchRef.current
      if (!g.active || event.touches.length < 2) return
      event.preventDefault()
      const m = mid(event.touches)
      g.lastDist = dist(event.touches)
      g.screenX = m.x
      g.screenY = m.y
      if (g.startDist <= 0) return

      const scale = g.lastDist / g.startDist
      // pick the adjacent stop once the direction is clear
      if (g.toColumns == null && Math.abs(scale - 1) > 0.03) {
        const i = stopIndex(g.fromColumns)
        const dir = scale < 1 ? 1 : -1
        const ni = Math.max(0, Math.min(COLUMN_STOPS.length - 1, i + dir))
        g.toColumns = COLUMN_STOPS[ni]
        if (g.toColumns === g.fromColumns) g.toColumns = null
      }

      let tile = g.startTile * scale
      if (g.toColumns != null) {
        const tFrom = tileForColumns(effWidth, g.fromColumns)
        const tTo = tileForColumns(effWidth, g.toColumns)
        const lo = Math.min(tFrom, tTo) * 0.9
        const hi = Math.max(tFrom, tTo) * 1.1
        tile = Math.max(lo, Math.min(hi, tile))
      }
      visualTileRef.current = tile
      viewFor({
        tile,
        fromColumns: g.fromColumns,
        toColumns: g.toColumns,
        anchorCX: g.anchorCX,
        anchorCY: g.anchorCY,
        screenX: g.screenX,
        screenY: g.screenY,
        scrollY: g.scrollY,
      })
    }

    const finishPinch = () => {
      pinchActiveRef.current = false
      const g = startPinchRef.current
      g.active = false
      if (g.toColumns == null) {
        // no crossing: just settle back to the committed level
        settleAnim(
          g.fromColumns,
          g.fromColumns,
          false,
          g.anchorCX,
          g.anchorCY,
          g.screenY,
          g.scrollY
        )
        return
      }
      const tFrom = tileForColumns(effWidth, g.fromColumns)
      const tTo = tileForColumns(effWidth, g.toColumns)
      const prog =
        tFrom === tTo
          ? 1
          : Math.max(
              0,
              Math.min(1, (tFrom - visualTileRef.current) / (tFrom - tTo))
            )
      const commitTo = prog >= 0.5
      settleAnim(
        g.fromColumns,
        g.toColumns,
        commitTo,
        g.anchorCX,
        g.anchorCY,
        g.screenY,
        g.scrollY
      )
    }

    const onTouchEnd = (event: TouchEvent) => {
      const wasPinch = pinchActiveRef.current
      if (wasPinch && event.touches.length < 2) {
        pinchEndAtRef.current = Date.now()
        lastTapRef.current = null
        finishPinch()
        return
      }

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
          const current = nearestStop(columnsRef.current)
          const alternate = nearestStop(alternateRef.current ?? (current <= 5 ? 15 : 5))
          alternateRef.current = current
          if (alternate !== current && settleRafRef.current == 0) {
            startFastCrossfade(alternate, touch.clientX, touch.clientY)
          }
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
        }
      }
    }

    const startFastCrossfade = (
      targetColumns: number,
      clientX: number,
      clientY: number
    ) => {
      const rect = elem.getBoundingClientRect()
      const fromColumns = nearestStop(columnsRef.current)
      const pitch0 = tileForColumns(effWidth, fromColumns) * (1 + GAP_RATIO)
      const anchorCX = (clientX - rect.left) / pitch0
      const anchorCY = (window.scrollY + clientY - rect.top) / pitch0
      const from = visualTileRef.current
      const to = tileForColumns(effWidth, targetColumns)
      const t0 = performance.now()
      startPinchRef.current.anchorCX = anchorCX
      startPinchRef.current.anchorCY = anchorCY
      startPinchRef.current.screenX = clientX
      startPinchRef.current.screenY = clientY
      const screenX1 = rect.left + anchorCX * to * (1 + GAP_RATIO)
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / SETTLE_MS)
        const eased = 1 - Math.pow(1 - k, 3)
        const tile = from + (to - from) * eased
        const screenX = clientX + (screenX1 - clientX) * eased
        visualTileRef.current = tile
        const offsetY =
          viewFor({
            tile,
            fromColumns,
            toColumns: targetColumns,
            anchorCX,
            anchorCY,
            screenX,
            screenY: clientY,
            scrollY: window.scrollY,
          }) ?? 0
        if (k < 1) {
          settleRafRef.current = window.requestAnimationFrame(step)
        } else {
          settleRafRef.current = 0
          const newScroll = window.scrollY - offsetY
          window.scrollTo(0, newScroll)
          zoom.setColumns(targetColumns)
          onColumnsChangeRef.current?.(targetColumns)
          visualTileRef.current = to
          viewFor({
            tile: to,
            fromColumns: targetColumns,
            toColumns: null,
            anchorCX: (screenX1 - rect.left) / (to * (1 + GAP_RATIO)),
            anchorCY: (newScroll + clientY - rect.top) / (to * (1 + GAP_RATIO)),
            screenX: screenX1,
            screenY: clientY,
            scrollY: newScroll,
          })
        }
      }
      settleRafRef.current = window.requestAnimationFrame(step)
    }

    const onTouchCancel = () => {
      if (!pinchActiveRef.current) return
      finishPinch()
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (settleRafRef.current != 0) return
      wheelAccRef.current += -event.deltaY
      const dir =
        wheelAccRef.current > WHEEL_LEVEL_THRESHOLD
          ? -1
          : wheelAccRef.current < -WHEEL_LEVEL_THRESHOLD
          ? 1
          : 0
      if (dir == 0) return
      wheelAccRef.current = 0
      const current = nearestStop(columnsRef.current)
      let target: number
      if (dir > 0) target = COLUMN_STOPS.find(s => s > current) ?? current
      else target = [...COLUMN_STOPS].reverse().find(s => s < current) ?? current
      if (target === current) return
      startFastCrossfade(target, event.clientX, event.clientY)
    }

    const onGestureStart = (e: Event) => e.preventDefault()

    elem.addEventListener('touchstart', onTouchStart, { passive: false })
    elem.addEventListener('touchmove', onTouchMove, { passive: false })
    elem.addEventListener('touchend', onTouchEnd, { passive: false })
    elem.addEventListener('touchcancel', onTouchCancel, { passive: false })
    elem.addEventListener('wheel', onWheel, { passive: false })
    elem.addEventListener('gesturestart', onGestureStart)
    elem.addEventListener('gesturechange', onGestureStart)
    return () => {
      elem.removeEventListener('touchstart', onTouchStart)
      elem.removeEventListener('touchmove', onTouchMove)
      elem.removeEventListener('touchend', onTouchEnd)
      elem.removeEventListener('touchcancel', onTouchCancel)
      elem.removeEventListener('wheel', onWheel)
      elem.removeEventListener('gesturestart', onGestureStart)
      elem.removeEventListener('gesturechange', onGestureStart)
      if (settleRafRef.current != 0) {
        window.cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = 0
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effWidth, viewFor, stopIndex, settleAnim])

  useEffect(() => {
    if (effWidth <= 0) return
    viewFor(initialView(visualTileRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewVersion, columns, effWidth])

  const renderItem = useCallback(
    (media: T, absoluteIndex: number, baseSize: number) => (
      <PhotoTile
        media={media}
        tileSize={baseSize}
        atlas={atlasMap.get(media.id)}
        active={activeId != null && media.id == activeId}
        onClick={() => onItemActivate(media, absoluteIndex)}
        onFavorite={
          onItemFavorite ? () => onItemFavorite(media, absoluteIndex) : undefined
        }
      />
    ),
    [atlasMap, activeId, onItemActivate, onItemFavorite]
  )

  return (
    <div ref={hostRef} style={{ touchAction: 'pan-y', position: 'relative' }}>
      {effWidth > 0 && (
        <ContinuousGrid
          items={flatItems}
          width={effWidth}
          initialColumns={columns}
          renderItem={renderItem}
          handleRef={gridHandleRef}
          onVisibleRange={onVisibleRange}
        />
      )}
      {floatingDate != null && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-20 pointer-events-none rounded-full px-3.5 py-1 text-xs font-medium text-white bg-gray-900/75 dark:bg-black/75 backdrop-blur shadow-lg"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)' }}
        >
          {floatingDate}
        </div>
      )}
    </div>
  )
}

export default PhotoGrid
