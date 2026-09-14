import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ProtectedImage } from '../photoGallery/ProtectedMedia'
import { albumQuery_album_subAlbums } from '../../Pages/AlbumPage/__generated__/albumQuery'

interface AlbumBoxImageProps {
  src?: string
}

const AlbumBoxImage = ({ src, ...props }: AlbumBoxImageProps) => {
  const [loaded, setLoaded] = useState(false)

  let image = null
  if (src) {
    image = (
      <ProtectedImage
        className="object-cover object-center w-full h-full"
        {...props}
        onLoad={() => setLoaded(true)}
        src={src}
        lazyLoading
      />
    )
  }

  let placeholder = null
  if (!loaded) {
    placeholder = (
      <div className="bg-gray-100 dark:bg-[#191c1f] animate-pulse w-full h-full absolute top-0"></div>
    )
  }

  return (
    <div className="aspect-square w-full relative overflow-hidden rounded-xl">
      {image}
      {placeholder}
    </div>
  )
}

type AlbumBoxProps = {
  album?: albumQuery_album_subAlbums
  customLink?: string
}

export const AlbumBox = ({ album, customLink, ...props }: AlbumBoxProps) => {
  const wrapperClasses =
    'inline-block text-left text-gray-900 dark:text-gray-200 m-1.5 w-[calc(33.333%-12px)] xs:w-[calc(25%-12px)] md:w-[calc(20%-12px)] lg:w-[220px]'

  if (album) {
    return (
      <Link
        to={customLink || `/album/${album.id}`}
        className={`${wrapperClasses} group`}
        {...props}
      >
        <div className="relative rounded-xl overflow-hidden ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-blue-400/60 transition-shadow group-hover:shadow-lg">
          <AlbumBoxImage src={album.thumbnail?.thumbnail?.url} />
        </div>
        <p className="mt-1.5 px-0.5 text-sm font-medium truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
          {album.title}
        </p>
      </Link>
    )
  }

  return (
    <div className={wrapperClasses} {...props}>
      <AlbumBoxImage />
    </div>
  )
}
