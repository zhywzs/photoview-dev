import React from 'react'
import { gql, useQuery } from '@apollo/client'
import { useTranslation } from 'react-i18next'
import { SectionTitle, InputLabelDescription } from './SettingsPage'
import { storageStats, storageStats_storageStats } from './__generated__/storageStats'

const STORAGE_STATS_QUERY = gql`
  query storageStats {
    storageStats {
      totalBytes
      usedBytes
      freeBytes
      mediaCacheBytes
      averagePhotoSize
      estimatedRemainingPhotos
    }
  }
`

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const StorageSection = () => {
  const { t } = useTranslation()
  const { data, loading } = useQuery<storageStats>(STORAGE_STATS_QUERY)

  if (loading) {
    return (
      <div>
        <SectionTitle nospace>
          {t('settings.storage.title', '存储')}
        </SectionTitle>
        <p className="text-sm text-gray-400 py-4">
          {t('general.loading.default', 'Loading...')}
        </p>
      </div>
    )
  }

  const stats = data?.storageStats
  if (!stats) return null

  const usedPercent = stats.totalBytes > 0
    ? Math.round((stats.usedBytes / stats.totalBytes) * 100)
    : 0

  return (
    <div>
      <SectionTitle nospace>
        {t('settings.storage.title', '存储')}
      </SectionTitle>
      <InputLabelDescription>
        {t('settings.storage.description', '媒体存储文件系统的容量与剩余空间')}
      </InputLabelDescription>

      {/* capacity bar */}
      <div className="mb-4">
        <div className="w-full h-3 rounded-full bg-gray-200 dark:bg-dark-bg overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
          <span>{formatBytes(stats.usedBytes)} {t('settings.storage.used', '已用')}</span>
          <span>{formatBytes(stats.totalBytes)} {t('settings.storage.total', '总计')}</span>
        </div>
      </div>

      {/* stats */}
      <div className="space-y-1.5 text-sm">
        <p className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">
            {t('settings.storage.free', '剩余空间')}
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {formatBytes(stats.freeBytes)}
          </span>
        </p>
        <p className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">
            {t('settings.storage.cache', '缩略图缓存')}
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {formatBytes(stats.mediaCacheBytes)}
          </span>
        </p>
        <p className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">
            {t('settings.storage.avg_photo', '平均照片大小')}
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {formatBytes(stats.averagePhotoSize)}
          </span>
        </p>
        <p className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">
            {t('settings.storage.estimated', '约可再存放')}
          </span>
          <span className="font-medium text-blue-600 dark:text-blue-400">
            ~{stats.estimatedRemainingPhotos.toLocaleString()}{' '}
            {t('settings.storage.photos', '张照片')}
          </span>
        </p>
      </div>
    </div>
  )
}

export default StorageSection
