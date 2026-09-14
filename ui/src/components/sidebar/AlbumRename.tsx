import React, { useState } from 'react'
import { gql, useMutation } from '@apollo/client'
import { useTranslation } from 'react-i18next'
import { setAlbumTitle } from './__generated__/setAlbumTitle'

const SET_ALBUM_TITLE_MUTATION = gql`
  mutation setAlbumTitle($albumID: ID!, $title: String!) {
    setAlbumTitle(albumID: $albumID, title: $title) {
      id
      title
    }
  }
`

type SidebarAlbumRenameProps = {
  albumId: string
  albumTitle: string
}

export const SidebarAlbumRename = ({
  albumId,
  albumTitle,
}: SidebarAlbumRenameProps) => {
  const { t } = useTranslation()
  const [title, setTitle] = useState(albumTitle)
  const [saved, setSaved] = useState(false)

  const [renameAlbum, { loading, error }] = useMutation<setAlbumTitle>(
    SET_ALBUM_TITLE_MUTATION
  )

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed || trimmed == albumTitle) return

    renameAlbum({
      variables: {
        albumID: albumId,
        title: trimmed,
      },
      update: (cache, mutationResult) => {
        const album = mutationResult.data?.setAlbumTitle
        if (!album) return
        cache.modify({
          id: cache.identify({ __typename: 'Album', id: album.id }),
          fields: {
            title: () => album.title,
          },
        })
      },
    })
      .then(() => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      })
      .catch(() => undefined)
  }

  const inputClasses =
    'block w-full border rounded-md px-2 py-1 bg-white border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50 outline-none dark:bg-dark-input-bg dark:border-dark-input-border dark:text-dark-input-text'

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-1">
        {t('sidebar.album.rename', 'Rename album')}
      </h2>
      <div className="flex gap-1">
        <input
          type="text"
          className={inputClasses}
          value={title}
          aria-label={t('sidebar.album.rename', 'Rename album')}
          onChange={e => setTitle(e.target.value)}
          onKeyUp={e => {
            if (e.key == 'Enter') save()
          }}
          maxLength={128}
        />
        <button
          className="bg-blue-500 hover:bg-blue-600 text-white rounded-md px-3 py-1 text-sm disabled:opacity-50"
          onClick={save}
          disabled={loading || !title.trim() || title.trim() == albumTitle}
        >
          {loading
            ? t('sidebar.album.saving', 'Saving…')
            : saved
            ? t('sidebar.album.saved', 'Saved ✓')
            : t('sidebar.album.save', 'Save')}
        </button>
      </div>
      {error && (
        <p className="text-red-500 text-sm mt-1">{error.message}</p>
      )}
      <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
        {t(
          'sidebar.album.rename_hint',
          'Only changes the title in Photoview, the folder on disk is not renamed.'
        )}
      </p>
    </section>
  )
}

export default SidebarAlbumRename
