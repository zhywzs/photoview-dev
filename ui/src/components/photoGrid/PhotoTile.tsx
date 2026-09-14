import React from 'react'
import classNames from 'classnames'
import { ProtectedImage } from '../photoGallery/ProtectedMedia'
import { MediaType } from '../../__generated__/globalTypes'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import { thumbSourceFor } from './gridLayout'

type PhotoTileProps = {
  media: MediaGalleryFields
  tileSize: number
  active?: boolean
  /** let the tile stretch to fill the row width (dense seamless mode) */
  fluidWidth?: boolean
  onClick?(): void
  onFavorite?(): void
  onSelect?(): void
}

/**
 * A single square tile of the photo grid.
 * Picks the thumbnail rendition matching the tile size and device pixel
 * ratio, shows badges for videos and favorites, and offers hover actions
 * (favorite / info) with comfortable touch targets on mobile.
 */
const PhotoTile = ({
  media,
  tileSize,
  active,
  fluidWidth,
  onClick,
  onFavorite,
  onSelect,
}: PhotoTileProps) => {
  const src = thumbSourceFor(tileSize, media)

  const radius = tileSize >= 150 ? 10 : tileSize >= 80 ? 6 : 2
  const showBlurhash = tileSize >= 160

  const isVideo = media.type == MediaType.Video

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
      onClick={onClick}
      role="button"
      aria-label={media.title ?? media.id}
    >
      <ProtectedImage
        className="w-full h-full object-cover"
        src={src}
        blurhash={showBlurhash ? media.blurhash : null}
        lazyLoading
      />

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

      {tileSize >= 110 && (
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity bg-black/0"
          onClick={e => e.stopPropagation()}
        >
          {onFavorite && (
            <button
              className={classNames(
                'absolute bottom-1.5 left-1.5 w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center',
                media.favorite && 'opacity-90'
              )}
              aria-label="Toggle favorite"
              onClick={onFavorite}
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
          )}
          {onSelect && (
            <button
              className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center"
              aria-label="Show media info"
              onClick={onSelect}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default PhotoTile
