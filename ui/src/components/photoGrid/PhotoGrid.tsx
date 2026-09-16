import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@apollo/client'
import ZoomLayer, {
  GAP_RATIO,
  pitchForColumns,
  rowMaxFor,
  rowMinFor,
  tileForColumns,
} from './ZoomLayer'
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
const IDLE_MS = 110
const FADE_START = 0.6
const FADE_MS = 500
const ATLAS_TILE_SIZE = 256
const ROW_MARGIN = 3

type LayerState = { columns: number; wrapOrigin: number }

type PhotoGridProps<T extends MediaGalleryFields> = {
  sections?: GridSectionData<T>[]
  items?: T[]
  onItemActivate(item: T, index: number): void
  onItemFavorite?(item: T, index: number): void
  activeId?: string
  onColumnsChange?(columns: number): void
}

const vh = () =>
  typeof window === 'undefined' ? 800 : window.innerHeight || 800

function stopIndex(columns: number): number {
  let best = 0
  let bestDist = Infinity
  COLUMN_STOPS.forEach((s, i) => {
    const d = Math.abs(s - columns)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

/**
 * Timeline grid with the validated zoom model.
 *
 * The photos are one ordered sequence (oldest first), so the newest photo is
 * at the bottom-right and the initial view is the bottom. Zooming is done with
 * two layers that are never re-laid-out:
 *
 *  - the committed layer and (during a level change) the target layer each
 *    place the photo under the fingers at the fingers, and crossfade once;
 *  - the target layer's row wrapping puts that photo at the column nearest the
 *    fingers, so the view never jumps to another date and the anchor settles
 *    as close to the pinch centre as the grid allows;
 *  - on release only the tile size eases to the target and the anchor offset
 *    is folded into the scroll in one step (visually identical).
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

  const seq = useMemo(() => flatItems.slice().reverse(), [flatItems])
  const flatItemsRef = useRef(flatItems)
  flatItemsRef.current = flatItems
  const dateGroupsRef = useRef(dateGroups)
  dateGroupsRef.current = dateGroups
  const itemKey = useCallback((media: T) => media.id, [])

  const hostRef = useRef<HTMLDivElement | null>(null)
  const layerSRef = useRef<HTMLDivElement | null>(null)
  const layerTRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)
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

  // ---- atlas (single 256px size; the source never changes with zoom) ----
  const atlasIds = useMemo(() => flatItems.map(itemKey), [flatItems, itemKey])

  const { data: atlasData } = useQuery<mediaAtlases, mediaAtlasesVariables>(
    MEDIA_ATLASES_QUERY,
    {
      variables: { ids: atlasIds, tileSize: ATLAS_TILE_SIZE },
      skip: atlasIds.length == 0,
      fetchPolicy: 'no-cache',
    }
  )
  const atlasMap: AtlasTileMap = useMemo(
    () => buildAtlasMap(atlasData),
    [atlasData]
  )

  // ---- layers ----
  const [src, setSrc] = useState<LayerState>(() => ({
    columns: nearestStop(zoom.columns),
    wrapOrigin: 0,
  }))
  const [tgt, setTgt] = useState<LayerState | null>(null)
  const srcRef = useRef(src)
  srcRef.current = src
  const tgtRef = useRef(tgt)
  tgtRef.current = tgt

  const [rows, setRows] = useState({ s0: 0, s1: 4, t0: 0, t1: 0 })
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const floatingRef = useRef<string | null>(null)

  // mutable zoom state, driven by gestures without React renders
  const visualTileRef = useRef(0)
  const fadeRef = useRef(0)
  const fadeTargetRef = useRef(0)
  const anchorPhotoRef = useRef(0)
  const fingerXRef = useRef(0)
  const fingerYRef = useRef(0)
  const scrollYRef = useRef(0)
  const pinchingRef = useRef(false)
  const settleRef = useRef(false)
  const lastMoveRef = useRef(0)
  const startDistRef = useRef(0)
  const startTileRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const lastTapEndRef = useRef(0)
  const wheelAccRef = useRef(0)
  const laidOutRef = useRef(false)

  const committedTile = useCallback(
    () => tileForColumns(effWidth, srcRef.current.columns, GAP_RATIO),
    [effWidth]
  )

  const layoutSpacer = useCallback(() => {
    const spacer = spacerRef.current
    if (spacer == null) return
    const { columns, wrapOrigin } = srcRef.current
    const rowsCount =
      rowMaxFor(wrapOrigin, columns, flatItemsRef.current.length) -
      rowMinFor(wrapOrigin, columns) +
      1
    spacer.style.height = `${Math.max(1, rowsCount) * pitchForColumns(effWidth, columns, GAP_RATIO)}px`
  }, [effWidth])

  const applyLayers = useCallback(() => {
    const host = hostRef.current
    if (host == null) return
    const rect = host.getBoundingClientRect()
    const hostTop = rect.top
    const hostLeft = rect.left
    const visualTile = visualTileRef.current
    const fade = fadeRef.current
    const scrollY = scrollYRef.current
    const P = visualTile * (1 + GAP_RATIO)
    const vhpx = vh()

    const place = (
      layer: LayerState,
      el: HTMLDivElement | null
    ): number => {
      if (el == null) return 0
      const { columns, wrapOrigin } = layer
      const s = visualTile / tileForColumns(effWidth, columns, GAP_RATIO)
      const rowMin = rowMinFor(wrapOrigin, columns)
      const pRow = Math.floor((anchorPhotoRef.current - wrapOrigin) / columns)
      const pCol =
        ((((anchorPhotoRef.current - wrapOrigin) % columns) + columns) %
          columns)
      const panX = fingerXRef.current - hostLeft - pCol * P
      const panY =
        fingerYRef.current - hostTop + scrollY - (pRow - rowMin) * P
      el.style.transform = `translate(${panX}px, ${panY}px) scale(${s})`
      return panY
    }

    const srcPanY = place(srcRef.current, layerSRef.current)
    const tgtPanY = tgt != null ? place(tgt, layerTRef.current) : 0

    if (layerSRef.current != null) {
      layerSRef.current.style.opacity = tgt != null ? `${1 - fade}` : '1'
    }
    if (layerTRef.current != null && tgt != null) {
      layerTRef.current.style.opacity = `${fade}`
    }

    // extend the rendered row ranges to cover the (possibly scaled) viewport
    const rangeFor = (layer: LayerState, panY: number) => {
      const { columns, wrapOrigin } = layer
      const pitch = pitchForColumns(effWidth, columns, GAP_RATIO)
      const rowMin = rowMinFor(wrapOrigin, columns)
      const s = visualTile / tileForColumns(effWidth, columns, GAP_RATIO)
      const localTop = (scrollY - hostTop - panY) / s
      const localBottom = (scrollY + vhpx - hostTop - panY) / s
      return [
        rowMin + Math.floor(localTop / pitch) - ROW_MARGIN,
        rowMin + Math.ceil(localBottom / pitch) + ROW_MARGIN,
      ] as const
    }
    const [s0, s1] = rangeFor(srcRef.current, srcPanY)
    const [t0, t1] =
      tgt != null
        ? rangeFor(tgt, tgtPanY)
        : ([rowsRef.current.t0, rowsRef.current.t1] as const)
    const r = rowsRef.current
    if (s0 < r.s0 || s1 > r.s1 || t0 < r.t0 || t1 > r.t1) {
      setRows({
        s0: Math.min(r.s0, s0),
        s1: Math.max(r.s1, s1),
        t0: Math.min(r.t0, t0),
        t1: Math.max(r.t1, t1),
      })
    }

    // floating date from the topmost visible photo of the committed layer
    const topPhoto = Math.max(
      0,
      Math.min(
        flatItemsRef.current.length - 1,
        srcRef.current.wrapOrigin + Math.max(s0, rowMinFor(srcRef.current.wrapOrigin, srcRef.current.columns)) * srcRef.current.columns
      )
    )
    const flatTop = flatItemsRef.current.length - 1 - topPhoto
    const group = groupForIndex(dateGroupsRef.current, Math.max(0, flatTop))
    const title = group?.title ?? null
    if (title !== floatingRef.current) {
      floatingRef.current = title
      setFloatingDate(title)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effWidth, tgt])

  const applyRef = useRef(applyLayers)
  applyRef.current = applyLayers

  // ---- animation loop ----
  const rafRef = useRef(0)
  const lastTRef = useRef(0)
  const animatingRef = useRef(false)
  const kick = useCallback(() => {
    if (animatingRef.current) return
    animatingRef.current = true
    lastTRef.current = 0
    const frame = (t: number) => {
      const dt = lastTRef.current ? Math.min(64, t - lastTRef.current) : 16
      lastTRef.current = t
      if (
        pinchingRef.current &&
        tgtRef.current != null &&
        performance.now() - lastMoveRef.current > IDLE_MS
      ) {
        fadeTargetRef.current = 1
      }
      const step = dt / FADE_MS
      if (fadeRef.current < fadeTargetRef.current)
        fadeRef.current = Math.min(
          fadeTargetRef.current,
          fadeRef.current + step
        )
      else if (fadeRef.current > fadeTargetRef.current)
        fadeRef.current = Math.max(
          fadeTargetRef.current,
          fadeRef.current - step
        )
      applyRef.current()
      if (
        pinchingRef.current ||
        settleRef.current ||
        fadeRef.current !== fadeTargetRef.current
      ) {
        rafRef.current = window.requestAnimationFrame(frame)
      } else {
        animatingRef.current = false
        rafRef.current = 0
      }
    }
    rafRef.current = window.requestAnimationFrame(frame)
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current != 0) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ---- boot: start at the bottom (newest) ----
  useLayoutEffect(() => {
    if (effWidth <= 0) return
    if (!laidOutRef.current) {
      laidOutRef.current = true
      visualTileRef.current = committedTile()
      scrollYRef.current = window.scrollY
      setRows({ s0: 0, s1: 4, t0: 0, t1: 0 })
      window.requestAnimationFrame(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
        scrollYRef.current = window.scrollY
        layoutSpacer()
        applyRef.current()
        kick()
      })
    }
    layoutSpacer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effWidth, flatItems.length])

  // keep pinned to the newest until the user scrolls
  const stickBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  useEffect(() => {
    const onScroll = () => {
      if (programmaticScrollRef.current) return
      stickBottomRef.current = false
      scrollYRef.current = window.scrollY
      applyRef.current()
      kick()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [kick])

  useEffect(() => {
    const host = hostRef.current
    if (host == null) return
    const stick = () => {
      if (!stickBottomRef.current || !laidOutRef.current) return
      programmaticScrollRef.current = true
      window.scrollTo(0, document.documentElement.scrollHeight)
      scrollYRef.current = window.scrollY
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
      applyRef.current()
      kick()
    }
    stick()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(stick)
    observer.observe(host)
    return () => observer.disconnect()
  }, [flatItems.length, effWidth, kick])

  // ---- gestures ----
  const snapAnchor = useCallback(
    (fx: number, fy: number) => {
      fingerXRef.current = fx
      fingerYRef.current = fy
      scrollYRef.current = window.scrollY
      const { columns, wrapOrigin } = srcRef.current
      const pitch = pitchForColumns(effWidth, columns, GAP_RATIO)
      const rowMin = rowMinFor(wrapOrigin, columns)
      const r = rowMin + Math.floor((fy + scrollYRef.current) / pitch)
      const c = Math.floor(fx / pitch)
      anchorPhotoRef.current = Math.max(
        0,
        Math.min(flatItemsRef.current.length - 1, wrapOrigin + r * columns + c)
      )
    },
    [effWidth]
  )

  const beginTransition = useCallback(
    (target: number) => {
      const rel = fingerXRef.current / Math.max(1, effWidth)
      const col = Math.max(
        0,
        Math.min(target - 1, Math.round(rel * target - 0.5))
      )
      const wrap = anchorPhotoRef.current - col
      fadeRef.current = 0
      fadeTargetRef.current = 0
      setTgt({ columns: target, wrapOrigin: wrap })
    },
    [effWidth]
  )

  const commitLayer = useCallback(
    (layer: LayerState) => {
      srcRef.current = layer
      setSrc(layer)
      tgtRef.current = null
      setTgt(null)
    },
    []
  )

  const settleTo = useCallback(
    (commit: boolean) => {
      if (tgtRef.current == null) {
        settleRef.current = false
        return
      }
      settleRef.current = true
      const tgtLayer = tgtRef.current
      const settleColumns = commit
        ? tgtLayer.columns
        : srcRef.current.columns
      const from = visualTileRef.current
      const to = tileForColumns(effWidth, settleColumns, GAP_RATIO)
      const t0 = performance.now()
      let lastT = t0
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / SETTLE_MS)
        const e = 1 - Math.pow(1 - k, 3)
        visualTileRef.current = from + (to - from) * e
        fadeTargetRef.current = commit ? 1 : 0
        const stepFade = (t - lastT) / FADE_MS
        lastT = t
        if (fadeRef.current < fadeTargetRef.current)
          fadeRef.current = Math.min(
            fadeTargetRef.current,
            fadeRef.current + stepFade
          )
        else if (fadeRef.current > fadeTargetRef.current)
          fadeRef.current = Math.max(
            fadeTargetRef.current,
            fadeRef.current - stepFade
          )
        applyRef.current()
        if (k < 1) {
          window.requestAnimationFrame(step)
          return
        }
        // fold the anchor offset into the scroll in one step (visually
        // identical) - the content does not move at all
        const layer = commit ? tgtLayer : srcRef.current
        commitLayer(layer)
        visualTileRef.current = tileForColumns(
          effWidth,
          layer.columns,
          GAP_RATIO
        )
        fadeRef.current = 0
        fadeTargetRef.current = 0

        const hostTop = hostRef.current?.getBoundingClientRect().top ?? 0
        const pitch = pitchForColumns(effWidth, layer.columns, GAP_RATIO)
        const rowMin = rowMinFor(layer.wrapOrigin, layer.columns)
        const pRow = Math.floor(
          (anchorPhotoRef.current - layer.wrapOrigin) / layer.columns
        )
        const panY =
          fingerYRef.current +
          scrollYRef.current -
          hostTop -
          (pRow - rowMin) * pitch
        layoutSpacer()
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - vh()
        )
        const newScroll = Math.max(
          0,
          Math.min(maxScroll, scrollYRef.current - panY)
        )
        window.scrollTo(0, newScroll)
        scrollYRef.current = window.scrollY
        applyRef.current()
        settleRef.current = false
        kick()
      }
      window.requestAnimationFrame(step)
      kick()
    },
    [effWidth, commitLayer, layoutSpacer, kick]
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
      pinchingRef.current = true
      startDistRef.current = dist(event.touches)
      startTileRef.current = tileForColumns(
        effWidth,
        srcRef.current.columns,
        GAP_RATIO
      )
      tgtRef.current = null
      setTgt(null)
      fadeRef.current = 0
      fadeTargetRef.current = 0
      const m = mid(event.touches)
      snapAnchor(m.x, m.y)
      lastMoveRef.current = performance.now()
      kick()
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!pinchingRef.current || event.touches.length < 2) return
      event.preventDefault()
      const m = mid(event.touches)
      fingerXRef.current = m.x
      fingerYRef.current = m.y
      scrollYRef.current = window.scrollY
      const d = dist(event.touches)
      if (startDistRef.current <= 0) return
      const scale = d / startDistRef.current

      if (tgtRef.current == null && Math.abs(scale - 1) > 0.03) {
        const i = stopIndex(srcRef.current.columns)
        const dir = scale < 1 ? 1 : -1
        const ni = Math.max(0, Math.min(COLUMN_STOPS.length - 1, i + dir))
        const target = COLUMN_STOPS[ni]
        if (target !== srcRef.current.columns) beginTransition(target)
      }

      const tFrom = tileForColumns(
        effWidth,
        srcRef.current.columns,
        GAP_RATIO
      )
      const tTo =
        tgtRef.current != null
          ? tileForColumns(effWidth, tgtRef.current.columns, GAP_RATIO)
          : tFrom
      let vis = startTileRef.current * scale
      vis = Math.max(
        Math.min(tFrom, tTo) * 0.9,
        Math.min(Math.max(tFrom, tTo) * 1.1, vis)
      )
      visualTileRef.current = vis

      const prog =
        tFrom === tTo
          ? 1
          : Math.max(0, Math.min(1, (tFrom - vis) / (tFrom - tTo)))
      fadeTargetRef.current =
        tgtRef.current == null
          ? 0
          : Math.max(0, Math.min(1, (prog - FADE_START) / (1 - FADE_START)))

      lastMoveRef.current = performance.now()
      kick()
    }

    const finish = () => {
      pinchingRef.current = false
      const tgtLayer = tgtRef.current
      if (tgtLayer == null) {
        settleRef.current = false
        return
      }
      const tFrom = tileForColumns(
        effWidth,
        srcRef.current.columns,
        GAP_RATIO
      )
      const tTo = tileForColumns(effWidth, tgtLayer.columns, GAP_RATIO)
      const prog =
        tFrom === tTo
          ? 1
          : Math.max(
              0,
              Math.min(1, (tFrom - visualTileRef.current) / (tFrom - tTo))
            )
      settleTo(prog >= 0.5)
    }

    const startFast = (target: number, x: number, y: number) => {
      snapAnchor(x, y)
      startDistRef.current = 1
      startTileRef.current = tileForColumns(
        effWidth,
        srcRef.current.columns,
        GAP_RATIO
      )
      beginTransition(target)
      settleTo(true)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (pinchingRef.current && event.touches.length < 2) {
        finish()
        return
      }
      if (
        !pinchingRef.current &&
        event.changedTouches.length == 1 &&
        Date.now() - lastTapEndRef.current > PINCH_TAP_SWALLOW_MS
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
          const current = nearestStop(srcRef.current.columns)
          const alternate = current <= 5 ? 15 : 5
          if (alternate !== current && !settleRef.current) {
            startFast(alternate, touch.clientX, touch.clientY)
          }
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
        }
      }
      lastTapEndRef.current = Date.now()
    }

    const onTouchCancel = () => {
      if (!pinchingRef.current) return
      finish()
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (settleRef.current) return
      wheelAccRef.current += -event.deltaY
      const dir =
        wheelAccRef.current > WHEEL_LEVEL_THRESHOLD
          ? -1
          : wheelAccRef.current < -WHEEL_LEVEL_THRESHOLD
          ? 1
          : 0
      if (dir == 0) return
      wheelAccRef.current = 0
      const current = nearestStop(srcRef.current.columns)
      const i = stopIndex(current)
      const ni = Math.max(0, Math.min(COLUMN_STOPS.length - 1, i + dir))
      const target = COLUMN_STOPS[ni]
      if (target === current) return
      startFast(target, event.clientX, event.clientY)
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
    }
  }, [effWidth, snapAnchor, beginTransition, settleTo, kick])

  // report the settled column count so the parent can re-group dates
  useEffect(() => {
    onColumnsChangeRef.current?.(src.columns)
  }, [src.columns])

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
      <div ref={spacerRef} style={{ width: '100%' }} />
      {effWidth > 0 && (
        <>
          <ZoomLayer
            items={seq}
            columns={src.columns}
            wrapOrigin={src.wrapOrigin}
            width={effWidth}
            r0={rows.s0}
            r1={rows.s1}
            renderItem={renderItem}
            layerRef={layerSRef}
          />
          {tgt != null && (
            <ZoomLayer
              items={seq}
              columns={tgt.columns}
              wrapOrigin={tgt.wrapOrigin}
              width={effWidth}
              r0={rows.t0}
              r1={rows.t1}
              renderItem={renderItem}
              layerRef={layerTRef}
            />
          )}
        </>
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
