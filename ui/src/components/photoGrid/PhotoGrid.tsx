import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'

/** pinch distance ratio that advances one zoom level */
const PINCH_LEVEL_RATIO = 1.6
/** accumulated wheel delta that advances one zoom level */
const WHEEL_LEVEL_THRESHOLD = 60
/** how long the floating date bar stays visible after scrolling stops */
const FLOATING_DATE_HIDE_DELAY = 1000

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
  /** Open media info (hover action on large tiles) */
  onItemSelect?(item: T, index: number): void
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
 * The photo grid: virtualized, zoomable in discrete column levels
 * (3 / 5 / 15 / 30 photos per row) and mobile friendly.
 *
 * Zoom interaction
 * ----------------
 *  - pinch: the distance ratio maps logarithmically to levels
 *    (every 1.6x distance change = one level), applied relative to the
 *    gesture start so the zoom is linear and predictable
 *  - double tap: toggles between the current level and the previous one
 *  - ctrl + wheel / trackpad pinch: accumulates until a level changes
 *
 * Zoom stability
 * --------------
 * Every level change captures an anchor (the item row under the given
 * viewport point plus the sub-row pixel offset) from the *current* layout
 * and restores the scroll position once the new layout is committed
 * (before paint), so the content under the user's fingers never jumps.
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
  onItemSelect,
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

  const activeAnchorRef = useRef<ZoomAnchor | null>(null)
  const pinchRef = useRef<{ startDist: number; startLevel: number } | null>(null)
  const wheelAccRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const alternateLevelRef = useRef<number | null>(null)

  const onLayoutChange = useCallback((layout: GridLayout) => {
    layoutRef.current = layout
  }, [])

  const applyZoomAt = useCallback(
    (level: number, viewportY: number) => {
      const layout = layoutRef.current
      if (layout != null && layout.itemCount > 0) {
        activeAnchorRef.current = captureZoomAnchor(
          layout,
          window.scrollY + viewportY,
          viewportY
        )
      } else {
        activeAnchorRef.current = null
      }
      zoom.setLevel(level)
    },
    [zoom]
  )

  // keep a stable ref so the gesture listeners never need to re-register
  const applyZoomAtRef = useRef(applyZoomAt)
  applyZoomAtRef.current = applyZoomAt

  // restore the anchor after the new layout is committed, before paint
  useLayoutEffect(() => {
    const anchor = activeAnchorRef.current
    if (anchor == null) return
    const layout = layoutRef.current
    if (layout == null) return
    activeAnchorRef.current = null

    const target = scrollForZoomAnchor(anchor, layout)
    // plain scrollTo (no smooth behavior) so zooming never fights animations
    window.scrollTo(0, target)
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

    const touchMidY = (touches: TouchList) =>
      (touches[0].clientY + touches[1].clientY) / 2

    const clampLevel = (level: number) =>
      Math.max(0, Math.min(COLUMN_LEVELS.length - 1, level))

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length == 2) {
        event.preventDefault()
        pinchRef.current = {
          startDist: touchDistance(event.touches),
          startLevel: levelRef.current,
        }
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current
      if (pinch == null || event.touches.length < 2) return
      event.preventDefault()

      const dist = touchDistance(event.touches)
      if (dist <= 0 || pinch.startDist <= 0) return

      // logarithmic mapping: every 1.6x distance change = one level.
      // spreading the fingers (ratio > 1) zooms in (fewer columns).
      const ratio = dist / pinch.startDist
      const offset = Math.round(Math.log(ratio) / Math.log(PINCH_LEVEL_RATIO))
      const newLevel = clampLevel(pinch.startLevel - offset)

      if (newLevel != levelRef.current) {
        applyZoomAtRef.current(newLevel, touchMidY(event.touches))
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchRef.current = null
      }

      // double tap: toggle between the current level and the previous one
      if (event.changedTouches.length == 1) {
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
            alternateLevelRef.current ??
            (current === 0 ? 2 : 0)
          alternateLevelRef.current = current

          applyZoomAtRef.current(alternate, touch.clientY)
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
        }
      }
    }

    // desktop / trackpad pinch (ctrl + wheel) and plain ctrl + wheel
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()

      wheelAccRef.current += -event.deltaY
      if (wheelAccRef.current > WHEEL_LEVEL_THRESHOLD) {
        wheelAccRef.current = 0
        applyZoomAtRef.current(clampLevel(levelRef.current - 1), event.clientY)
      } else if (wheelAccRef.current < -WHEEL_LEVEL_THRESHOLD) {
        wheelAccRef.current = 0
        applyZoomAtRef.current(clampLevel(levelRef.current + 1), event.clientY)
      }
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
        active={activeId != null && media.id == activeId}
        onClick={() => onItemActivate(media, absoluteIndex)}
        onFavorite={
          onItemFavorite ? () => onItemFavorite(media, absoluteIndex) : undefined
        }
        onSelect={
          onItemSelect ? () => onItemSelect(media, absoluteIndex) : undefined
        }
      />
    ),
    [dense, activeId, onItemActivate, onItemFavorite, onItemSelect]
  )

  return (
    <div ref={wrapperRef} style={{ touchAction: 'pan-y' }}>
      <VirtualGrid
        sections={layoutSections}
        columns={columns}
        gap={dense ? 0 : undefined}
        renderHeaders={renderHeaders}
        renderItem={renderItem}
        renderSectionTitle={renderSectionTitle}
        onLayoutChange={onLayoutChange}
      />

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
    </div>
  )
}

export default PhotoGrid
