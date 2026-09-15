import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@apollo/client'
import VirtualGrid from './VirtualGrid'
import PhotoTile from './PhotoTile'
import {
  GRID_GAP,
  GridLayout,
  GridSectionData,
  computeLayout,
  flattenSections,
  groupForIndex,
  indexAtY,
  isDenseLevel,
  itemTop,
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
/** crossfade speed cap: at most full opacity in this many ms */
const FADE_MS = 500
/** how long an idle release settles visualTile to the level's tile size */
const SETTLE_MS = 320
/** a finger is considered idle after this long without a move */
const IDLE_MS = 110
/** how far past the midpoint a gesture must go to start a switch */
const START_MARGIN = 0.04
/** how far back past the start a switch must go to be cancelled */
const REVERT_MARGIN = 0.06
/** single atlas sheet size for every zoom level (no source change on zoom) */
const ATLAS_TILE_SIZE = 256

/** In-flight crossfade between the committed level and the next one. */
type Transition = {
  fromLevel: number
  toLevel: number
  fromTile: number
  toTile: number
  midTile: number
  baseAnchorTop: number
  topAnchorTop: number
  p: number
  desired: number
}

type ViewProps = {
  baseScale: number
  topScale: number
  originY: number
  topOffset: number
}

type PhotoGridProps<T extends MediaGalleryFields> = {
  /** Sectioned data (e.g. timeline grouped by day). Mutually exclusive with `items`. */
  sections?: GridSectionData<T>[]
  /** Flat data. Mutually exclusive with `items`. */
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
 * The zoom is a layered crossfade, never a per-tile displacement:
 *
 *  - the committed level is a single grid layer, scaled continuously by the
 *    gesture about the pinch midpoint. Its tiles just grow/shrink, so they
 *    read as "zooming one big image".
 *  - when the visual tile size passes the midpoint to the next level, a second
 *    layer (the target level) is mounted on top. Both layers are scaled so
 *    their tiles have the *same on-screen size*; the target layer is offset so
 *    the photo under the fingers coincides between layers.
 *  - the two layers crossfade, driven by the gesture (reversible). The fade
 *    cannot complete faster than FADE_MS, but continues on its own when the
 *    fingers stop, so it always finishes. When the target layer reaches its
 *    natural size it is committed and the old layer is unloaded.
 *
 * Tiles are keyed and stay mounted (only opacity/transform change), a single
 * atlas size is used at every level, and new photos load independently - so
 * zooming never refetches or remounts the grid.
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

  const hasTitles = sections.some(s => s.title != null)
  const columns = COLUMN_LEVELS[zoom.level]
  const dense = isDenseLevel(columns)
  const renderHeaders = hasTitles && !dense
  const floatingDates = hasTitles && dense

  const { layoutSections, dateGroups } = useMemo(() => {
    if (!dense || sections.length == 0) {
      return {
        layoutSections: sections,
        dateGroups: [] as { firstIndex: number; title?: string }[],
      }
    }
    const { items: flatItems, groups } = flattenSections(sections)
    return {
      layoutSections: [{ key: '__dense__', items: flatItems }],
      dateGroups: groups,
    }
  }, [sections, dense])

  const hostRef = useRef<HTMLDivElement | null>(null)
  const baseLayerRef = useRef<HTMLDivElement | null>(null)
  const topLayerRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef<GridLayout | null>(null)
  const levelRef = useRef(zoom.level)
  levelRef.current = zoom.level

  // the top layer's level while a transition is running (null = no top layer)
  const [topLevel, setTopLevel] = useState<number | null>(null)
  // scroll position to virtualize the base layer against during the commit
  // render, before the programmatic scroll has propagated back as state
  const [baseScrollOverride, setBaseScrollOverride] = useState<number | null>(
    null
  )
  const [viewProps, setViewProps] = useState<ViewProps>({
    baseScale: 1,
    topScale: 1,
    originY: 0,
    topOffset: 0,
  })
  const viewPropsRef = useRef(viewProps)

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
      const width = hostRef.current?.clientWidth || window.innerWidth
      const tile = tileSizeForColumns(width, cols, levelGap)
      const rowPitch = tile + levelGap
      const rows = Math.ceil((window.innerHeight || 800) / rowPitch) + 4

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

  // ---- imperative gesture / crossfade engine ----
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const hasTitlesRef = useRef(hasTitles)
  hasTitlesRef.current = hasTitles

  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)
  const pendingScrollRef = useRef<number | null>(null)
  const transitionRef = useRef<Transition | null>(null)
  const visualTileRef = useRef(0)
  const settleTargetRef = useRef<number | null>(null)
  const gestureRef = useRef({
    active: false,
    startDist: 0,
    startVisual: 0,
    lastDist: 0,
    midX: 0,
    midY: 0,
    lastMoveTime: 0,
  })

  const tileValue = useCallback(
    (level: number, host?: HTMLElement | null): number => {
      const el = host ?? hostRef.current
      const width = el?.clientWidth || window.innerWidth
      const cols = COLUMN_LEVELS[level]
      return tileSizeForColumns(width, cols, isDenseLevel(cols) ? 0 : GRID_GAP)
    },
    []
  )

  const layoutForLevel = useCallback(
    (level: number, width: number): GridLayout => {
      const cols = COLUMN_LEVELS[level]
      const isDense = isDenseLevel(cols)
      const src = sectionsRef.current
      const prepared =
        isDense && src.length > 0
          ? [{ key: '__dense__', items: flattenSections(src).items }]
          : src
      return computeLayout(prepared, width, cols, {
        gap: isDense ? 0 : GRID_GAP,
        renderHeaders: !isDense && hasTitlesRef.current,
      })
    },
    []
  )

  const commitTransition = useCallback(
    (t: Transition, originY: number) => {
      const visual = visualTileRef.current
      // fold the top layer's offset into the scroll so the committed grid
      // (which has no offset) lines up exactly
      const offset =
        (t.baseAnchorTop - originY) * (visual / t.fromTile) -
        (t.topAnchorTop - originY) * (visual / t.toTile)
      const newScroll = window.scrollY - offset
      pendingScrollRef.current = newScroll
      setBaseScrollOverride(newScroll)
      transitionRef.current = null
      setTopLevel(null)
      if (baseLayerRef.current != null) baseLayerRef.current.style.opacity = ''
      levelRef.current = t.toLevel
      zoom.setLevel(t.toLevel)
      settleTargetRef.current = tileValue(t.toLevel)
    },
    [tileValue, zoom]
  )

  const engineFrame = useRef<() => void>(() => undefined)
  engineFrame.current = () => {
    rafRef.current = 0
    const host = hostRef.current
    if (host == null) return
    const now = performance.now()
    const dt = lastFrameRef.current
      ? Math.min(64, now - lastFrameRef.current)
      : 16
    lastFrameRef.current = now

    const g = gestureRef.current
    const rect = host.getBoundingClientRect()

    // 1. current visual tile size
    let visual = visualTileRef.current
    if (g.active && g.startDist > 0) {
      visual = g.startVisual * (g.lastDist / g.startDist)
    } else if (settleTargetRef.current != null) {
      const target = settleTargetRef.current
      const k = Math.min(1, (dt / SETTLE_MS) * 2)
      visual = visual + (target - visual) * k
      if (Math.abs(target - visual) < 0.4) {
        visual = target
        settleTargetRef.current = null
      }
    }
    const minVisual = tileValue(COLUMN_LEVELS.length - 1, host)
    const maxVisual = tileValue(0, host)
    visual = Math.max(minVisual * 0.7, Math.min(maxVisual * 1.4, visual))
    visualTileRef.current = visual

    // 2. start a transition when the visual size passes a midpoint
    if (
      transitionRef.current == null &&
      (g.active || settleTargetRef.current != null)
    ) {
      const level = levelRef.current
      const fromTile = tileValue(level, host)
      const tryTo = (toLevel: number): boolean => {
        const toTile = tileValue(toLevel, host)
        const mid = Math.sqrt(fromTile * toTile)
        const raw =
          toTile > fromTile
            ? (visual - mid) / (toTile - mid)
            : (mid - visual) / (mid - toTile)
        if (raw < START_MARGIN) return false
        const width = host.clientWidth || window.innerWidth
        const fromLayout = layoutForLevel(level, width)
        const toLayout = layoutForLevel(toLevel, width)
        const anchorIndex = indexAtY(fromLayout, window.scrollY + g.midY)
        transitionRef.current = {
          fromLevel: level,
          toLevel,
          fromTile,
          toTile,
          midTile: mid,
          baseAnchorTop: itemTop(fromLayout, anchorIndex),
          topAnchorTop: itemTop(toLayout, anchorIndex),
          p: 0,
          desired: 0,
        }
        setTopLevel(toLevel)
        prefetchZoomLevelRef.current(toLevel)
        return true
      }
      if (level + 1 < COLUMN_LEVELS.length && tryTo(level + 1)) {
        // started zoom-in transition
      } else if (level - 1 >= 0 && tryTo(level - 1)) {
        // started zoom-out transition
      }
    }

    // 3. advance the crossfade
    const t = transitionRef.current
    const originY = g.midY - rect.top

    let topScale: number | null = null
    let topOffset = 0
    if (t != null) {
      topScale = t.toTile > 0 ? visual / t.toTile : 1
      topOffset =
        (t.baseAnchorTop - originY) * (visual / t.fromTile) -
        (t.topAnchorTop - originY) * (visual / t.toTile)

      const raw =
        t.toTile > t.fromTile
          ? (visual - t.midTile) / (t.toTile - t.midTile)
          : (t.midTile - visual) / (t.midTile - t.toTile)
      const idle = !g.active || now - g.lastMoveTime > IDLE_MS
      if (idle) {
        if (raw > 0.02) t.desired = 1
        else if (raw < -REVERT_MARGIN) t.desired = 0
      } else {
        t.desired = Math.max(0, Math.min(1, raw))
      }
      const maxStep = prefersReducedMotion() ? 1 : dt / FADE_MS
      if (t.p < t.desired) t.p = Math.min(t.desired, t.p + maxStep)
      else if (t.p > t.desired) t.p = Math.max(t.desired, t.p - maxStep)

      const baseOpacityEl = baseLayerRef.current
      const topOpacityEl = topLayerRef.current
      if (baseOpacityEl != null) baseOpacityEl.style.opacity = `${1 - t.p}`
      if (topOpacityEl != null) topOpacityEl.style.opacity = `${t.p}`

      if (t.p >= 1 && t.desired >= 1) commitTransition(t, originY)
      else if (t.p <= 0 && t.desired <= 0) {
        transitionRef.current = null
        setTopLevel(null)
        if (baseLayerRef.current != null)
          baseLayerRef.current.style.opacity = ''
        settleTargetRef.current = tileValue(levelRef.current)
      }
    } else {
      const baseEl = baseLayerRef.current
      if (baseEl != null) baseEl.style.opacity = ''
    }

    // The committed level may have just changed inside commitTransition above.
    // Derive the base scale from the *current* level, otherwise the commit
    // frame would render the new layout at the previous level's scale (the
    // full white flash / shift on switch).
    const baseTile = tileValue(levelRef.current, host)
    const baseScale = baseTile > 0 ? visual / baseTile : 1
    const finalTopScale = topScale ?? baseScale
    const finalTopOffset = topScale == null ? 0 : topOffset

    // apply the exact transforms every frame (GPU only, no React render)
    const originX = g.midX - rect.left
    const baseEl = baseLayerRef.current
    const topEl = topLayerRef.current
    if (baseEl != null) {
      baseEl.style.transformOrigin = `${originX}px ${originY}px`
      baseEl.style.transform = `scale(${baseScale})`
    }
    if (topEl != null) {
      topEl.style.transformOrigin = `${originX}px ${originY}px`
      topEl.style.transform = `translateY(${finalTopOffset}px) scale(${finalTopScale})`
    }

    // quantize the values that feed the virtualizers so React re-renders only
    // occasionally instead of on every frame
    const next: ViewProps = {
      baseScale: Math.round(baseScale * 10) / 10,
      topScale: Math.round(finalTopScale * 10) / 10,
      originY: Math.round(originY / 16) * 16,
      topOffset: Math.round(finalTopOffset / 64) * 64,
    }
    const prev = viewPropsRef.current
    if (
      next.baseScale !== prev.baseScale ||
      next.topScale !== prev.topScale ||
      next.originY !== prev.originY ||
      next.topOffset !== prev.topOffset
    ) {
      viewPropsRef.current = next
      setViewProps(next)
    }

    const more =
      g.active ||
      transitionRef.current != null ||
      settleTargetRef.current != null
    if (more) {
      rafRef.current = window.requestAnimationFrame(() => engineFrame.current())
    } else {
      lastFrameRef.current = 0
    }
  }

  const ensureEngine = useCallback(() => {
    if (rafRef.current == 0) {
      rafRef.current = window.requestAnimationFrame(() => engineFrame.current())
    }
  }, [])

  // keep visualTile in sync with the committed level when idle
  useEffect(() => {
    if (
      !gestureRef.current.active &&
      transitionRef.current == null &&
      settleTargetRef.current == null
    ) {
      const host = hostRef.current
      if (host != null) visualTileRef.current = tileValue(levelRef.current, host)
      viewPropsRef.current = {
        baseScale: 1,
        topScale: 1,
        originY: viewPropsRef.current.originY,
        topOffset: 0,
      }
      setViewProps(viewPropsRef.current)
      if (baseLayerRef.current != null) {
        baseLayerRef.current.style.transform = 'scale(1)'
        baseLayerRef.current.style.opacity = ''
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom.level])

  // ---- gestures ----
  const pinchRef = useRef(false)
  const wheelAccRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const alternateLevelRef = useRef<number | null>(null)
  const pinchEndAtRef = useRef(0)

  useEffect(() => {
    const elem = hostRef.current
    if (elem == null) return

    const touchDistance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      )
    const midPoint = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    })

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length != 2) return
      event.preventDefault()
      const rect = elem.getBoundingClientRect()
      const mid = midPoint(event.touches)
      const g = gestureRef.current
      g.active = true
      g.startDist = touchDistance(event.touches)
      g.startVisual = visualTileRef.current || tileValue(levelRef.current, elem)
      g.lastDist = g.startDist
      g.midX = mid.x
      g.midY = mid.y
      g.lastMoveTime = performance.now()
      // keep the pinch anchored for the virtualizers
      viewPropsRef.current = {
        ...viewPropsRef.current,
        originY: mid.y - rect.top,
      }
      settleTargetRef.current = null
      pinchRef.current = true
      ensureEngine()
    }

    const onTouchMove = (event: TouchEvent) => {
      const g = gestureRef.current
      if (!g.active || event.touches.length < 2) return
      event.preventDefault()
      const mid = midPoint(event.touches)
      g.lastDist = touchDistance(event.touches)
      g.midX = mid.x
      g.midY = mid.y
      g.lastMoveTime = performance.now()
      ensureEngine()
    }

    const onTouchEnd = (event: TouchEvent) => {
      const g = gestureRef.current
      const wasPinch = pinchRef.current

      if (wasPinch && event.touches.length < 2) {
        pinchRef.current = false
        g.active = false
        pinchEndAtRef.current = Date.now()
        lastTapRef.current = null
        if (transitionRef.current == null) {
          settleTargetRef.current = tileValue(levelRef.current, elem)
        }
        ensureEngine()
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
          const current = levelRef.current
          const alternate = alternateLevelRef.current ?? (current === 0 ? 2 : 0)
          alternateLevelRef.current = current
          if (alternate != current && transitionRef.current == null) {
            const rect = elem.getBoundingClientRect()
            gestureRef.current.midX = touch.clientX
            gestureRef.current.midY = touch.clientY
            viewPropsRef.current = {
              ...viewPropsRef.current,
              originY: touch.clientY - rect.top,
            }
            settleTargetRef.current = tileValue(alternate, elem)
            prefetchZoomLevelRef.current(alternate)
            ensureEngine()
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

    const onTouchCancel = () => {
      const g = gestureRef.current
      if (!g.active && transitionRef.current == null) return
      g.active = false
      pinchRef.current = false
      ensureEngine()
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (transitionRef.current != null) return

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
      const target = Math.max(
        0,
        Math.min(COLUMN_LEVELS.length - 1, current + direction)
      )
      if (target == current) return
      const rect = elem.getBoundingClientRect()
      gestureRef.current.midX = event.clientX
      gestureRef.current.midY = event.clientY
      viewPropsRef.current = {
        ...viewPropsRef.current,
        originY: event.clientY - rect.top,
      }
      settleTargetRef.current = tileValue(target, elem)
      prefetchZoomLevelRef.current(target)
      ensureEngine()
    }

    const onGestureStart = (event: Event) => event.preventDefault()

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
      if (rafRef.current != 0) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [ensureEngine, tileValue])

  // apply a pending scroll once the committed layout is on screen. This must
  // run before paint (layout effect), otherwise the new level is painted at
  // the old scroll position for a frame - the visible "flash" on a switch.
  useLayoutEffect(() => {
    if (pendingScrollRef.current != null) {
      window.scrollTo(0, pendingScrollRef.current)
      pendingScrollRef.current = null
    }
  }, [zoom.level, topLevel])

  // drop the virtualization override once the scroll listener has caught up
  useEffect(() => {
    if (baseScrollOverride == null) return
    const timer = window.setTimeout(() => setBaseScrollOverride(null), 300)
    return () => window.clearTimeout(timer)
  }, [baseScrollOverride])

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

  const prepSections = useCallback(
    (levelDense: boolean): GridSectionData<T>[] => {
      if (!levelDense || sections.length == 0) return sections
      return [{ key: '__dense__', items: flattenSections(sections).items }]
    },
    [sections]
  )

  const topColumns = topLevel != null ? COLUMN_LEVELS[topLevel] : null
  const topDense = topLevel != null ? isDenseLevel(topColumns!) : false

  return (
    <>
      <div
        ref={hostRef}
        style={{ touchAction: 'pan-y', position: 'relative' }}
      >
        <div
          ref={baseLayerRef}
          style={{ willChange: 'transform, opacity' }}
        >
          <VirtualGrid
            sections={layoutSections}
            columns={columns}
            gap={dense ? 0 : undefined}
            renderHeaders={renderHeaders}
            overscanRows={4}
            itemKey={itemKey}
            renderItem={renderItem}
            renderSectionTitle={renderSectionTitle}
            onLayoutChange={onLayoutChange}
            onVisibleRange={onVisibleRange}
            viewportScale={viewProps.baseScale}
            viewportOriginY={viewProps.originY}
            viewportTopOverride={baseScrollOverride ?? undefined}
          />
        </div>

        {topLevel != null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              pointerEvents: 'none',
            }}
          >
            <div
              ref={topLayerRef}
              style={{ willChange: 'transform, opacity', opacity: 0 }}
            >
              <VirtualGrid
                sections={prepSections(topDense)}
                columns={topColumns!}
                gap={topDense ? 0 : undefined}
                renderHeaders={hasTitles && !topDense}
                overscanRows={4}
                itemKey={itemKey}
                renderItem={renderItem}
                viewportScale={viewProps.topScale}
                viewportOriginY={viewProps.originY}
                viewportOffsetY={viewProps.topOffset}
              />
            </div>
          </div>
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
