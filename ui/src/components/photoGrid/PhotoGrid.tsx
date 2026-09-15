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
  GAP_RATIO,
  columnsForTile,
  tileForColumns,
} from './ContinuousGrid'
import PhotoTile from './PhotoTile'
import { GridSectionData, flattenSections, groupForIndex } from './gridLayout'
import { COLUMN_STOPS, clampColumns, useGridZoom } from './gridZoom'
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
  /** reports the settled column count so the parent can re-group dates */
  onColumnsChange?(columns: number): void
}

/**
 * The photo grid: one continuous, virtualized grid.
 *
 * Zooming is a single geometric operation: the visual tile size is driven 1:1
 * by the gesture, and the layout is interpolated between the two adjacent
 * integer column counts that bracket it. Every photo therefore only moves up
 * to one cell, continuously - there is no second "page" and no crossfade, and
 * the extra column grows out of the right edge as you zoom out.
 *
 * Positions are written imperatively (transform + CSS scale) while a gesture
 * is in flight, so React never re-renders during the zoom itself.
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
  const columns = zoom.columns
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

  // measure the host width
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

  const effWidth = width || (typeof window !== 'undefined' ? window.innerWidth : 0)

  // ---- atlas (single 256px size for every zoom) ----
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

  const onVisibleRange = useCallback((first: number, last: number) => {
    const prev = lastRangeRef.current
    if (prev[0] === first && prev[1] === last) return
    lastRangeRef.current = [first, last]
    if (first < 0) return
    // date pill
    const group = groupForIndex(dateGroupsRef.current, first)
    setFloatingDate(group?.title ?? null)
    // warm the atlas sheets for the newly visible range
    for (let i = first; i < Math.min(last, first + 400); i++) {
      const id = atlasIds[i]
      if (id == null) continue
      const tile = incomingAtlasMap.get(id) ?? atlasMapRef.current.get(id)
      if (tile != null) preloadAtlasSheet(tile.url)
    }
  }, [atlasIds, incomingAtlasMap, preloadAtlasSheet])

  // ---- continuous zoom engine ----
  const visualTileRef = useRef(0)
  const settleRafRef = useRef(0)
  const [viewVersion, setViewVersion] = useState(0)

  // keep the visual tile in sync with the committed columns
  useLayoutEffect(() => {
    if (effWidth <= 0) return
    const tile = tileForColumns(effWidth, columns)
    visualTileRef.current = tile
    gridHandleRef.current?.setView(tile, -1, 0, window.scrollY)
    setViewVersion(v => v + 1)
  }, [columns, effWidth])

  const anchorFor = useCallback(
    (clientY: number): { anchorIndex: number } => {
      const pitch = tileForColumns(effWidth, columnsRef.current) * (1 + GAP_RATIO)
      const row = Math.floor((window.scrollY + clientY) / pitch)
      const index = Math.max(
        0,
        Math.min(flatItems.length - 1, row * columnsRef.current)
      )
      return { anchorIndex: index }
    },
    [effWidth, flatItems.length]
  )

  const animateTo = useCallback(
    (targetColumns: number, anchorIndex: number, anchorScreenY: number) => {
      if (settleRafRef.current != 0) {
        window.cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = 0
      }
      const width = effWidth
      const from = visualTileRef.current
      const to = tileForColumns(width, targetColumns)
      const scrollY = window.scrollY
      const t0 = performance.now()
      let lastOffset = 0
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / SETTLE_MS)
        const eased = 1 - Math.pow(1 - k, 3)
        const tile = from + (to - from) * eased
        visualTileRef.current = tile
        lastOffset =
          gridHandleRef.current?.setView(tile, anchorIndex, anchorScreenY, scrollY) ??
          0
        if (k < 1) {
          settleRafRef.current = window.requestAnimationFrame(step)
        } else {
          settleRafRef.current = 0
          // fold the anchor offset into the scroll, then re-base
          window.scrollTo(0, scrollY - lastOffset)
          zoom.setColumns(targetColumns)
          onColumnsChangeRef.current?.(targetColumns)
          visualTileRef.current = to
          gridHandleRef.current?.setView(to, anchorIndex, anchorScreenY, window.scrollY)
        }
      }
      settleRafRef.current = window.requestAnimationFrame(step)
    },
    [effWidth, zoom]
  )

  const startPinchRef = useRef({
    active: false,
    startDist: 0,
    startTile: 0,
    lastDist: 0,
    midY: 0,
    anchorIndex: 0,
    scrollY: 0,
  })
  const pinchActiveRef = useRef(false)
  const wheelAccRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const alternateRef = useRef<number | null>(null)
  const pinchEndAtRef = useRef(0)

  useEffect(() => {
    const elem = hostRef.current
    if (elem == null) return

    const dist = (t: TouchList) =>
      Math.hypot(
        t[0].clientX - t[1].clientX,
        t[0].clientY - t[1].clientY
      )
    const midY = (t: TouchList) => (t[0].clientY + t[1].clientY) / 2

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length != 2) return
      event.preventDefault()
      if (settleRafRef.current != 0) {
        window.cancelAnimationFrame(settleRafRef.current)
        settleRafRef.current = 0
      }
      const g = startPinchRef.current
      g.active = true
      g.startDist = dist(event.touches)
      g.lastDist = g.startDist
      g.startTile = visualTileRef.current || tileForColumns(effWidth, columnsRef.current)
      g.midY = midY(event.touches)
      g.scrollY = window.scrollY
      g.anchorIndex = anchorFor(g.midY).anchorIndex
      pinchActiveRef.current = true
    }

    const onTouchMove = (event: TouchEvent) => {
      const g = startPinchRef.current
      if (!g.active || event.touches.length < 2) return
      event.preventDefault()
      g.lastDist = dist(event.touches)
      g.midY = midY(event.touches)
      if (g.startDist <= 0) return
      let tile = g.startTile * (g.lastDist / g.startDist)
      const minTile = tileForColumns(effWidth, 30)
      const maxTile = tileForColumns(effWidth, 3)
      tile = Math.max(minTile * 0.85, Math.min(maxTile * 1.15, tile))
      visualTileRef.current = tile
      gridHandleRef.current?.setView(tile, g.anchorIndex, g.midY, g.scrollY)
    }

    const onTouchEnd = (event: TouchEvent) => {
      const wasPinch = pinchActiveRef.current
      if (wasPinch && event.touches.length < 2) {
        pinchActiveRef.current = false
        const g = startPinchRef.current
        g.active = false
        pinchEndAtRef.current = Date.now()
        lastTapRef.current = null
        const target = clampColumns(
          Math.round(columnsForTile(effWidth, visualTileRef.current))
        )
        animateTo(target, g.anchorIndex, g.midY)
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
          const current = columnsRef.current
          const alternate = alternateRef.current ?? (current <= 5 ? 15 : 5)
          alternateRef.current = current
          if (alternate != current) {
            const { anchorIndex } = anchorFor(touch.clientY)
            animateTo(alternate, anchorIndex, touch.clientY)
          }
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
        }
      }
    }

    const onTouchCancel = () => {
      if (!pinchActiveRef.current) return
      pinchActiveRef.current = false
      const g = startPinchRef.current
      g.active = false
      const target = clampColumns(
        Math.round(columnsForTile(effWidth, visualTileRef.current))
      )
      animateTo(target, g.anchorIndex, g.midY)
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
      const current = columnsRef.current
      const { anchorIndex } = anchorFor(event.clientY)
      let target: number
      if (dir > 0) {
        target = COLUMN_STOPS.find(s => s > current) ?? 30
      } else {
        target =
          [...COLUMN_STOPS].reverse().find(s => s < current) ?? 3
      }
      if (target == current) return
      animateTo(target, anchorIndex, event.clientY)
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
  }, [effWidth, animateTo, anchorFor])

  // bring the new committed layout's transforms in line after a base change
  useEffect(() => {
    if (effWidth <= 0) return
    gridHandleRef.current?.setView(
      visualTileRef.current,
      -1,
      0,
      window.scrollY
    )
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
          itemKey={itemKey}
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
