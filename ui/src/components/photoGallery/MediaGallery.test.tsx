import { render, screen } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'

import React from 'react'
import { MediaType } from '../../__generated__/globalTypes'
import MediaGallery from './MediaGallery'
import { MediaGalleryState } from './mediaGalleryReducer'

vi.mock('./photoGalleryMutations', () => ({
  useMarkFavoriteMutation: () => [vi.fn()],
}))

test('photo gallery with media', () => {
  const dispatchMedia = vi.fn()

  const mediaState: MediaGalleryState = {
    activeIndex: 0,
    media: [
      {
        id: '165',
        title: 'test media',
        type: MediaType.Photo,
        thumbnailSmall: null,
        thumbnailTiny: null,
        thumbnail: {
          url: '/photo/thumbnail_3666760020_jpg_x76GG5pS.jpg',
          width: 768,
          height: 1024,
          __typename: 'MediaURL',
        },
        highRes: null,
        videoWeb: null,
        blurhash: null,
        favorite: false,
        __typename: 'Media',
      },
      {
        id: '122',
        title: 'test media',
        type: MediaType.Photo,
        thumbnailSmall: null,
        thumbnailTiny: null,
        thumbnail: null,
        highRes: null,
        videoWeb: null,
        blurhash: null,
        favorite: false,
        __typename: 'Media',
      },
      {
        id: '98',
        title: 'test media',
        type: MediaType.Video,
        thumbnailSmall: null,
        thumbnailTiny: null,
        thumbnail: null,
        highRes: null,
        videoWeb: null,
        blurhash: null,
        favorite: false,
        __typename: 'Media',
      },
    ],
    presenting: false,
  }

  render(
    <MockedProvider mocks={[]}>
      <MediaGallery
        dispatchMedia={dispatchMedia}
        mediaState={mediaState}
        loading={false}
      />
    </MockedProvider>
  )

  expect(
    screen.getByTestId('photo-gallery-wrapper').querySelectorAll('img')
  ).toHaveLength(3)
})

describe('photo gallery presenting', () => {
  const dispatchMedia = vi.fn()

  test('not presenting', () => {
    const mediaStateNoPresent: MediaGalleryState = {
      activeIndex: -1,
      media: [],
      presenting: false,
    }

    render(
      <MockedProvider mocks={[]}>
        <MediaGallery
          dispatchMedia={dispatchMedia}
          loading={false}
          mediaState={mediaStateNoPresent}
        />
      </MockedProvider>
    )

    expect(screen.queryByTestId('present-overlay')).not.toBeInTheDocument()
  })

  test('presenting', () => {
    const mediaStatePresent: MediaGalleryState = {
      activeIndex: 0,
      media: [
        {
          id: '165',
          title: 'test media',
          type: MediaType.Photo,
          thumbnailSmall: null,
          thumbnailTiny: null,
          thumbnail: {
            url: '/photo/thumbnail_3666760020_jpg_x76GG5pS.jpg',
            width: 768,
            height: 1024,
            __typename: 'MediaURL',
          },
          highRes: null,
          videoWeb: null,
          blurhash: null,
          favorite: false,
          __typename: 'Media',
        },
      ],
      presenting: true,
    }

    render(
      <MockedProvider mocks={[]}>
        <MediaGallery
          dispatchMedia={dispatchMedia}
          loading={false}
          mediaState={mediaStatePresent}
        />
      </MockedProvider>
    )

    expect(screen.getByTestId('present-overlay')).toBeInTheDocument()
  })
})
