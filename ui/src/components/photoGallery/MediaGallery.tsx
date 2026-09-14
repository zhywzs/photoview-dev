import React, { useCallback } from 'react'
import { gql } from '@apollo/client'
import PhotoGrid from '../photoGrid/PhotoGrid'
import PresentView from './presentView/PresentView'
import {
  openPresentModeAction,
  PhotoGalleryAction,
  MediaGalleryState,
} from './mediaGalleryReducer'
import {
  toggleFavoriteAction,
  useMarkFavoriteMutation,
} from './photoGalleryMutations'
import { MediaGalleryFields } from './__generated__/MediaGalleryFields'

export const MEDIA_GALLERY_FRAGMENT = gql`
  fragment MediaGalleryFields on Media {
    id
    type
    title
    blurhash
    thumbnail {
      url
      width
      height
    }
    thumbnailSmall {
      url
      width
      height
    }
    thumbnailTiny {
      url
      width
      height
    }
    highRes {
      url
    }
    videoWeb {
      url
    }
    favorite
  }
`

type MediaGalleryProps = {
  loading: boolean
  mediaState: MediaGalleryState
  dispatchMedia: React.Dispatch<PhotoGalleryAction>
}

const MediaGallery = ({ mediaState, dispatchMedia }: MediaGalleryProps) => {
  const [markFavorite] = useMarkFavoriteMutation()

  const { media, activeIndex, presenting } = mediaState

  const onItemActivate = useCallback(
    (item: MediaGalleryFields, index: number) => {
      openPresentModeAction({ dispatchMedia, activeIndex: index })
    },
    [dispatchMedia]
  )

  const onItemFavorite = useCallback(
    (item: MediaGalleryFields) => {
      toggleFavoriteAction({ media: item, markFavorite })
    },
    [markFavorite]
  )

  const activeMedia = activeIndex >= 0 ? media[activeIndex] : undefined

  return (
    <>
      <div data-testid="photo-gallery-wrapper">
        <PhotoGrid
          items={media}
          onItemActivate={onItemActivate}
          onItemFavorite={onItemFavorite}
          activeId={activeMedia?.id}
        />
      </div>
      {presenting && activeMedia != null && (
        <PresentView
          activeMedia={activeMedia}
          dispatchMedia={dispatchMedia}
          favorite={activeMedia.favorite}
          onToggleFavorite={() => {
            toggleFavoriteAction({ media: activeMedia, markFavorite })
          }}
          mediaList={media}
          activeIndex={activeIndex}
          onSelectIndex={index => dispatchMedia({ type: 'selectImage', index })}
        />
      )}
    </>
  )
}

export default MediaGallery
