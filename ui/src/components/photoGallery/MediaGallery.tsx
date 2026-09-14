import React, { useCallback, useContext } from 'react'
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
import MediaSidebar from '../sidebar/MediaSidebar/MediaSidebar'
import { SidebarContext } from '../sidebar/Sidebar'
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

  const { updateSidebar } = useContext(SidebarContext)

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

  const onItemSelect = useCallback(
    (item: MediaGalleryFields, index: number) => {
      dispatchMedia({ type: 'selectImage', index })
      updateSidebar(<MediaSidebar media={item} />)
    },
    [dispatchMedia, updateSidebar]
  )

  const activeMedia = activeIndex >= 0 ? media[activeIndex] : undefined

  return (
    <>
      <div data-testid="photo-gallery-wrapper">
        <PhotoGrid
          items={media}
          onItemActivate={onItemActivate}
          onItemFavorite={onItemFavorite}
          onItemSelect={onItemSelect}
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
