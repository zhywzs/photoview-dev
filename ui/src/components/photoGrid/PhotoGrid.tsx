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
import { COLUMN_LEVELS, useZoomLevels } from './useZoomLevels'
import {
  GridLayout,
  GridSectionData,
  ZoomAnchor,
  captureZoomAnchor,
  flattenSections,
  groupForIndex,
  indexAtY,
  isDenseLevel,
  scrollForZoomAnchor,
} from './gridLayout'
import {
  SETTLE_DURATION_MS,
  TAP_SETTLE_DURATION_MS,
  applyFollowTransform,
  clearZoomTransform,
  clampFollowScale,
  commitLevelForVisualTile,
  levelTiles,
  prefersReducedMotion,
  residualAt,
  settleZoomTransform,
} from './gridTransform'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import {
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

/** Follow-layer state of an active pinch gesture. */
type PinchState = {
  /** finger distance at gesture start (pre-commit follow baseline) */
  startDist: number
  /** rendered tile size of the gesture-start level */
  baseTile: number
  /** committed level index */
  level: number
  /** tile size per level for the current container width */
  tiles: number[]
  /** untransformed host rect, used to map viewport anchors into the element */
  rect: DOMRect
  // --- post-commit follow state (incremental model) ---
  /** finger distance at the last commit (delta baseline) */
  commitDist: number
  /** residual scale applied at the last commit */
  residual: number
  /** timestamp of the last commit */
  commitTime: number
  /** most recent finger distance (also readable when the fingers pause) */
  lastDist: number
  /** transform origin at commit time, in element coordinates */
  originX: number
  originY: number
}

/** Transform applied after a level commit renders, before paint. */
type PendingResidual = {
  scale: number
  viewportX: number
  viewportY: number
  /** settle duration in ms, or false to keep following (pinch commits) */
  settle: number | false
}

/**
 * The photo grid: virtualized, zoomable in discrete column levels
 * (3 / 5 / 15 / 30 photos per row) and mobile friendly.
 *
 * Zoom interaction
 * ----------------
 *  - pinch: photos track the fingers 1:1 through a CSS transform on the
 *    grid host (no layout work per frame). When the visual tile size
 *    crosses the geometric midpoint between two levels, the new level's
 *    layout takes over: the scroll is restored so the anchored photo
 *    stays under the fingers, and the size difference is applied as a
 *    residual transform that is folded into the follow baseline - the
 *    takeover is visually seamless and the follow continues exactly
 *    where the fingers are. On release the residual settles to identity.
 *  - double tap: toggles between the current level and the previous one,
 *    with a residual + settle transition from the tap point
 *  - ctrl + wheel / trackpad pinch: accumulates until a level changes
 *
 * Date display
 * ------------
 *  - levels with few columns render sticky section header bars
 *  - levels with many columns render no headers; instead a floating date
 *    pill appears while scrolling and fades out after 1s of inactivity
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

  // ---- thumbnail atlas (all levels) ----
  // Two atlas sizes: 128px tiles for dense levels (15/30 columns),
  // 256px tiles for sparse levels (3/5 columns). Both load a whole
  // screen in a few requests; the tile size is chosen so the atlas
  // tile is at least as large as the CSS tile (DPR 1 quality, softer
  // on high-DPR screens - the user opens the viewer for details).
  const [tileSize, setTileSize] = useState(0)

  const onLayoutChange = useCallback((layout: GridLayout) => {
    layoutRef.current = layout
    setTileSize(layout.tileSize)
  }, [])

  const atlasTileSize = dense ? 128 : 256

  const atlasIds = useMemo(
    () =>
      layoutSections.flatMap(section => section.items.map(item => item.id)),
    [layoutSections]
  )

  const { data: atlasData } = useQuery<
    mediaAtlases,
    mediaAtlasesVariables
  >(MEDIA_ATLASES_QUERY, {
    variables: { ids: atlasIds, tileSize: atlasTileSize },
    skip: atlasIds.length == 0 || tileSize == 0,
    fetchPolicy: 'no-cache',
  })

  const atlasMap = useMemo(() => buildAtlasMap(atlasData), [atlasData])

  // extra overscan while a pinch has committed: the residual transform
  // scales the rendered rows, and the virtualizer needs to cover the
  // scaled-up viewport area
  const [extraOverscan, setExtraOverscan] = useState(false)

  const activeAnchorRef = useRef<ZoomAnchor | null>(null)
  const pendingResidualRef = useRef<PendingResidual | null>(null)
  const pinchRef = useRef<PinchState | null>(null)
  const cancelSettleRef = useRef<(() => void) | null>(null)
  const wheelAccRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const alternateLevelRef = useRef<number | null>(null)
  const pinchEndAtRef = useRef(0)

  /**
   * Commit to a new zoom level. Captures a scroll anchor at the gesture
   * point, asks React to render the new level and schedules the residual
   * transform that keeps the view continuous across the takeover.
   */
  const commitLevel = useCallback(
    (
      level: number,
      anchorX: number,
      anchorY: number,
      residualScale: number,
      settle: number | false
    ) => {
      const layout = layoutRef.current
      if (layout != null && layout.itemCount > 0) {
        activeAnchorRef.current = captureZoomAnchor(
          layout,
          window.scrollY + anchorY,
          anchorY
        )
        pendingResidualRef.current = {
          scale: residualScale,
          viewportX: anchorX,
          viewportY: anchorY,
          settle,
        }
      } else {
        activeAnchorRef.current = null
        pendingResidualRef.current = null
      }
      zoom.setLevel(level)
    },
    [zoom]
  )

  // keep a stable ref so the gesture listeners never need to re-register
  const commitLevelRef = useRef(commitLevel)
  commitLevelRef.current = commitLevel

  // after the new level's layout is committed (before paint): restore the
  // anchor scroll and apply the residual transform around the anchor
  useLayoutEffect(() => {
    const anchor = activeAnchorRef.current
    if (anchor != null) {
      activeAnchorRef.current = null
      const layout = layoutRef.current
      if (layout != null) {
        window.scrollTo(0, scrollForZoomAnchor(anchor, layout))
      }
    }

    const residual = pendingResidualRef.current
    const host = wrapperRef.current
    if (residual != null && host != null) {
      pendingResidualRef.current = null

      cancelSettleRef.current?.()
      cancelSettleRef.current = null

      // neutralize the transform to measure the untransformed box
      host.style.transition = 'none'
      host.style.transform = 'none'
      const rect = host.getBoundingClientRect()

      applyFollowTransform(
        host,
        residual.scale,
        residual.viewportX - rect.left,
        residual.viewportY - rect.top
      )

      // keep the pinch baseline fresh for subsequent follow frames: the
      // scroll restore moved the element in the viewport, so the element
      // rect and the follow origin must be recomputed from it
      if (pinchRef.current != null) {
        pinchRef.current.rect = rect
        pinchRef.current.originX = residual.viewportX - rect.left
        pinchRef.current.originY = residual.viewportY - rect.top
      }

      if (residual.settle !== false) {
        cancelSettleRef.current = settleZoomTransform(
          host,
          prefersReducedMotion() ? 0 : residual.settle
        )
      }
    }
  }, [zoom.level])

  // ---- gestures (native listeners so preventDefault works) ----
  useEffect(() => {
    const elem = wrapperRef.current
    if (elem == null) return

    const touchDistance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      )

    const touchMidX = (touches: TouchList) =>
      (touches[0].clientX + touches[1].clientX) / 2

    const touchMidY = (touches: TouchList) =>
      (touches[0].clientY + touches[1].clientY) / 2

    const clampLevel = (level: number) =>
      Math.max(0, Math.min(COLUMN_LEVELS.length - 1, level))

    /**
     * Time-driven absorption of the commit residual: keeps writing the
     * follow transform on every animation frame until the residual has
     * fully collapsed to 1, *independently of touchmove events*. This is
     * what makes the photos glide to the exact tile size of the committed
     * level even when the fingers stop right at the threshold.
     */
    let absorbRaf = 0
    const runAbsorption = () => {
      if (absorbRaf != 0) return // already running
      const step = () => {
        absorbRaf = 0
        const pinch = pinchRef.current
        if (pinch == null || pinch.commitDist <= 0) return

        const elapsed = Date.now() - pinch.commitTime
        const residual = residualAt(pinch.residual, elapsed)
        const delta =
          (pinch.lastDist > 0 ? pinch.lastDist : pinch.commitDist) /
          pinch.commitDist
        const scale = clampFollowScale(
          delta * residual,
          pinch.level,
          pinch.tiles.length - 1
        )
        applyFollowTransform(elem, scale, pinch.originX, pinch.originY)

        if (residual != 1) {
          absorbRaf = window.requestAnimationFrame(step)
        }
      }
      absorbRaf = window.requestAnimationFrame(step)
    }
    const cancelAbsorption = () => {
      if (absorbRaf != 0) window.cancelAnimationFrame(absorbRaf)
      absorbRaf = 0
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length == 2) {
        event.preventDefault()

        // start from a clean identity transform; if a settle animation is
        // still in flight it snaps to its end state (a small, rare jump)
        cancelAbsorption()
        cancelSettleRef.current?.()
        cancelSettleRef.current = null
        clearZoomTransform(elem)
        setExtraOverscan(false)

        const dist = touchDistance(event.touches)
        const tiles = levelTiles(elem.clientWidth)
        pinchRef.current = {
          startDist: dist,
          baseTile: tiles[levelRef.current],
          level: levelRef.current,
          tiles,
          rect: elem.getBoundingClientRect(),
          commitDist: 0,
          residual: 1,
          commitTime: 0,
          lastDist: dist,
          originX: 0,
          originY: 0,
        }
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current
      if (pinch == null || event.touches.length < 2) return
      event.preventDefault()

      const dist = touchDistance(event.touches)
      if (dist <= 0 || pinch.startDist <= 0) return
      pinch.lastDist = dist

      const midX = touchMidX(event.touches)
      const midY = touchMidY(event.touches)

      // follow transform: finger increment since the last commit, multiplied
      // by a residual factor that absorbs towards 1 after the commit so the
      // photos glide to the exact tile size of the committed level even when
      // the fingers stop right at the threshold
      const committed = pinch.commitDist > 0
      const delta = committed ? dist / pinch.commitDist : dist / pinch.startDist
      const residual = committed
        ? residualAt(pinch.residual, Date.now() - pinch.commitTime)
        : 1
      const scale = clampFollowScale(
        delta * residual,
        pinch.level,
        pinch.tiles.length - 1
      )
      const visualTile = pinch.baseTile * scale

      const newLevel = commitLevelForVisualTile(
        pinch.level,
        visualTile,
        pinch.tiles
      )

      if (newLevel != null) {
        // the new level takes over; the size difference becomes a residual
        // that absorbs over the next frames (no jump, no lingering
        // off-size state), and the follow continues from the finger delta
        const targetTile = pinch.tiles[newLevel]
        const residualScale = visualTile / targetTile

        commitLevelRef.current(newLevel, midX, midY, residualScale, false)

        pinch.commitDist = dist
        pinch.residual = residualScale
        pinch.commitTime = Date.now()
        pinch.baseTile = targetTile
        pinch.level = newLevel
        pinch.originX = midX - pinch.rect.left
        pinch.originY = midY - pinch.rect.top

        // while the residual is > 1 the visible area shrinks; while < 1 the
        // viewport needs more rows than usual - render extra around it
        setExtraOverscan(true)

        // drive the absorption by time, not by finger events
        runAbsorption()
      } else if (committed) {
        applyFollowTransform(elem, scale, pinch.originX, pinch.originY)
      } else {
        applyFollowTransform(
          elem,
          scale,
          midX - pinch.rect.left,
          midY - pinch.rect.top
        )
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      const wasPinch = pinchRef.current != null

      if (wasPinch && event.touches.length < 2) {
        pinchRef.current = null
        pinchEndAtRef.current = Date.now()
        lastTapRef.current = null // a pinch release must not count as a tap

        // stop the time-driven absorption: the CSS settle below takes over
        // and finishes the glide to the exact tile size
        cancelAbsorption()
        cancelSettleRef.current?.()
        cancelSettleRef.current = settleZoomTransform(
          elem,
          prefersReducedMotion() ? 0 : SETTLE_DURATION_MS,
          () => setExtraOverscan(false)
        )
        return
      }

      // double tap: toggle between the current level and the previous one
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

          if (alternate != current) {
            const tiles = levelTiles(elem.clientWidth)
            const residual = tiles[current] / tiles[alternate]
            commitLevelRef.current(
              alternate,
              touch.clientX,
              touch.clientY,
              residual,
              TAP_SETTLE_DURATION_MS
            )
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

    // desktop / trackpad pinch (ctrl + wheel)
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

      const current = levelRef.current
      const newLevel = clampLevel(current + direction)
      if (newLevel == current) return

      const tiles = levelTiles(elem.clientWidth)
      const residual = tiles[current] / tiles[newLevel]
      commitLevelRef.current(
        newLevel,
        event.clientX,
        event.clientY,
        residual,
        SETTLE_DURATION_MS
      )
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
      cancelAbsorption()
      cancelSettleRef.current?.()
      cancelSettleRef.current = null
      clearZoomTransform(elem)
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

        // the layout is a single flat block in dense mode; map the flat
        // index back to its date group for the overlay
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
      {/* the wrapper is transformed as a whole during pinch gestures,
          so it must contain only the grid (overlays stay outside) */}
      <div ref={wrapperRef} style={{ touchAction: 'pan-y' }}>
        <VirtualGrid
          sections={layoutSections}
          columns={columns}
          gap={dense ? 0 : undefined}
          renderHeaders={renderHeaders}
          overscanRows={extraOverscan ? 8 : 3}
          renderItem={renderItem}
          renderSectionTitle={renderSectionTitle}
          onLayoutChange={onLayoutChange}
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
