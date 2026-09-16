import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useQuery, gql } from '@apollo/client'
import PhotoGrid from '../photoGrid/PhotoGrid'
import PresentView from '../photoGallery/presentView/PresentView'
import useURLParameters from '../../hooks/useURLParameters'
import useScrollPagination from '../../hooks/useScrollPagination'
import PaginateLoader from '../../components/PaginateLoader'
import { useTranslation } from 'react-i18next'
import { MediaGalleryFields } from '../photoGallery/__generated__/MediaGalleryFields'
import {
  myTimeline,
  myTimelineVariables,
  myTimeline_myTimeline,
} from './__generated__/myTimeline'
import {
  mediaGalleryReducer,
  openPresentModeAction,
  urlPresentModeSetupHook,
  MediaGalleryState,
} from '../photoGallery/mediaGalleryReducer'
import {
  toggleFavoriteAction,
  useMarkFavoriteMutation,
} from '../photoGallery/photoGalleryMutations'
import client from '../../apolloClient'
import { GridSectionData } from '../photoGrid/gridLayout'
import {
  DateGroup,
  granularityForColumns,
  groupTimeline,
  targetRowsForColumns,
} from '../photoGrid/timelineGrouping'
import { readStoredColumns } from '../photoGrid/gridZoom'

export const MY_TIMELINE_QUERY = gql`
  query myTimeline(
    $onlyFavorites: Boolean
    $limit: Int
    $offset: Int
    $fromDate: Time
    $toDate: Time
  ) {
    myTimeline(
      onlyFavorites: $onlyFavorites
      fromDate: $fromDate
      toDate: $toDate
      paginate: { limit: $limit, offset: $offset }
    ) {
      id
      title
      type
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
        width
        height
      }
      videoWeb {
        url
      }
      favorite
      album {
        id
        title
      }
      date
    }
  }
`

type TimelineGalleryProps = {
  /** Force the favorites filter on, regardless of URL parameters */
  forceFavorites?: boolean
}

/**
 * Format a group title. Compact mode is used for the floating date pill.
 */
function formatGroupTitle(
  group: Pick<DateGroup<unknown>, 'start' | 'end' | 'unit'>,
  compact: boolean,
  language: string
): string {
  const start = group.start
  const end = group.end
  const sameMonth = start.slice(0, 7) == end.slice(0, 7)
  const sameYear = start.slice(0, 4) == end.slice(0, 4)

  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)

  const monthStyle = compact ? 'short' : 'long'

  if (group.unit == 'month') {
    const monthWithYear = new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: monthStyle,
    })
    if (sameMonth) return monthWithYear.format(endDate)

    const monthOnly = new Intl.DateTimeFormat(language, { month: monthStyle })
    const startPart = sameYear
      ? monthOnly.format(endDate)
      : monthWithYear.format(endDate)
    return `${startPart} – ${monthWithYear.format(startDate)}`
  }

  if (start == end) {
    if (!compact) {
      return new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(startDate)
    }
    const nowYear = new Date().getFullYear()
    if (sameYear && +start.slice(0, 4) == nowYear) {
      return `${+start.slice(5, 7)}/${+start.slice(8, 10)}`
    }
    return start.replaceAll('-', '/')
  }

  if (!compact) {
    const endFormat = new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const startFormat = new Intl.DateTimeFormat(
      language,
      sameYear ? { month: 'long', day: 'numeric' } : {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }
    )
    return `${startFormat.format(startDate)} – ${endFormat.format(endDate)}`
  }

  // compact numeric range, e.g. "7/3 – 7/18" or "2025/7/3 – 2026/1/18"
  const compactDate = (date: string, withYear: boolean) =>
    withYear
      ? date.replaceAll('-', '/')
      : `${+date.slice(5, 7)}/${+date.slice(8, 10)}`
  return `${compactDate(start, !sameYear)} – ${compactDate(end, true)}`
}

const TimelineGallery = ({ forceFavorites = false }: TimelineGalleryProps) => {
  const { t, i18n } = useTranslation()

  const { getParam } = useURLParameters()

  const onlyFavorites =
    forceFavorites || getParam('favorites') == '1' ? true : false

  const filterDateFrom = getParam('dateFrom')
  const filterDateTo = getParam('dateTo')

  const fromDate = filterDateFrom != null ? `${filterDateFrom}T00:00:00Z` : undefined
  const toDate = filterDateTo ? `${filterDateTo}T23:59:59Z` : undefined

  const { data, error, loading, refetch, fetchMore } = useQuery<
    myTimeline,
    myTimelineVariables
  >(MY_TIMELINE_QUERY, {
    variables: {
      onlyFavorites,
      fromDate,
      toDate,
      offset: 0,
      limit: 200,
    },
  })

  const { containerElem, finished: finishedLoadingMore } =
    useScrollPagination<myTimeline>({
      loading,
      fetchMore,
      data,
      getItems: data => data.myTimeline,
    })

  const [mediaState, dispatchMedia] = useReducer(mediaGalleryReducer, {
    presenting: false,
    activeIndex: -1,
    media: [],
  } as MediaGalleryState)

  useEffect(() => {
    dispatchMedia({
      type: 'replaceMedia',
      media: data?.myTimeline || [],
    })
  }, [data])

  const didInitDateFilterRef = useRef(false)
  useEffect(() => {
    // skip the initial mount: the first query already ran, and resetStore
    // here would clear the cache and drag the view away from the newest
    if (!didInitDateFilterRef.current) {
      didInitDateFilterRef.current = true
      return
    }
    ;(async () => {
      await client.resetStore()
      await refetch({
        onlyFavorites,
        fromDate,
        toDate,
        offset: 0,
        limit: 200,
      })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate])

  urlPresentModeSetupHook({
    dispatchMedia,
    openPresentMode: () => {
      dispatchMedia({
        type: 'openPresentMode',
        activeIndex: mediaState.activeIndex,
      })
    },
  })

  const [markFavorite] = useMarkFavoriteMutation()
  const onItemActivate = useCallback(
    (media: MediaGalleryFields, index: number) => {
      openPresentModeAction({ dispatchMedia, activeIndex: index })
    },
    []
  )

  const onItemFavorite = useCallback(
    (media: MediaGalleryFields) => {
      toggleFavoriteAction({ media, markFavorite })
    },
    [markFavorite]
  )

  // The grid owns the continuous zoom and reports the settled column count
  // so the date grouping granularity can follow it.
  const [columns, setColumns] = useState(() => readStoredColumns())

  const sections = useMemo(() => {
    const timeline = data?.myTimeline || []
    const granularity = granularityForColumns(columns)
    const targetRows = targetRowsForColumns(columns)
    const groups = groupTimeline(timeline, granularity, columns, targetRows)
    const compact = columns > 5
    return groups.map(group => ({
      key: group.key,
      title: formatGroupTitle(group, compact, i18n.language),
      items: group.items,
    })) as GridSectionData<myTimeline_myTimeline>[]
  }, [data, columns, i18n.language])

  if (error) {
    return <div>{error.message}</div>
  }

  const activeMedia =
    mediaState.activeIndex >= 0
      ? mediaState.media[mediaState.activeIndex]
      : undefined

  return (
    <div className="-mx-3 lg:mx-0 overflow-x-hidden">
      <PhotoGrid
        sections={sections}
        onItemActivate={onItemActivate}
        onItemFavorite={onItemFavorite}
        activeId={activeMedia?.id}
        onColumnsChange={setColumns}
      />
      <div ref={containerElem}>
        <PaginateLoader
          active={!finishedLoadingMore && !loading}
          text={t('general.loading.paginate.media', 'Loading more media')}
        />
      </div>
      {mediaState.presenting && activeMedia != null && (
        <PresentView
          activeMedia={activeMedia}
          dispatchMedia={dispatchMedia}
          favorite={activeMedia.favorite}
          onToggleFavorite={() => {
            toggleFavoriteAction({ media: activeMedia, markFavorite })
          }}
          mediaList={mediaState.media}
          activeIndex={mediaState.activeIndex}
          onSelectIndex={index => dispatchMedia({ type: 'selectImage', index })}
        />
      )}
    </div>
  )
}

export default TimelineGallery
