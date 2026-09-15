import React, { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { gql, useMutation } from '@apollo/client'
import { useTranslation } from 'react-i18next'
import { ProtectedImage } from '../photoGallery/ProtectedMedia'
import { MediaType } from '../../__generated__/globalTypes'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import { AtlasTile } from './atlas'
import { thumbSourceFor } from './gridLayout'

const DELETE_MEDIA_MUTATION = gql`
  mutation deleteMediaFromTile($mediaId: ID!) {
    deleteMedia(mediaId: $mediaId)
  }
`

/** how long to hold before a long-press is registered (ms) */
const LONG_PRESS_MS = 500

/** hover actions render only on devices with a real mouse */
const canHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia == 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

type PhotoTileProps = {
  media: MediaGalleryFields
  tileSize: number
  active?: boolean
  /** let the tile stretch to fill the row width (dense seamless mode) */
  fluidWidth?: boolean
  /**
   * Sprite sheet placement of this photo. When present the tile renders
   * as a background-image slice of the atlas instead of an individual
   * image request (dense levels load a whole screen in a few requests).
   */
  atlas?: AtlasTile
  onClick?(): void
  onFavorite?(): void
}

/**
 * A single square tile of the photo grid.
 * Picks the thumbnail rendition matching the tile size and device pixel
 * ratio, shows badges for videos and favorites, and a hover favorite
 * action on pointer devices. Tapping always opens the viewer; media
 * info is shown in the viewer's own info panel.
 */
const PhotoTile = ({
  media,
  tileSize,
  active,
  fluidWidth,
  atlas,
  onClick,
  onFavorite,
}: PhotoTileProps) => {
  const src = thumbSourceFor(tileSize, media)
  const { t } = useTranslation()

  const radius = tileSize >= 150 ? 10 : tileSize >= 80 ? 6 : 2
  const showBlurhash = tileSize >= 160

  const isVideo = media.type == MediaType.Video

  // ---- long-press to delete (mobile) ----
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteMedia, { loading: deleteLoading }] = useMutation<{
    deleteMedia: boolean
  }>(DELETE_MEDIA_MUTATION)

  const longPressTimer = useRef<number | undefined>(undefined)
  const longPressTriggered = useRef(false)

  const startLongPress = useCallback(() => {
    longPressTriggered.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true
      setShowDeleteConfirm(true)
    }, LONG_PRESS_MS)
  }, [])

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = undefined
    }
  }, [])

  useEffect(() => {
    return () => cancelLongPress()
  }, [cancelLongPress])

  const handleClick = useCallback(() => {
    // suppress the click that follows a long-press
    if (longPressTriggered.current) {
      longPressTriggered.current = false
      return
    }
    onClick?.()
  }, [onClick])

  const confirmDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    deleteMedia({ variables: { mediaId: media.id } }).catch(() => {})
  }, [deleteMedia, media.id])

  return (
    <div
      className={classNames(
        'relative overflow-hidden bg-gray-200 dark:bg-[#1c2126] group',
        active && 'outline outline-4 outline-blue-500/70 -outline-offset-4'
      )}
      style={{
        width: fluidWidth ? undefined : tileSize,
        flex: fluidWidth ? `1 1 ${tileSize}px` : undefined,
        minWidth: fluidWidth ? 0 : undefined,
        height: tileSize,
        borderRadius: radius,
        cursor: 'pointer',
      }}
      onClick={handleClick}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onContextMenu={e => {
        // long-press on mobile triggers contextmenu; suppress it
        if (longPressTriggered.current) e.preventDefault()
      }}
      role="button"
      aria-label={media.title ?? media.id}
    >
      {atlas != null ? (
        /* atlas tile: a slice of the sprite sheet, scaled so one atlas
           tile exactly fills this tile */
        <div
          className="w-full h-full"
          style={{
            backgroundImage: `url("${atlas.url}")`,
            backgroundSize: `${atlas.gridSize * tileSize}px ${atlas.gridSize * tileSize}px`,
            backgroundPosition: `-${atlas.x * tileSize}px -${atlas.y * tileSize}px`,
            backgroundRepeat: 'no-repeat',
          }}
        />
      ) : (
        <ProtectedImage
          className="w-full h-full object-cover"
          src={src}
          blurhash={showBlurhash ? media.blurhash : null}
          lazyLoading
        />
      )}

      {isVideo && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            className="text-white/90 drop-shadow"
            style={{
              width: Math.max(14, tileSize * 0.28),
              height: Math.max(14, tileSize * 0.28),
            }}
            fill="currentColor"
          >
            <path d="M8,5.14 L19,12 L8,18.86 L8,5.14 Z" />
          </svg>
        </div>
      )}

      {media.favorite && (
        <div
          className="absolute top-0.5 right-0.5 text-white pointer-events-none drop-shadow"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{
              width: Math.max(10, tileSize * 0.16),
              height: Math.max(10, tileSize * 0.16),
            }}
          >
            <path d="M13.999086,1 C15.0573371,1 16.0710089,1.43342987 16.8190212,2.20112483 C17.5765039,2.97781012 18,4.03198704 18,5.13009709 C18,6.22820714 17.5765039,7.28238406 16.8188574,8.05923734 L9.49975689,15.5674041 L2.18065643,8.05923735 C1.39216493,7.2503776 0.999999992,6.18971057 1,5.13009711 C1.00000001,4.07048366 1.39216496,3.00981663 2.18065647,2.20095689 C2.95931483,1.40218431 3.97927681,1.00049878 5.00042783,1.00049878 C6.02157882,1.00049878 7.04154078,1.4021843 7.82019912,2.20095684 L9.4997569,3.92390079 L11.1794784,2.20078881 C11.9271637,1.43342987 12.9408349,1 13.999086,1 L13.999086,1 Z" />
          </svg>
        </div>
      )}

      {/* hover actions (favorite) - desktop with a fine pointer only.
          The overlay is pointer-events-none so taps always reach the tile
          and open the viewer; the button itself re-enables pointer
          events and stops propagation so it doesn't double-trigger.
          The old grid info button is gone: media info lives in the
          viewer's info panel now. */}
      {canHover && onFavorite && (
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pointer-events-none">
          <button
            className="pointer-events-auto absolute bottom-1.5 left-1.5 w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center"
            aria-label="Toggle favorite"
            onClick={e => {
              e.stopPropagation()
              onFavorite()
            }}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill={media.favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={media.favorite ? 0 : 2}
            >
              <path d="M13.999086,1 C15.0573371,1 16.0710089,1.43342987 16.8190212,2.20112483 C17.5765039,2.97781012 18,4.03198704 18,5.13009709 C18,6.22820714 17.5765039,7.28238406 16.8188574,8.05923734 L9.49975689,15.5674041 L2.18065643,8.05923735 C1.39216493,7.2503776 0.999999992,6.18971057 1,5.13009711 C1.00000001,4.07048366 1.39216496,3.00981663 2.18065647,2.20095689 C2.95931483,1.40218431 3.97927681,1.00049878 5.00042783,1.00049878 C6.02157882,1.00049878 7.04154078,1.4021843 7.82019912,2.20095684 L9.4997569,3.92390079 L11.1794784,2.20078881 C11.9271637,1.43342987 12.9408349,1 13.999086,1 L13.999086,1 Z" />
            </svg>
          </button>
        </div>
      )}

      {/* long-press delete confirmation (mobile) */}
      {showDeleteConfirm && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60"
            onClick={e => {
              e.stopPropagation()
              setShowDeleteConfirm(false)
            }}
          />
          <div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-dark-bg2 rounded-2xl shadow-2xl p-6 w-72 max-w-[90vw]"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t('tile.delete_title', '移入回收站?')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">
              {media.title}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('tile.delete_desc', '30 天内可在设置页恢复')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-bg"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t('general.cancel', '取消')}
              </button>
              <button
                className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                onClick={confirmDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? '...' : t('tile.delete_confirm', '删除')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default PhotoTile
