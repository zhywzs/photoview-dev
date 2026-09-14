import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { MediaType } from '../../../__generated__/globalTypes'
import { exhaustiveCheck } from '../../../helpers/utils'
import { ProtectedImage, ProtectedVideo } from '../ProtectedMedia'
import { MediaGalleryFields } from '../__generated__/MediaGalleryFields'

const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5

const MediaLayer = styled.div<{ transform: string; animating: boolean }>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  transform: ${props => props.transform};
  transform-origin: center center;
  transition: ${props =>
    props.animating ? 'transform 120ms linear' : 'none'};
  touch-action: none;
`

const StyledPhoto = styled(ProtectedImage)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  object-fit: contain;
  object-position: center;
`

const StyledVideo = styled(ProtectedVideo)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
`

type PresentMediaProps = {
  media: MediaGalleryFields
  imageLoaded?(): void
  /**
   * Render only the lightweight thumbnail (no high-res fetch, no video
   * element). Used for neighbor slides in the paging track so swiping
   * stays fluid on slow networks; the full media loads once the slide
   * becomes the center.
   */
  previewOnly?: boolean
}

/**
 * Media shown in presentation mode.
 *
 * Photos support pinch-to-zoom (1x to 5x), one finger panning while
 * zoomed, double tap to toggle zoom and wheel zoom on desktop.
 * While zoomed in, touch events no longer reach the swipe navigation
 * handler of the parent overlay.
 */
const PresentMedia = ({
  media,
  imageLoaded,
  previewOnly,
  ...otherProps
}: PresentMediaProps) => {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [animating, setAnimating] = useState(false)

  const layerRef = useRef<HTMLDivElement | null>(null)

  const stateRef = useRef({ scale, translate })
  stateRef.current = { scale, translate }

  // reset zoom when the media changes
  useEffect(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [media.id])

  const clampTranslate = useCallback((x: number, y: number, s: number) => {
    const maxX = ((s - 1) * window.innerWidth) / 2
    const maxY = ((s - 1) * window.innerHeight) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
  }, [])

  const applyZoomAt = useCallback(
    (nextScale: number, anchor: { x: number; y: number }) => {
      const { scale: s0, translate: t0 } = stateRef.current
      const clamped = Math.max(1, Math.min(MAX_SCALE, nextScale))

      // keep the content point under the anchor at the same position
      const contentX = (anchor.x - window.innerWidth / 2 - t0.x) / s0
      const contentY = (anchor.y - window.innerHeight / 2 - t0.y) / s0
      const tx = anchor.x - window.innerWidth / 2 - contentX * clamped
      const ty = anchor.y - window.innerHeight / 2 - contentY * clamped

      const next = clamped == 1 ? { x: 0, y: 0 } : clampTranslate(tx, ty, clamped)
      stateRef.current = { scale: clamped, translate: next }
      setScale(clamped)
      setTranslate(next)
    },
    [clampTranslate]
  )

  useEffect(() => {
    const elem = layerRef.current
    if (elem == null) return

    type PinchState = {
      baseDist: number
      baseScale: number
      startMid: { x: number; y: number }
      startTranslate: { x: number; y: number }
    } | null

    let pinch: PinchState = null
    let pan:
      | { lastX: number; lastY: number }
      | null = null
    let lastTap: { time: number; x: number; y: number } | null = null

    const touchDistance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      )
    const touchMid = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    })

    const isZoomed = () => stateRef.current.scale > 1.01

    const onTouchStart = (event: TouchEvent) => {
      if (isZoomed()) event.stopPropagation()

      if (event.touches.length == 2) {
        event.preventDefault()
        const { scale, translate } = stateRef.current
        pinch = {
          baseDist: touchDistance(event.touches),
          baseScale: scale,
          startMid: touchMid(event.touches),
          startTranslate: translate,
        }
        pan = null
        setAnimating(false)
      } else if (event.touches.length == 1 && isZoomed()) {
        event.preventDefault()
        pan = {
          lastX: event.touches[0].clientX,
          lastY: event.touches[0].clientY,
        }
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (isZoomed()) event.stopPropagation()

      if (pinch != null && event.touches.length >= 2) {
        event.preventDefault()
        const dist = touchDistance(event.touches)
        const mid = touchMid(event.touches)
        if (dist <= 0 || pinch.baseDist <= 0) return

        const ratio = dist / pinch.baseDist
        const nextScale = Math.max(
          1,
          Math.min(MAX_SCALE, pinch.baseScale * ratio)
        )

        // zoom around the pinch start midpoint
        const contentX =
          (pinch.startMid.x -
            window.innerWidth / 2 -
            pinch.startTranslate.x) /
          pinch.baseScale
        const contentY =
          (pinch.startMid.y -
            window.innerHeight / 2 -
            pinch.startTranslate.y) /
          pinch.baseScale
        const tx = mid.x - window.innerWidth / 2 - contentX * nextScale
        const ty = mid.y - window.innerHeight / 2 - contentY * nextScale

        const next =
          nextScale <= 1.01
            ? { x: 0, y: 0 }
            : clampTranslate(tx, ty, nextScale)
        stateRef.current = { scale: nextScale, translate: next }
        setScale(nextScale)
        setTranslate(next)
      } else if (pan != null && event.touches.length == 1) {
        event.preventDefault()
        const touch = event.touches[0]
        const dx = touch.clientX - pan.lastX
        const dy = touch.clientY - pan.lastY
        pan = { lastX: touch.clientX, lastY: touch.clientY }

        const { scale, translate } = stateRef.current
        const next = clampTranslate(
          translate.x + dx,
          translate.y + dy,
          scale
        )
        stateRef.current = { scale, translate: next }
        setTranslate(next)
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (isZoomed()) event.stopPropagation()

      if (event.touches.length < 2) pinch = null
      if (event.touches.length < 1) pan = null

      // double tap toggles zoom
      if (event.changedTouches.length == 1 && pinch == null) {
        const touch = event.changedTouches[0]
        const now = Date.now()

        if (
          lastTap != null &&
          now - lastTap.time < 320 &&
          Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 40
        ) {
          event.preventDefault()
          lastTap = null
          setAnimating(true)

          const current = stateRef.current.scale
          if (current > 1.01) {
            stateRef.current = { scale: 1, translate: { x: 0, y: 0 } }
            setScale(1)
            setTranslate({ x: 0, y: 0 })
          } else {
            applyZoomAt(DOUBLE_TAP_SCALE, {
              x: touch.clientX,
              y: touch.clientY,
            })
          }
        } else {
          lastTap = { time: now, x: touch.clientX, y: touch.clientY }
        }
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setAnimating(false)
      const factor = Math.exp(-event.deltaY * 0.0022)
      applyZoomAt(stateRef.current.scale * factor, {
        x: event.clientX,
        y: event.clientY,
      })
    }

    elem.addEventListener('touchstart', onTouchStart, { passive: false })
    elem.addEventListener('touchmove', onTouchMove, { passive: false })
    elem.addEventListener('touchend', onTouchEnd, { passive: false })
    elem.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      elem.removeEventListener('touchstart', onTouchStart)
      elem.removeEventListener('touchmove', onTouchMove)
      elem.removeEventListener('touchend', onTouchEnd)
      elem.removeEventListener('wheel', onWheel)
    }
  }, [applyZoomAt, clampTranslate])

  const transform = `translate(${translate.x}px, ${translate.y}px) scale(${scale})`

  switch (media.type) {
    case MediaType.Photo:
      return (
        <div {...otherProps}>
          <MediaLayer ref={layerRef} transform={transform} animating={animating}>
            <StyledPhoto
              key={`${media.id}-thumb`}
              src={media.thumbnail?.url}
              data-testid="present-img-thumbnail"
            />
            {!previewOnly && (
              <StyledPhoto
                key={`${media.id}-highres`}
                style={{ display: 'none' }}
                src={media.highRes?.url}
                data-testid="present-img-highres"
                onLoad={e => {
                  const elem = e.target as HTMLImageElement
                  elem.style.display = 'initial'
                  imageLoaded && imageLoaded()
                }}
              />
            )}
          </MediaLayer>
        </div>
      )
    case MediaType.Video:
      if (previewOnly) {
        // neighbor previews render the poster frame instead of mounting
        // a second video element
        return (
          <div {...otherProps}>
            <MediaLayer ref={layerRef} transform={transform} animating={animating}>
              <StyledPhoto
                key={`${media.id}-thumb`}
                src={media.thumbnail?.url}
                data-testid="present-img-thumbnail"
              />
            </MediaLayer>
          </div>
        )
      }
      return <StyledVideo media={media} data-testid="present-video" />
  }

  exhaustiveCheck(media.type)
}

export default PresentMedia
