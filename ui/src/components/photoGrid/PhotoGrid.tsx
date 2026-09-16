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
  layerVisibleRows,
} from './ZoomLayer'
import PhotoTile from './PhotoTile'
import { GridSectionData, flattenSections, groupForIndex } from './gridLayout'
import { COLUMN_STOPS, nearestStop, useGridZoom } from './gridZoom'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import {
  AtlasTile,
  AtlasTileMap,
  MEDIA_ATLASES_QUERY,
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
const ROW_MARGIN = 2

type LayerState = { columns: number; wrapOrigin: number }

type GridTileProps = {
  media: MediaGalleryFields
  tileSize: number
  atlas?: AtlasTile
  active: boolean
  canFavorite: boolean
  index: number
  onActivate(media: MediaGalleryFields, index: number): void
  onFavorite(media: MediaGalleryFields, index: number): void
}

/**
 * Memoized tile wrapper. Zooming re-renders the grid's row window (the window
 * shifts as the layout scales), so the tiles must bail out of re-rendering
 * unless their own content changed - otherwise every gesture frame would cost
 * a few hundred tile renders.
 */
const GridTile = React.memo(function GridTile({
  media,
  tileSize,
  atlas,
  active,
  canFavorite,
  index,
  onActivate,
  onFavorite,
}: GridTileProps) {
  return (
    <PhotoTile
      media={media}
      tileSize={tileSize}
      atlas={atlas}
      active={active}
      onClick={() => onActivate(media, index)}
      onFavorite={canFavorite ? () => onFavorite(media, index) : undefined}
    />
  )
})

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

  // Atlases are accumulated rather than replaced: requesting only the ids we
  // do not have yet (the timeline paginates) and keeping the already-resolved
  // AtlasTile objects identical means the memoized tiles that were already
  // showing an image do not re-render when another page loads.
  const atlasMap = useRef<AtlasTileMap>(new Map()).current
  const knownAtlasIds = useRef<Set<string>>(new Set())
  const [, setAtlasVersion] = useState(0)

  const pendingAtlasIds = useMemo(
    () => atlasIds.filter(id => !knownAtlasIds.current.has(id)),
    [atlasIds]
  )

  const { data: atlasData } = useQuery<mediaAtlases, mediaAtlasesVariables>(
    MEDIA_ATLASES_QUERY,
    {
      variables: { ids: pendingAtlasIds, tileSize: ATLAS_TILE_SIZE },
      skip: pendingAtlasIds.length == 0,
      fetchPolicy: 'no-cache',
    }
  )

  useEffect(() => {
    if (atlasData == null) return
    let added = false
    for (const atlas of atlasData.mediaAtlases) {
      for (const entry of atlas.entries) {
        knownAtlasIds.current.add(entry.mediaId)
        if (!atlasMap.has(entry.mediaId)) {
          atlasMap.set(entry.mediaId, {
            url: atlas.url,
            x: entry.x,
            y: entry.y,
            tileSize: atlas.tileSize,
            gridSize: atlas.gridSize,
          })
          added = true
        }
      }
    }
    if (added) setAtlasVersion(v => v + 1)
  }, [atlasData, atlasMap])

  // ---- layers ----
  // Two layer slots. A zoom transition renders the target in the idle slot and,
  // when it commits, that slot simply becomes the committed one: the props
  // (columns/wrapOrigin) and therefore the DOM of the visible photos do not
  // change at all, so the commit is invisible. The old committed slot is
  // dropped (it had already faded out).
  const [slots, setSlots] = useState<[LayerState | null, LayerState | null]>(
    () => [{ columns: nearestStop(zoom.columns), wrapOrigin: 0 }, null]
  )
  const [front, setFront] = useState<0 | 1>(0)
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const frontRef = useRef<0 | 1>(front)
  frontRef.current = front

  const srcLayer: LayerState =
    slots[front] ?? ({ columns: nearestStop(zoom.columns), wrapOrigin: 0 })
  const tgtSlot: 0 | 1 = front === 0 ? 1 : 0
  const tgtLayer = slots[tgtSlot]

  const srcRef = useRef(srcLayer)
  srcRef.current = srcLayer
  const tgtRef = useRef<LayerState | null>(tgtLayer)
  tgtRef.current = tgtLayer

  const layer0Ref = useRef<HTMLDivElement | null>(null)
  const layer1Ref = useRef<HTMLDivElement | null>(null)

  // rendered row window per layer (virtualization); kept in state so the DOM
  // only ever holds the visible rows (+ a small margin)
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
    // NOTE: rect.top/left are viewport coordinates and already account for the
    // window scroll. The validated prototype draws on a fixed (viewport) canvas,
    // so its math maps 1:1 once hostTop/hostLeft are used this way (adding
    // scrollY anywhere here would be wrong).
    const hostTop = rect.top
    const hostLeft = rect.left
    const visualTile = visualTileRef.current
    const fade = fadeRef.current
    const P = visualTile * (1 + GAP_RATIO)
    const vhpx = vh()
    // only anchor (pin the finger's photo) during a gesture; when idle the
    // layers are drawn naturally and the window scroll does the moving
    const anchoring = pinchingRef.current || settleRef.current

    const frontI = frontRef.current
    const slotList = slotsRef.current

    const setLayer = (
      layer: LayerState,
      el: HTMLDivElement | null
    ): number => {
      if (el == null) return 0
      if (!anchoring) {
        el.style.transform = 'none'
        return 0
      }
      const { columns, wrapOrigin } = layer
      const s = visualTile / tileForColumns(effWidth, columns, GAP_RATIO)
      const rowMin = rowMinFor(wrapOrigin, columns)
      const pRow = Math.floor((anchorPhotoRef.current - wrapOrigin) / columns)
      const pCol =
        ((((anchorPhotoRef.current - wrapOrigin) % columns) + columns) %
          columns)
      const panX = fingerXRef.current - hostLeft - pCol * P
      const panY = fingerYRef.current - hostTop - (pRow - rowMin) * P
      el.style.transform = `translate(${panX}px, ${panY}px) scale(${s})`
      return panY
    }

    const hasTarget = slotList[1 - frontI] != null
    const panYs: number[] = [0, 0]
    for (let i = 0; i < 2; i++) {
      const layer = slotList[i]
      const el = i === 0 ? layer0Ref.current : layer1Ref.current
      if (layer == null || el == null) continue
      panYs[i] = setLayer(layer, el)
      if (i === frontI) {
        el.style.opacity = hasTarget ? `${1 - fade}` : '1'
        el.style.pointerEvents = hasTarget && fade > 0.5 ? 'none' : 'auto'
      } else {
        el.style.opacity = `${fade}`
        el.style.pointerEvents = fade <= 0.5 ? 'none' : 'auto'
      }
    }

    // Virtualization: the rows of a layer that intersect the viewport. A row's
    // on-screen y is `hostTop + panY + s*rowOffset`, so solve that for 0..vhpx.
    const rangeFor = (
      layer: LayerState,
      panY: number
    ): readonly [number, number] => {
      const { columns, wrapOrigin } = layer
      const pitch = pitchForColumns(effWidth, columns, GAP_RATIO)
      const rowMin = rowMinFor(wrapOrigin, columns)
      const rowMax = rowMaxFor(
        wrapOrigin,
        columns,
        flatItemsRef.current.length
      )
      const s = anchoring
        ? visualTile / tileForColumns(effWidth, columns, GAP_RATIO)
        : 1
      return layerVisibleRows(
        hostTop,
        panY,
        s,
        pitch,
        rowMin,
        rowMax,
        vhpx,
        ROW_MARGIN
      )
    }

    const cur = rowsRef.current
    const srcNow = slotList[frontI]
    const tgtNow = slotList[1 - frontI]
    const sv =
      srcNow != null
        ? rangeFor(srcNow, panYs[frontI])
        : ([cur.s0, cur.s1] as const)
    const tv = tgtNow != null ? rangeFor(tgtNow, panYs[1 - frontI]) : null
    const ns0 = sv[0]
    const ns1 = sv[1]
    const nt0 = tv != null ? tv[0] : cur.t0
    const nt1 = tv != null ? tv[1] : cur.t1
    if (
      ns0 !== cur.s0 ||
      ns1 !== cur.s1 ||
      nt0 !== cur.t0 ||
      nt1 !== cur.t1
    ) {
      setRows({ s0: ns0, s1: ns1, t0: nt0, t1: nt1 })
    }

    // floating date from the topmost visible photo of the committed layer
    const cols = srcNow != null ? srcNow.columns : cur.s1
    const srcWrap = srcNow != null ? srcNow.wrapOrigin : 0
    const rowMinS = rowMinFor(srcWrap, cols)
    const pitchS = pitchForColumns(effWidth, cols, GAP_RATIO)
    const topRow = rowMinS + Math.floor(-hostTop / pitchS)
    const topPhoto = Math.max(
      0,
      Math.min(
        flatItemsRef.current.length - 1,
        srcWrap + topRow * cols
      )
    )
    const flatTop = flatItemsRef.current.length - 1 - topPhoto
    const group = groupForIndex(dateGroupsRef.current, Math.max(0, flatTop))
    const title = group?.title ?? null
    if (title !== floatingRef.current) {
      floatingRef.current = title
      setFloatingDate(title)
    }
  }, [effWidth])

  const applyRef = useRef(applyLayers)
  applyRef.current = applyLayers

  // When the layer layout changes (a zoom commits, or a transition starts) the
  // DOM is re-rendered with the new layout; apply the imperative transforms in
  // the same pre-paint frame. This is what makes the commit invisible: the
  // on-screen result is identical, so there is nothing to see.
  useLayoutEffect(() => {
    applyRef.current()
  }, [slots, front])

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
      const rect = hostRef.current?.getBoundingClientRect()
      const hostTop = rect?.top ?? 0
      const hostLeft = rect?.left ?? 0
      const { columns, wrapOrigin } = srcRef.current
      const pitch = pitchForColumns(effWidth, columns, GAP_RATIO)
      const rowMin = rowMinFor(wrapOrigin, columns)
      const r = rowMin + Math.floor((fy - hostTop) / pitch)
      const c = Math.floor((fx - hostLeft) / pitch)
      anchorPhotoRef.current = Math.max(
        0,
        Math.min(flatItemsRef.current.length - 1, wrapOrigin + r * columns + c)
      )
    },
    [effWidth]
  )

  const beginTransition = useCallback(
    (target: number) => {
      const hostLeft = hostRef.current?.getBoundingClientRect().left ?? 0
      const rel = (fingerXRef.current - hostLeft) / Math.max(1, effWidth)
      const col = Math.max(
        0,
        Math.min(target - 1, Math.round(rel * target - 0.5))
      )
      const layer: LayerState = {
        columns: target,
        wrapOrigin: anchorPhotoRef.current - col,
      }
      const ti: 0 | 1 = frontRef.current === 0 ? 1 : 0
      const next = slotsRef.current.slice() as [
        LayerState | null,
        LayerState | null
      ]
      next[ti] = layer
      slotsRef.current = next
      tgtRef.current = layer
      fadeRef.current = 0
      fadeTargetRef.current = 0
      setSlots(next)
    },
    [effWidth]
  )

  const commitLayer = useCallback((commit: boolean, layer: LayerState) => {
    const frontI = frontRef.current
    const idleI: 0 | 1 = frontI === 0 ? 1 : 0
    const next: [LayerState | null, LayerState | null] = [null, null]
    if (commit) {
      // the target lives in the idle slot: make that slot the committed one so
      // its DOM (and therefore the visible photos) is not re-created
      next[idleI] = layer
      frontRef.current = idleI
      srcRef.current = layer
      setFront(idleI)
    } else {
      // cancelled: keep the committed slot's DOM, drop the target
      next[frontI] = layer
    }
    slotsRef.current = next
    tgtRef.current = null
    setSlots(next)
  }, [])

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
        commitLayer(commit, layer)
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
          fingerYRef.current - hostTop - (pRow - rowMin) * pitch
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
        // Do NOT touch the layers here: React has not re-rendered the committed
        // layer to `layer` yet, and the target layer (still visible, transform
        // is viewport-pinned so the scroll fold does not move it) is exactly
        // what should stay on screen. The layout effect below swaps to the
        // committed layer before the next paint, so the commit is invisible.
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
      // drop any leftover target layer (the idle slot)
      const ti: 0 | 1 = frontRef.current === 0 ? 1 : 0
      if (slotsRef.current[ti] != null) {
        const next = slotsRef.current.slice() as [
          LayerState | null,
          LayerState | null
        ]
        next[ti] = null
        slotsRef.current = next
        setSlots(next)
      }
      tgtRef.current = null
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
    onColumnsChangeRef.current?.(srcLayer.columns)
  }, [srcLayer.columns])

  // stable tile callbacks so memoized tiles are not invalidated each render
  const onActivateRef = useRef(onItemActivate)
  onActivateRef.current = onItemActivate
  const onFavoriteRef = useRef(onItemFavorite)
  onFavoriteRef.current = onItemFavorite
  const activate = useCallback((media: MediaGalleryFields, index: number) => {
    onActivateRef.current(media as T, index)
  }, [])
  const favorite = useCallback((media: MediaGalleryFields, index: number) => {
    onFavoriteRef.current?.(media as T, index)
  }, [])

  const renderItem = useCallback(
    (media: T, sequenceIndex: number, baseSize: number) => {
      // the owner keeps its media in newest-first order, but the grid renders
      // oldest-first; convert so tapping opens the right photo
      const flatIndex = flatItemsRef.current.length - 1 - sequenceIndex
      return (
        <GridTile
          media={media}
          tileSize={baseSize}
          atlas={atlasMap.get(media.id)}
          active={activeId != null && media.id == activeId}
          canFavorite={onItemFavorite != null}
          index={flatIndex}
          onActivate={activate}
          onFavorite={favorite}
        />
      )
    },
    [atlasMap, activeId, onItemFavorite, activate, favorite]
  )

  return (
    <div ref={hostRef} style={{ touchAction: 'pan-y', position: 'relative' }}>
      <div ref={spacerRef} style={{ width: '100%' }} />
      {effWidth > 0 && (
        <>
          {slots[0] != null && (
            <ZoomLayer
              key="slot0"
              items={seq}
              columns={slots[0].columns}
              wrapOrigin={slots[0].wrapOrigin}
              width={effWidth}
              r0={front === 0 ? rows.s0 : rows.t0}
              r1={front === 0 ? rows.s1 : rows.t1}
              renderItem={renderItem}
              layerRef={layer0Ref}
            />
          )}
          {slots[1] != null && (
            <ZoomLayer
              key="slot1"
              items={seq}
              columns={slots[1].columns}
              wrapOrigin={slots[1].wrapOrigin}
              width={effWidth}
              r0={front === 1 ? rows.s0 : rows.t0}
              r1={front === 1 ? rows.s1 : rows.t1}
              renderItem={renderItem}
              layerRef={layer1Ref}
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
