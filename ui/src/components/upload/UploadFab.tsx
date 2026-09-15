import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type UploadFabProps = {
  onUploaded(): void
}

type Destination = {
  albumId: string | null
  autoFavorite: boolean
  pathLabel: string
}

/**
 * Floating action button for uploading photos/videos.
 *
 * Shows in the bottom-right corner (above the bottom nav on mobile),
 * hides when the user scrolls down and reappears when scrolling up.
 *
 * The upload destination depends on the current page:
 *  - /timeline, /favorites, /people → auto-archive by date ({root}/{YYYY}/{MM}/)
 *  - /album/:id → upload to that album's directory
 *  - /favorites → also auto-favorites the uploaded media
 *
 * A hidden <input type="file"> is triggered on tap; after selecting files
 * a confirmation dialog shows the destination path before uploading.
 */
const UploadFab = ({ onUploaded }: UploadFabProps) => {
  const { t } = useTranslation()
  const location = useLocation()
  const [visible, setVisible] = useState(true)
  const [dest, setDest] = useState<Destination | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingFilesRef = useRef<File[] | null>(null)
  const lastScrollY = useRef(0)

  // ---- scroll visibility ----
  useEffect(() => {
    const onScroll = () => {
      const currentY = window.scrollY
      const delta = currentY - lastScrollY.current
      lastScrollY.current = currentY

      if (delta > 4 && currentY > 60) {
        setVisible(false)
      } else if (delta < -4) {
        setVisible(true)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ---- destination from current route ----
  const computeDestination = useCallback((): Destination => {
    const path = location.pathname
    if (path.startsWith('/album/')) {
      const albumId = path.split('/')[2]
      return { albumId, autoFavorite: false, pathLabel: t('upload.current_album', '当前相册') }
    }
    if (path.startsWith('/favorites')) {
      return { albumId: null, autoFavorite: true, pathLabel: t('upload.auto_archive_fav', '按日期归档 + 自动收藏') }
    }
    // timeline, people, and everything else
    return { albumId: null, autoFavorite: false, pathLabel: t('upload.auto_archive', '按日期自动归档') }
  }, [location.pathname, t])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Copy files to a plain array BEFORE resetting the input:
      // e.target.files is a live FileList tied to the DOM element -
      // setting value = '' below would clear it and leave
      // pendingFilesRef pointing at an empty list.
      pendingFilesRef.current = Array.from(e.target.files)
      setDest(computeDestination())
      setShowConfirm(true)
    }
    e.target.value = '' // reset so the same file can be re-selected
  }

  const doUpload = async () => {
    setShowConfirm(false)
    const files = pendingFilesRef.current
    if (!files || files.length === 0) return

    setUploading(true)
    setUploadResult(null)

    let success = 0
    let fail = 0

    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      if (dest?.albumId) formData.append('albumId', dest.albumId)
      if (dest?.autoFavorite) formData.append('autoFavorite', 'true')

      try {
        const resp = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        })
        if (resp.ok) {
          success++
        } else {
          fail++
        }
      } catch {
        fail++
      }
    }

    setUploading(false)
    pendingFilesRef.current = null

    if (fail === 0) {
      setUploadResult(t('upload.success', { count: success, defaultValue: `成功上传 ${success} 张` }))
    } else {
      setUploadResult(t('upload.partial', { success, fail, defaultValue: `成功 ${success},失败 ${fail}` }))
    }

    // auto-dismiss after 3s
    setTimeout(() => setUploadResult(null), 3000)

    if (success > 0) {
      onUploaded()
    }
  }

  return (
    <>
      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={onFileChange}
        aria-label={t('upload.select_files', '选择要上传的图片/视频')}
      />

      {/* floating action button */}
      <button
        aria-label={t('upload.button', '上传图片')}
        className={`fixed right-4 z-30 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-lg flex items-center justify-center transition-all duration-300 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'
        } ${uploading ? 'animate-pulse' : ''}`}
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* result toast */}
      {uploadResult && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full text-sm font-medium text-white shadow-lg transition-all ${
            uploadResult.includes('失败') ? 'bg-red-600' : 'bg-green-600'
          }`}
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 160px)' }}
        >
          {uploadResult}
        </div>
      )}

      {/* confirmation dialog */}
      {showConfirm && dest && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setShowConfirm(false)}
          />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-dark-bg2 rounded-2xl shadow-2xl p-6 w-80 max-w-[90vw]">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t('upload.confirm_title', '确认上传')}
            </h3>
            <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2 mb-4">
              <p>
                {pendingFilesRef.current?.length ?? 0}{' '}
                {t('upload.files_selected', '个文件')}
              </p>
              <p>
                {t('upload.destination', '目标位置')}:{' '}
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {dest.pathLabel}
                </span>
              </p>
              {dest.autoFavorite && (
                <p className="text-blue-600 dark:text-blue-400">
                  {t('upload.will_favorite', '上传后自动添加到收藏')}
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-bg"
                onClick={() => setShowConfirm(false)}
              >
                {t('general.cancel', '取消')}
              </button>
              <button
                className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white"
                onClick={doUpload}
              >
                {t('upload.confirm', '上传')}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default UploadFab
