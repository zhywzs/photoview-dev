import React, { useState } from 'react'
import { gql, useQuery, useMutation } from '@apollo/client'
import { useTranslation } from 'react-i18next'
import { SectionTitle, InputLabelDescription } from './SettingsPage'
import { myTrash, myTrash_myTrash } from './__generated__/myTrash'
import { Button } from '../../primitives/form/Input'

const MY_TRASH_QUERY = gql`
  query myTrash {
    myTrash {
      id
      title
      thumbnailUrl
      originalAlbumPath
      deletedAt
      daysRemaining
      fileSize
    }
  }
`

const RESTORE_MUTATION = gql`
  mutation restoreFromTrash($mediaId: ID!) {
    restoreMedia(mediaId: $mediaId)
  }
`

const PERMANENT_DELETE_MUTATION = gql`
  mutation permanentDelete($mediaId: ID!) {
    permanentlyDeleteMedia(mediaId: $mediaId)
  }
`

const EMPTY_TRASH_MUTATION = gql`
  mutation emptyTrash {
    emptyTrash
  }
`

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const TrashSection = () => {
  const { t } = useTranslation()
  const { data, loading, refetch } = useQuery<myTrash>(MY_TRASH_QUERY)
  const [restoreMedia] = useMutation(RESTORE_MUTATION)
  const [permanentDelete] = useMutation(PERMANENT_DELETE_MUTATION)
  const [emptyTrash, { loading: emptying }] = useMutation(EMPTY_TRASH_MUTATION)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const trashed = data?.myTrash ?? []

  const handleRestore = (id: string) => {
    restoreMedia({ variables: { mediaId: id } }).then(() => refetch())
  }

  const handlePermanentDelete = (id: string) => {
    permanentDelete({ variables: { mediaId: id } }).then(() => refetch())
  }

  const handleEmptyTrash = () => {
    setConfirmEmpty(false)
    emptyTrash().then(() => refetch())
  }

  return (
    <div>
      <SectionTitle nospace>
        {t('settings.trash.title', '回收站')}
      </SectionTitle>
      <InputLabelDescription>
        {t(
          'settings.trash.description',
          '已删除的媒体保留 30 天,过期后自动永久删除'
        )}
      </InputLabelDescription>

      {loading ? (
        <p className="text-sm text-gray-400 py-4">
          {t('general.loading.default', 'Loading...')}
        </p>
      ) : trashed.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">
          {t('settings.trash.empty', '回收站为空')}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">
              {t('settings.trash.count', { count: trashed.length, defaultValue: `${trashed.length} 项` })}
            </span>
            <Button onClick={() => setConfirmEmpty(true)} disabled={emptying}>
              {emptying
                ? t('settings.trash.emptying', '清空中…')
                : t('settings.trash.empty_button', '清空回收站')}
            </Button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
            {trashed.map((item) => (
              <TrashItem
                key={item.id}
                item={item}
                onRestore={() => handleRestore(item.id)}
                onDelete={() => handlePermanentDelete(item.id)}
              />
            ))}
          </div>
        </>
      )}

      {confirmEmpty && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setConfirmEmpty(false)}
          />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-dark-bg2 rounded-2xl shadow-2xl p-6 w-72">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t('settings.trash.confirm_empty', '清空回收站?')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('settings.trash.confirm_empty_desc', '所有文件将被永久删除,无法恢复')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-bg"
                onClick={() => setConfirmEmpty(false)}
              >
                {t('general.cancel', '取消')}
              </button>
              <button
                className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700 text-white"
                onClick={handleEmptyTrash}
              >
                {t('settings.trash.confirm', '确认清空')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

type TrashItemProps = {
  item: myTrash_myTrash
  onRestore(): void
  onDelete(): void
}

const TrashItem = ({ item, onRestore, onDelete }: TrashItemProps) => {
  const { t } = useTranslation()

  return (
    <div className="relative group rounded-lg overflow-hidden bg-gray-100 dark:bg-dark-bg">
      <div className="aspect-square">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            className="w-full h-full object-cover opacity-60"
            crossOrigin="use-credentials"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
            {t('settings.trash.no_preview', '无预览')}
          </div>
        )}
      </div>
      <div className="absolute inset-0 flex flex-col justify-between p-1.5 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white truncate" title={item.title}>
          {item.title}
        </p>
        <p className="text-[10px] text-white/70">
          {item.daysRemaining}
          {t('settings.trash.days_left', '天')}
        </p>
        <div className="flex gap-1">
          <button
            className="flex-1 text-[10px] py-1 rounded bg-green-600/80 hover:bg-green-600 text-white"
            onClick={onRestore}
          >
            {t('settings.trash.restore', '恢复')}
          </button>
          <button
            className="flex-1 text-[10px] py-1 rounded bg-red-600/80 hover:bg-red-600 text-white"
            onClick={onDelete}
          >
            {t('settings.trash.delete', '删除')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TrashSection
