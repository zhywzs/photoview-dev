import React, { useState, useRef, useEffect } from 'react'
import styled from 'styled-components'
import { useLazyQuery, gql } from '@apollo/client'
import { debounce, DebouncedFn } from '../../helpers/utils'
import { ProtectedImage } from '../photoGallery/ProtectedMedia'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  searchQuery,
  searchQuery_search_albums,
  searchQuery_search_media,
  searchQuery_search_faceGroups,
} from './__generated__/searchQuery'
import classNames from 'classnames'

const SEARCH_QUERY = gql`
  query searchQuery($query: String!) {
    search(query: $query) {
      query
      albums {
        id
        title
        thumbnail {
          thumbnail {
            url
          }
        }
      }
      media {
        id
        title
        thumbnail {
          url
        }
        album {
          id
        }
      }
      faceGroups {
        id
        label
      }
    }
  }
`

const SearchWrapper = styled.div`
  width: 100%;
  max-width: 20rem;

  @media (min-width: 1024px) {
    position: relative;
  }
`

type SearchBarProps = {
  autoFocusMobile?: boolean
  onCloseMobile?(): void
}

const SearchBar = ({ autoFocusMobile, onCloseMobile }: SearchBarProps) => {
  const { t } = useTranslation()
  const [fetchSearches, fetchResult] = useLazyQuery<searchQuery>(SEARCH_QUERY)
  const [query, setQuery] = useState('')
  const [fetched, setFetched] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputEl = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocusMobile && inputEl.current) {
      inputEl.current.focus()
    }
  }, [autoFocusMobile])

  type QueryFn = (query: string) => void

  const debouncedFetch = useRef<null | DebouncedFn<QueryFn>>(null)
  useEffect(() => {
    debouncedFetch.current = debounce<QueryFn>(query => {
      fetchSearches({ variables: { query } })
      setFetched(true)
      setExpanded(true)
    }, 250)

    return () => {
      debouncedFetch.current?.cancel()
    }
  }, [])

  const fetchEvent = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.persist()

    setQuery(e.target.value)
    if (e.target.value.trim() != '' && debouncedFetch.current) {
      debouncedFetch.current(e.target.value.trim())
    } else {
      setFetched(false)
    }
  }

  const location = useLocation()
  useEffect(() => {
    setExpanded(false)
    setQuery('')
  }, [location])

  const [selectedItem, setSelectedItem] = useState<number | null>(null)

  const searchData = fetchResult.data
  let media = searchData?.search.media || []
  let albums = searchData?.search.albums || []
  let faceGroups = searchData?.search.faceGroups || []

  albums = albums.slice(0, 5)
  media = media.slice(0, 5)
  faceGroups = faceGroups.slice(0, 5)

  const selectedItemId =
    selectedItem !== null
      ? [...albums.map(x => x.id), ...media.map(x => x.id)][selectedItem]
      : null

  useEffect(() => {
    const elem = inputEl.current
    if (!elem) return

    const focusEvent = () => {
      setExpanded(true)
    }

    const blurEvent = () => {
      setExpanded(false)
    }

    elem.addEventListener('focus', focusEvent)
    elem.addEventListener('blur', blurEvent)

    return () => {
      elem.removeEventListener('focus', focusEvent)
      elem.removeEventListener('blur', blurEvent)
    }
  }, [inputEl])

  useEffect(() => {
    setSelectedItem(null)
  }, [searchData])

  useEffect(() => {
    const totalItems = albums.length + media.length

    const keydownEvent = (event: KeyboardEvent) => {
      if (!expanded) return

      if (event.key == 'ArrowDown') {
        event.preventDefault()
        setSelectedItem(i => (i === null ? 0 : Math.min(totalItems - 1, i + 1)))
      } else if (event.key == 'ArrowUp') {
        event.preventDefault()
        setSelectedItem(i => (i === null ? 0 : Math.max(0, i - 1)))
      } else if (event.key == 'Escape') {
        // setExpanded(false)
        inputEl.current?.blur()
      }
    }

    document.addEventListener('keydown', keydownEvent)

    return () => {
      document.removeEventListener('keydown', keydownEvent)
    }
  }, [searchData])

  let results = null
  if (query.trim().length > 0 && fetched) {
    results = (
      <SearchResults
        albums={albums}
        media={media}
        faceGroups={faceGroups}
        query={fetchResult.data?.search.query || ''}
        selectedItem={selectedItem}
        setSelectedItem={setSelectedItem}
        loading={fetchResult.loading}
        expanded={expanded}
      />
    )
  }

  return (
    <SearchWrapper style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
      <input
        ref={inputEl}
        autoComplete="off"
        aria-controls="search-results"
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          selectedItemId ? `search-item-${selectedItemId}` : ''
        }
        aria-expanded={expanded}
        className="w-full py-2 px-3 z-10 relative rounded-full bg-gray-100 dark:bg-dark-bg2 border border-transparent focus:bg-white focus:border-blue-400 outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50 dark:focus:bg-[#2a2f35]"
        type="search"
        placeholder={t('header.search.placeholder', 'Search')}
        onChange={fetchEvent}
        value={query}
      />
      {onCloseMobile && query == '' && (
        <button
          className="lg:hidden w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-300"
          aria-label={t('header.search.close', 'Close search')}
          onClick={onCloseMobile}
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
      )}
      {results}
    </SearchWrapper>
  )
}

const ResultTitle = styled.h1.attrs({
  className:
    'uppercase text-gray-700 dark:text-gray-200 text-sm font-semibold mt-4 mb-2 mx-1',
})``

type SearchResultsProps = {
  albums: searchQuery_search_albums[]
  media: searchQuery_search_media[]
  faceGroups: searchQuery_search_faceGroups[]
  loading: boolean
  selectedItem: number | null
  setSelectedItem: React.Dispatch<React.SetStateAction<number | null>>
  query: string
  expanded: boolean
}

const SearchResults = ({
  albums,
  media,
  faceGroups,
  loading,
  selectedItem,
  setSelectedItem,
  query,
  expanded,
}: SearchResultsProps) => {
  const { t } = useTranslation()

  const albumElements = albums.map((album, i) => (
    <AlbumRow
      key={album.id}
      query={query}
      album={album}
      selected={selectedItem == i}
      setSelected={() => setSelectedItem(i)}
    />
  ))

  const faceGroupElements = faceGroups.map((faceGroup, i) => (
    <FaceGroupRow
      key={faceGroup.id}
      faceGroup={faceGroup}
      selected={selectedItem == i + albumElements.length}
      setSelected={() => setSelectedItem(i + albumElements.length)}
    />
  ))

  const mediaStartIndex = albumElements.length + faceGroupElements.length

  const mediaElements = media.map((media, i) => (
    <PhotoRow
      key={media.id}
      query={query}
      media={media}
      selected={selectedItem == i + mediaStartIndex}
      setSelected={() => setSelectedItem(i + mediaStartIndex)}
    />
  ))

  let message = null
  if (loading) message = t('header.search.loading', 'Loading results...')
  else if (
    media.length == 0 &&
    albums.length == 0 &&
    faceGroups.length == 0
  )
    message = t('header.search.no_results', 'No results found')

  if (message) message = <div className="mt-8 text-center">{message}</div>

  return (
    <div
      id="search-results"
      role="listbox"
      className={classNames(
        'absolute bg-white dark:bg-dark-bg left-0 right-0 top-[72px] overflow-y-auto h-[calc(100vh-152px)] border dark:border-dark-border px-4 z-0',
        'lg:top-[40px] lg:shadow-md lg:rounded-b lg:max-h-[560px]',
        { hidden: !expanded }
      )}
      tabIndex={-1}
      onMouseDown={e => {
        // Prevent input blur event
        e.preventDefault()
      }}
    >
      {message}
      {albumElements.length > 0 && (
        <>
          <ResultTitle>
            {t('header.search.result_type.albums', 'Albums')}
          </ResultTitle>
          <ul aria-label="albums">{albumElements}</ul>
        </>
      )}
      {faceGroupElements.length > 0 && (
        <>
          <ResultTitle>
            {t('header.search.result_type.people', 'People')}
          </ResultTitle>
          <ul aria-label="faceGroups">{faceGroupElements}</ul>
        </>
      )}
      {mediaElements.length > 0 && (
        <>
          <ResultTitle>
            {t('header.search.result_type.media', 'Media')}
          </ResultTitle>
          <ul aria-label="media">{mediaElements}</ul>
        </>
      )}
      <div className="my-3 text-center">
        <Link
          to={`/search?query=${encodeURIComponent(query)}`}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t('header.search.view_all_results', 'View all results »')}
        </Link>
      </div>
    </div>
  )
}

type SearchRowProps = {
  id: string
  link: string
  preview: React.ReactNode
  label: React.ReactNode
  selected: boolean
  setSelected(): void
}

const SearchRow = ({
  id,
  link,
  preview,
  label,
  selected,
  setSelected,
}: SearchRowProps) => {
  const rowEl = useRef<HTMLLIElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const keydownEvent = (event: KeyboardEvent) => {
      if (event.key == 'Enter') navigate(link)
    }

    document.addEventListener('keydown', keydownEvent)

    return () => {
      document.removeEventListener('keydown', keydownEvent)
    }
  })

  if (selected) {
    rowEl.current?.scrollIntoView({
      block: 'nearest',
    })
  }

  return (
    <li
      id={`search-item-${id}`}
      ref={rowEl}
      role="option"
      aria-selected={selected}
      onMouseOver={() => setSelected()}
      className={classNames('rounded p-1 mt-1', {
        'bg-gray-100 dark:bg-dark-bg2': selected,
      })}
    >
      <NavLink to={link} className="flex items-center" tabIndex={-1}>
        {preview}
        <span className="flex-grow pl-2 text-sm">{label}</span>
      </NavLink>
    </li>
  )
}

type PhotoRowArgs = {
  query: string
  media: searchQuery_search_media
  selected: boolean
  setSelected(): void
}

const PhotoRow = ({ query, media, selected, setSelected }: PhotoRowArgs) => (
  <SearchRow
    key={media.id}
    id={media.id}
    link={`/album/${media.album.id}`}
    preview={
      <ProtectedImage
        src={media?.thumbnail?.url}
        className="w-14 h-14 object-cover"
      />
    }
    label={searchHighlighted(query, media.title)}
    selected={selected}
    setSelected={setSelected}
  />
)

type AlbumRowArgs = {
  query: string
  album: searchQuery_search_albums
  selected: boolean
  setSelected(): void
}

const AlbumRow = ({ query, album, selected, setSelected }: AlbumRowArgs) => (
  <SearchRow
    key={album.id}
    id={album.id}
    link={`/album/${album.id}`}
    preview={
      <ProtectedImage
        src={album?.thumbnail?.thumbnail?.url}
        className="w-14 h-14 rounded object-cover"
      />
    }
    label={searchHighlighted(query, album.title)}
    selected={selected}
    setSelected={setSelected}
  />
)

type FaceGroupRowArgs = {
  faceGroup: searchQuery_search_faceGroups
  selected: boolean
  setSelected(): void
}

const FaceGroupRow = ({ faceGroup, selected, setSelected }: FaceGroupRowArgs) => (
  <SearchRow
    key={faceGroup.id}
    id={`face-${faceGroup.id}`}
    link={`/people/${faceGroup.id}`}
    preview={
      <div className="w-14 h-14 rounded-full bg-gray-200 dark:bg-dark-bg2 flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          className="w-8 h-8 text-gray-500 dark:text-gray-400"
          fill="currentColor"
        >
          <path d="M15.713873,14.2127622 C17.4283917,14.8986066 18.9087267,16.0457918 20.0014344,17.5008819 C20,19.1568542 18.6568542,20.5 17,20.5 L7,20.5 C5.34314575,20.5 4,19.1568542 4,17.5 L4.09169034,17.3788798 C5.17486154,15.981491 6.62020934,14.878942 8.28693513,14.2120314 C9.30685583,15.018595 10.5972088,15.5 12,15.5 C13.3092718,15.5 14.5205974,15.0806428 15.5069849,14.3689203 L15.713873,14.2127622 L15.713873,14.2127622 Z M12,4 C15.0375661,4 17.5,6.46243388 17.5,9.5 C17.5,12.5375661 15.0375661,15 12,15 C8.96243388,15 6.5,12.5375661 6.5,9.5 C6.5,6.46243388 8.96243388,4 12,4 Z"></path>
        </svg>
      </div>
    }
    label={<span>{faceGroup.label ?? ''}</span>}
    selected={selected}
    setSelected={setSelected}
  />
)

const searchHighlighted = (query: string, text: string) => {
  const i = text.toLowerCase().indexOf(query.toLowerCase())

  if (i == -1) {
    return text
  }

  const start = text.substring(0, i)
  const middle = text.substring(i, i + query.length)
  const end = text.substring(i + query.length)

  return (
    <span>
      {start}
      <span className="font-semibold whitespace-pre">{middle}</span>
      {end}
    </span>
  )
}

export default SearchBar
