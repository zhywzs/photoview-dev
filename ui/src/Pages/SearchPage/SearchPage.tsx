import React, { useEffect, useMemo, useReducer } from 'react'
import { Link } from 'react-router-dom'
import { gql, useQuery } from '@apollo/client'
import { useTranslation } from 'react-i18next'
import Layout from '../../components/layout/Layout'
import useURLParameters from '../../hooks/useURLParameters'
import useScrollPagination from '../../hooks/useScrollPagination'
import PaginateLoader from '../../components/PaginateLoader'
import MediaGallery, {
  MEDIA_GALLERY_FRAGMENT,
} from '../../components/photoGallery/MediaGallery'
import {
  mediaGalleryReducer,
  MediaGalleryState,
} from '../../components/photoGallery/mediaGalleryReducer'
import { FavoritesCheckbox } from '../../components/album/AlbumFilter'
import {
  filterMedia as filterMediaQuery,
  filterMediaVariables,
} from './__generated__/filterMedia'

const FILTER_MEDIA_QUERY = gql`
  ${MEDIA_GALLERY_FRAGMENT}
  query filterMedia(
    $query: String
    $dateFrom: Time
    $dateTo: Time
    $location: GeoBoundingBox
    $onlyFavorites: Boolean
    $limit: Int
    $offset: Int
  ) {
    filterMedia(
      query: $query
      dateFrom: $dateFrom
      dateTo: $dateTo
      location: $location
      onlyFavorites: $onlyFavorites
      paginate: { limit: $limit, offset: $offset }
    ) {
      ...MediaGalleryFields
      title
      date
    }
  }
`

const MEDIA_GEO_JSON_QUERY = gql`
  query searchPageMediaGeoJson {
    myMediaGeoJson
  }
`

type LocationOption = {
  /** "lat,lon" with both values rounded to 2 decimals (~1km grid) */
  value: string
  latitude: number
  longitude: number
  count: number
}

/** Group media coordinates into ~1km grid cells, to build a location picker */
const buildLocationOptions = (geoJson: unknown): LocationOption[] => {
  const data = geoJson as {
    features?: {
      geometry?: { coordinates?: [number, number] }
    }[]
  } | null
  if (!data || !data.features) return []

  const counts = new Map<string, LocationOption>()

  for (const feature of data.features) {
    const coords = feature.geometry?.coordinates
    if (!coords || coords.length < 2) continue

    const [lon, lat] = coords
    if (typeof lat !== 'number' || typeof lon !== 'number') continue

    const roundedLat = Math.round(lat * 100) / 100
    const roundedLon = Math.round(lon * 100) / 100
    const key = `${roundedLat},${roundedLon}`

    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, {
        value: key,
        latitude: roundedLat,
        longitude: roundedLon,
        count: 1,
      })
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count)
}

const SearchPage = () => {
  const { t } = useTranslation()
  const { getParam, setParam, setParams } = useURLParameters()

  const query = getParam('query') || ''
  const dateFrom = getParam('dateFrom')
  const dateTo = getParam('dateTo')
  const location = getParam('loc')
  const onlyFavorites = getParam('favorites') == '1' ? true : false

  const { data: geoJsonData } = useQuery<{ myMediaGeoJson: unknown }>(
    MEDIA_GEO_JSON_QUERY,
    {
      fetchPolicy: 'cache-first',
    }
  )

  const locationOptions = useMemo(
    () => buildLocationOptions(geoJsonData?.myMediaGeoJson),
    [geoJsonData]
  )

  const selectedLocation = locationOptions.find(x => x.value == location)

  const filterVariables: filterMediaVariables = {
    query: query || undefined,
    dateFrom: dateFrom ? `${dateFrom}T00:00:00Z` : undefined,
    dateTo: dateTo ? `${dateTo}T23:59:59Z` : undefined,
    location: selectedLocation
      ? {
          minLatitude: selectedLocation.latitude - 0.005,
          maxLatitude: selectedLocation.latitude + 0.005,
          minLongitude: selectedLocation.longitude - 0.005,
          maxLongitude: selectedLocation.longitude + 0.005,
        }
      : undefined,
    onlyFavorites: onlyFavorites || undefined,
    offset: 0,
    limit: 200,
  }

  const { loading, error, data, refetch, fetchMore } = useQuery<
    filterMediaQuery,
    filterMediaVariables
  >(FILTER_MEDIA_QUERY, {
    variables: filterVariables,
  })

  const { containerElem, finished: finishedLoadingMore } =
    useScrollPagination<filterMediaQuery>({
      loading,
      fetchMore,
      data,
      getItems: data => data.filterMedia,
    })

  const [mediaState, dispatchMedia] = useReducer(mediaGalleryReducer, {
    presenting: false,
    activeIndex: -1,
    media: [],
  } as MediaGalleryState)

  useEffect(() => {
    dispatchMedia({
      type: 'replaceMedia',
      media: (data?.filterMedia as never) || [],
    })
  }, [data])

  useEffect(() => {
    refetch(filterVariables)
  }, [query, dateFrom, dateTo, location, onlyFavorites])

  const inputClasses =
    'block border rounded-md px-2 h-[30px] bg-white border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50 outline-none dark:bg-dark-input-bg dark:border-dark-input-border dark:text-dark-input-text'

  if (error) return <Layout title={t('search_page.title', 'Search')}>{error.message}</Layout>

  const hasDateFilter = dateFrom != null || dateTo != null
  const anyFilterActive =
    query != '' ||
    hasDateFilter ||
    location != null ||
    onlyFavorites

  return (
    <Layout title={t('search_page.title', 'Search')}>
      <h1 className="text-2xl font-bold mb-4">
        {t('search_page.title', 'Search')}
      </h1>

      <div className="flex items-end gap-3 flex-nowrap overflow-x-auto pb-1 -mx-1 px-1 mb-4 scrollbar-none lg:flex-wrap lg:overflow-visible">
        <fieldset className="shrink-0 w-56 max-w-full">
          <legend className="sr-only">
            {t('search_page.query_label', 'Search text')}
          </legend>
          <input
            type="search"
            className={`${inputClasses} w-full`}
            placeholder={t(
              'search_page.query_placeholder',
              'File name, camera, lens, person…'
            )}
            defaultValue={query}
            onKeyUp={e => {
              if (e.key == 'Enter') {
                setParam('query', e.currentTarget.value.trim() || null)
              }
            }}
            onBlur={e => {
              if (e.target.value.trim() != query) {
                setParam('query', e.target.value.trim() || null)
              }
            }}
          />
        </fieldset>

        <fieldset className="shrink-0">
          <legend className="sr-only">
            {t('search_page.date_from', 'From date')}
          </legend>
          <input
            type="date"
            aria-label={t('search_page.date_from', 'From date')}
            className={inputClasses}
            value={dateFrom || ''}
            onChange={e => setParam('dateFrom', e.target.value || null)}
          />
        </fieldset>

        <fieldset className="shrink-0">
          <legend className="sr-only">
            {t('search_page.date_to', 'To date')}
          </legend>
          <input
            type="date"
            aria-label={t('search_page.date_to', 'To date')}
            className={inputClasses}
            value={dateTo || ''}
            onChange={e => setParam('dateTo', e.target.value || null)}
          />
        </fieldset>

        <fieldset className="shrink-0">
          <legend className="sr-only">
            {t('search_page.location', 'Location')}
          </legend>
          <select
            aria-label={t('search_page.location', 'Location')}
            className={inputClasses}
            value={location || ''}
            onChange={e => setParam('loc', e.target.value || null)}
          >
            <option value="">
              {t('search_page.all_locations', 'All locations')}
            </option>
            {locationOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.latitude}, {option.longitude} ({option.count})
              </option>
            ))}
          </select>
        </fieldset>

        <div className="shrink-0">
          <FavoritesCheckbox
            onlyFavorites={onlyFavorites}
            setOnlyFavorites={favorites =>
              setParam('favorites', favorites ? '1' : null)
            }
          />
        </div>

        {hasDateFilter && (
          <Link
            to={`/timeline?dateFrom=${dateFrom || ''}&dateTo=${dateTo || ''}`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline pb-1.5 shrink-0"
          >
            {t('search_page.view_in_timeline', 'View in timeline »')}
          </Link>
        )}

        {anyFilterActive && (
          <button
            className="text-sm text-gray-500 dark:text-gray-400 hover:underline pb-1.5 shrink-0"
            onClick={() =>
              setParams([
                { key: 'query', value: null },
                { key: 'dateFrom', value: null },
                { key: 'dateTo', value: null },
                { key: 'loc', value: null },
                { key: 'favorites', value: null },
              ])
            }
          >
            {t('search_page.clear_filters', 'Clear filters')}
          </button>
        )}
      </div>

      <div ref={containerElem}>
        <MediaGallery
          loading={loading}
          mediaState={mediaState}
          dispatchMedia={dispatchMedia}
        />
      </div>

      {!loading && !anyFilterActive && (
        <p className="text-gray-500 dark:text-gray-400 mt-4">
          {t(
            'search_page.enter_query_hint',
            'Enter a search term or select filters to search your library.'
          )}
        </p>
      )}

      <PaginateLoader
        active={!finishedLoadingMore && !loading}
        text={t('general.loading.paginate.media', 'Loading more media')}
      />
    </Layout>
  )
}

export default SearchPage
