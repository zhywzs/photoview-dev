import React, { useEffect, useRef, useState } from 'react'
import { useLazyQuery } from '@apollo/client'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { SIDEBAR_MEDIA_QUERY } from '../../sidebar/MediaSidebar/MediaSidebar'
import {
  sidebarMediaQuery,
  sidebarMediaQueryVariables,
} from '../../sidebar/MediaSidebar/__generated__/sidebarMediaQuery'
import ExifDetails from '../../sidebar/MediaSidebar/MediaSidebarExif'
import { BreadcrumbList } from '../../album/AlbumTitle'

/** how far the sheet must be dragged down to dismiss (px) */
const SHEET_DISMISS_THRESHOLD = 90

type MediaInfoPanelProps = {
  open: boolean
  onClose(): void
  mediaId: string
}

/**
 * Media info panel for the presentation mode.
 *
 * Mobile: a bottom sheet with rounded corners that can be dragged down to
 * dismiss. Desktop: a right side drawer. Fetches its own data lazily and
 * only while open, and re-queries when the presented media changes so it
 * stays in sync while paging through the gallery.
 *
 * The inner component (with the query) only mounts while open, so no
 * Apollo context is needed when the panel is closed.
 */
const MediaInfoPanel = ({ open, onClose, mediaId }: MediaInfoPanelProps) => {
  if (!open) return null
  return <InfoPanelSheet onClose={onClose} mediaId={mediaId} />
}

type InfoPanelSheetProps = {
  onClose(): void
  mediaId: string
}

const InfoPanelSheet = ({ onClose, mediaId }: InfoPanelSheetProps) => {
  const { t } = useTranslation()
  const [loadMedia, { loading, data }] = useLazyQuery<
    sidebarMediaQuery,
    sidebarMediaQueryVariables
  >(SIDEBAR_MEDIA_QUERY)

  useEffect(() => {
    loadMedia({ variables: { id: mediaId } })
  }, [mediaId])

  // ---- drag down to dismiss (mobile sheet) ----
  const [dragY, setDragY] = useState(0)
  const dragStartRef = useRef<number | null>(null)

  const onGrabberTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length == 1) {
      dragStartRef.current = event.touches[0].clientY
    }
  }

  const onGrabberTouchMove = (event: React.TouchEvent) => {
    if (dragStartRef.current == null || event.touches.length != 1) return
    const dy = event.touches[0].clientY - dragStartRef.current
    setDragY(Math.max(0, dy))
  }

  const onGrabberTouchEnd = () => {
    if (dragStartRef.current == null) return
    dragStartRef.current = null
    if (dragY > SHEET_DISMISS_THRESHOLD) {
      setDragY(0)
      onClose()
    } else {
      setDragY(0)
    }
  }

  const media = data?.media

  return (
    <>
      {/* backdrop: tap to close */}
      <div
        className="fixed inset-0 z-[105] bg-black/45"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-label={t('present.info_panel', 'Media info')}
        className={`fixed z-[110] bg-white dark:bg-dark-bg2 shadow-2xl flex flex-col
          left-0 right-0 bottom-0 max-h-[78vh] rounded-t-2xl
          lg:top-0 lg:bottom-0 lg:left-auto lg:w-[400px] lg:max-h-none lg:rounded-none
          transition-transform duration-300 ease-out`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        {/* drag handle (mobile) */}
        <div
          className="shrink-0 pt-2 pb-1 lg:hidden cursor-grab touch-none"
          onTouchStart={onGrabberTouchStart}
          onTouchMove={onGrabberTouchMove}
          onTouchEnd={onGrabberTouchEnd}
        >
          <div className="mx-auto w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* header */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-dark-border">
          <h2 className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
            {media?.title ?? t('general.loading.default', 'Loading...')}
          </h2>
          <button
            aria-label={t('present.close_info', 'Close info panel')}
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-bg"
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* content */}
        <div className="overflow-y-auto overscroll-contain px-4 pb-8 text-gray-800 dark:text-gray-100">
          {loading && !media ? (
            <p className="py-6 text-sm text-gray-400">
              {t('general.loading.default', 'Loading...')}
            </p>
          ) : media ? (
            <>
              <ExifDetails media={media} />

              {media.album && (
                <div className="mt-4 mb-2">
                  <h3 className="uppercase text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    {t('sidebar.media.album_path', 'Album path')}
                  </h3>
                  <BreadcrumbList hideLastArrow>
                    {[...(media.album.path ?? []), media.album]
                      .filter(album => album != null)
                      .map(album => (
                        <li
                          key={album.id}
                          className="inline-block hover:underline"
                        >
                          <Link
                            className="text-blue-700 dark:text-blue-300"
                            to={`/album/${album.id}`}
                            onClick={onClose}
                          >
                            {album.title}
                          </Link>
                        </li>
                      ))}
                  </BreadcrumbList>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  )
}

export default MediaInfoPanel
