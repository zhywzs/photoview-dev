import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import styled from 'styled-components'
import PresentMedia from './PresentMedia'
import PresentControls from './PresentControls'
import MediaInfoPanel from './MediaInfoPanel'
import {
  closePresentModeAction,
  GalleryAction,
} from '../mediaGalleryReducer'
import { MediaGalleryFields } from '../__generated__/MediaGalleryFields'

const StyledContainer = styled.div`
  position: fixed;
  width: 100vw;
  height: 100vh;
  background-color: black;
  color: white;
  top: 0;
  left: 0;
  z-index: 100;
  overscroll-behavior: none;
`

/** vertical drag distance that closes the viewer */
const CLOSE_DRAG_THRESHOLD = 100
/** horizontal drag distance (or fling) that turns the page */
const PAGE_DRAG_RATIO = 0.3
const PAGE_FLING_VELOCITY = 0.5 // px per ms
const PAGE_ANIMATION_MS = 240
const CLOSE_ANIMATION_MS = 260
const SPRING_BACK_MS = 200
const CONTROLS_AUTOHIDE_MS = 2500
/**
 * Neighbor previews (thumbnail only) mount this long after the viewer
 * opens so the current photo's high-res load is not contested.
 */
const NEIGHBOR_PRELOAD_DELAY_MS = 400

type PresentViewProps = {
  className?: string
  imageLoaded?(): void
  activeMedia: MediaGalleryFields
  dispatchMedia: React.Dispatch<GalleryAction>
  disableSaveCloseInHistory?: boolean
  favorite?: boolean
  onToggleFavorite?(): void
  /** full media list; enables neighbor previews while paging */
  mediaList?: MediaGalleryFields[]
  /** index of activeMedia inside mediaList */
  activeIndex?: number
  /** page to an absolute index (used when mediaList is provided) */
  onSelectIndex?(index: number): void
}

/**
 * Full screen presentation mode.
 *
 * Gestures
 * --------
 *  - swipe left / right: the media track follows the finger; releasing
 *    past a third of the screen (or with a fling) completes the page turn
 *    with the neighbor already visible under the finger, otherwise it
 *    springs back. At the ends of the list the drag rubber-bands.
 *  - drag down: the media follows the finger downward, shrinking, while
 *    the viewer fades to reveal the grid behind it; releasing past the
 *    threshold closes the viewer with a fall animation, otherwise it
 *    springs back.
 *  - tap: toggles the controls; Escape closes the info panel first, then
 *    the viewer.
 *
 * Loading strategy
 * ----------------
 * Only the center slide loads its full media (thumbnail + high-res).
 * The neighbors mount as lightweight thumbnail previews after a short
 * delay (or as soon as a horizontal gesture starts), so paging stays
 * fluid on slow networks. On page commit the slides are keyed by media
 * id, which lets React move the already-rendered DOM node into the
 * center slot instead of re-loading the image.
 */
const PresentView = ({
  className,
  imageLoaded,
  activeMedia,
  dispatchMedia,
  disableSaveCloseInHistory,
  favorite,
  onToggleFavorite,
  mediaList,
  activeIndex,
  onSelectIndex,
}: PresentViewProps) => {
  // ---- paging / closing state ----
  const [pageOffset, setPageOffset] = useState(0)
  const [pageAnimating, setPageAnimating] = useState(false)
  const [closeDrag, setCloseDrag] = useState(0)
  const [closeAnimating, setCloseAnimating] = useState(false)
  const [closing, setClosing] = useState(false)
  const busyRef = useRef(false)

  // ---- info panel ----
  const [infoOpen, setInfoOpen] = useState(false)

  // ---- neighbor previews (lazy) ----
  const [neighborsReady, setNeighborsReady] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(
      () => setNeighborsReady(true),
      NEIGHBOR_PRELOAD_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [])

  // ---- controls visibility ----
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimerRef = useRef<number | undefined>(undefined)

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(
      () => setControlsVisible(false),
      CONTROLS_AUTOHIDE_MS
    )
  }, [])

  useEffect(() => {
    showControls()
    return () => {
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current)
    }
  }, [activeMedia.id, showControls])

  const closingRef = useRef(closing)
  closingRef.current = closing

  const closeViewer = useCallback(() => {
    if (closingRef.current) return
    setClosing(true)
    window.setTimeout(() => {
      if (disableSaveCloseInHistory === true) {
        dispatchMedia({ type: 'closePresentMode' })
      } else {
        closePresentModeAction({ dispatchMedia })
      }
    }, CLOSE_ANIMATION_MS)
  }, [dispatchMedia, disableSaveCloseInHistory])

  // ---- neighbors ----
  const hasList = mediaList != null && activeIndex != null && activeIndex >= 0
  const prevMedia =
    hasList && mediaList != null && activeIndex != null && activeIndex > 0
      ? mediaList[activeIndex - 1]
      : null
  const nextMedia =
    hasList && mediaList != null && activeIndex != null
      ? activeIndex < mediaList.length - 1
        ? mediaList[activeIndex + 1]
        : null
      : null

  const page = (direction: 1 | -1) => {
    if (busyRef.current || closingRef.current) return

    const neighbor = direction > 0 ? nextMedia : prevMedia
    if (hasList && neighbor == null) return // at the end of the list

    busyRef.current = true
    setPageAnimating(true)
    setPageOffset(-direction * window.innerWidth)

    window.setTimeout(() => {
      if (mediaList != null && activeIndex != null && onSelectIndex != null) {
        onSelectIndex(activeIndex + direction)
      } else {
        dispatchMedia({ type: direction > 0 ? 'nextImage' : 'previousImage' })
      }
      // reset instantly (no transition) - the keyed slide of the former
      // neighbor moves into the center slot, which is exactly where the
      // animation ended, so nothing visibly jumps
      setPageAnimating(false)
      setPageOffset(0)
      busyRef.current = false
    }, PAGE_ANIMATION_MS)
  }

  const pageRef = useRef(page)
  pageRef.current = page
  const goToPrev = useCallback(() => pageRef.current(-1), [])
  const goToNext = useCallback(() => pageRef.current(1), [])
  const toggleInfo = useCallback(() => {
    setInfoOpen(open => !open)
    showControls()
  }, [showControls])

  // ---- keyboard ----
  useEffect(() => {
    const keyDownEvent = (e: KeyboardEvent) => {
      if (e.key == 'ArrowRight') {
        e.stopPropagation()
        goToNext()
      } else if (e.key == 'ArrowLeft') {
        e.stopPropagation()
        goToPrev()
      } else if (e.key == 'Escape') {
        e.stopPropagation()
        if (infoOpen) {
          setInfoOpen(false)
        } else {
          closeViewer()
        }
      }
    }

    document.addEventListener('keydown', keyDownEvent)
    return () => document.removeEventListener('keydown', keyDownEvent)
  })

  // ---- touch gestures: axis-locked paging + drag down to close ----
  const stageRef = useRef<HTMLDivElement | null>(null)

  // stable refs for the once-registered gesture listeners
  const closeViewerRef = useRef(closeViewer)
  closeViewerRef.current = closeViewer
  const edgesRef = useRef({
    hasList,
    hasPrev: prevMedia != null,
    hasNext: nextMedia != null,
  })
  edgesRef.current = {
    hasList,
    hasPrev: prevMedia != null,
    hasNext: nextMedia != null,
  }

  useEffect(() => {
    const elem = stageRef.current
    if (elem == null) return

    let start: { x: number; y: number; time: number } | null = null
    let axis: 'none' | 'horizontal' | 'vertical' = 'none'

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length != 1 || busyRef.current || closingRef.current)
        return
      const touch = event.touches[0]
      start = { x: touch.clientX, y: touch.clientY, time: Date.now() }
      axis = 'none'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (start == null || event.touches.length != 1) return
      const touch = event.touches[0]
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y

      if (axis == 'none' && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
        if (axis == 'horizontal') {
          // mount the neighbor previews right away for this gesture
          setNeighborsReady(true)
        }
      }

      if (axis == 'horizontal') {
        event.preventDefault()
        // rubber-band at the ends of the list
        const edges = edgesRef.current
        const beyondStart = dx > 0 && !edges.hasPrev && edges.hasList
        const beyondEnd = dx < 0 && !edges.hasNext && edges.hasList
        setPageOffset(beyondStart || beyondEnd ? dx * 0.25 : dx)
      } else if (axis == 'vertical') {
        event.preventDefault()
        setCloseDrag(Math.max(0, dy))
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (start == null) return
      const touch = event.changedTouches[0]
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      const dt = Math.max(1, Date.now() - start.time)
      start = null

      if (axis == 'horizontal') {
        axis = 'none'
        const velocity = dx / dt
        const distance = Math.abs(dx)
        if (
          distance > window.innerWidth * PAGE_DRAG_RATIO ||
          Math.abs(velocity) > PAGE_FLING_VELOCITY
        ) {
          pageRef.current(dx < 0 ? 1 : -1)
        } else if (dx != 0) {
          // spring back
          setPageAnimating(true)
          setPageOffset(0)
          window.setTimeout(() => setPageAnimating(false), PAGE_ANIMATION_MS)
        }
        return
      }

      if (axis == 'vertical') {
        axis = 'none'
        const velocity = dy / dt
        if (dy > CLOSE_DRAG_THRESHOLD || velocity > 1) {
          closeViewerRef.current()
        } else {
          // spring back with an animation instead of snapping
          setCloseAnimating(true)
          setCloseDrag(0)
          window.setTimeout(() => setCloseAnimating(false), SPRING_BACK_MS)
        }
        return
      }

      // no gesture: tap toggles the controls
      if (Math.hypot(dx, dy) < 8) {
        setControlsVisible(visible => {
          const next = !visible
          if (hideTimerRef.current != null)
            window.clearTimeout(hideTimerRef.current)
          if (next) {
            hideTimerRef.current = window.setTimeout(
              () => setControlsVisible(false),
              CONTROLS_AUTOHIDE_MS
            )
          }
          return next
        })
      }
    }

    elem.addEventListener('touchstart', onTouchStart, { passive: true })
    elem.addEventListener('touchmove', onTouchMove, { passive: false })
    elem.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => {
      elem.removeEventListener('touchstart', onTouchStart)
      elem.removeEventListener('touchmove', onTouchMove)
      elem.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // ---- derived styles (compositor-friendly: transform + opacity only) ----
  const closeProgress = Math.min(
    1,
    Math.max(0, closeDrag) / (window.innerHeight * 0.5)
  )

  // the viewer fades while dragging down, revealing the grid behind it
  const containerStyle: React.CSSProperties = closing
    ? { opacity: 0, transition: `opacity ${CLOSE_ANIMATION_MS}ms ease-in` }
    : closeAnimating
    ? { opacity: 1, transition: `opacity ${SPRING_BACK_MS}ms ease-out` }
    : closeDrag > 0
    ? { opacity: 1 - closeProgress * 0.85 }
    : {}

  // translate + scale only: no per-frame border radius or clipping,
  // which would force expensive repaints of the photo
  const stageStyle: React.CSSProperties = closing
    ? {
        transform: `translateY(${window.innerHeight * 0.6}px) scale(0.55)`,
        opacity: 0,
        transition: `transform ${CLOSE_ANIMATION_MS}ms ease-in, opacity ${CLOSE_ANIMATION_MS}ms ease-in`,
      }
    : closeAnimating
    ? {
        transform: 'translateY(0px) scale(1)',
        transition: `transform ${SPRING_BACK_MS}ms ease-out`,
      }
    : closeDrag > 0
    ? {
        transform: `translateY(${closeDrag * 0.55}px) scale(${1 - closeProgress * 0.25})`,
      }
    : {}

  const trackStyle: React.CSSProperties = {
    transform: `translateX(${pageOffset}px)`,
    transition: pageAnimating
      ? `transform ${PAGE_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
      : 'none',
    willChange: 'transform',
  }

  return (
    <StyledContainer
      className={className}
      data-testid="present-overlay"
      style={containerStyle}
    >
      {/* gesture stage */}
      <div
        ref={stageRef}
        style={{ position: 'absolute', inset: 0, zIndex: 2, ...stageStyle }}
      >
        <div style={{ position: 'absolute', inset: 0, ...trackStyle }}>
          {/* slides are keyed by media id (no position prefix!) so a page
              turn MOVES the already-rendered neighbor node into the center
              slot instead of unmounting/remounting it, which would reload
              the image and cause a flash */}
          {prevMedia != null && neighborsReady ? (
            <SlideView
              key={prevMedia.id}
              position="-100%"
              media={prevMedia}
              previewOnly
            />
          ) : (
            <SlideView key="prev-empty" position="-100%" media={null} />
          )}
          <SlideView
            key={activeMedia.id}
            position="0"
            media={activeMedia}
            imageLoaded={imageLoaded}
          />
          {nextMedia != null && neighborsReady ? (
            <SlideView
              key={nextMedia.id}
              position="100%"
              media={nextMedia}
              previewOnly
            />
          ) : (
            <SlideView key="next-empty" position="100%" media={null} />
          )}
        </div>
      </div>

      {/* controls */}
      <PresentControls
        visible={controlsVisible && !closing && closeDrag == 0}
        favorite={favorite}
        onToggleFavorite={onToggleFavorite}
        onToggleInfo={toggleInfo}
        infoOpen={infoOpen}
        onClose={closeViewer}
        onPrev={goToPrev}
        onNext={goToNext}
      />

      {/* media info panel (bottom sheet on mobile, drawer on desktop) */}
      <MediaInfoPanel
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        mediaId={activeMedia.id}
      />
    </StyledContainer>
  )
}

type SlideViewProps = {
  /** horizontal position of the slide inside the track, e.g. "-100%" */
  position: string
  media?: MediaGalleryFields | null
  imageLoaded?(): void
  /** lightweight preview (thumbnail only) for neighbor slides */
  previewOnly?: boolean
}

/** One page of the media track. Empty slides stay mounted as spacers. */
const SlideView = React.memo(({ position, media, imageLoaded, previewOnly }: SlideViewProps) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: '100%',
      left: position,
      visibility: media != null ? 'visible' : 'hidden',
    }}
  >
    {media != null && (
      <PresentMedia
        media={media}
        imageLoaded={imageLoaded}
        previewOnly={previewOnly}
      />
    )}
  </div>
))

export default PresentView
