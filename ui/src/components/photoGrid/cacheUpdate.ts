import {
  ApolloCache,
  ApolloClient,
  NormalizedCacheObject,
  Reference,
  StoreObject,
} from '@apollo/client'

/**
 * Remove a referenced media from a cached list field.
 * `readField` is Apollo's reader bound to the surrounding field.
 */
function withoutMedia(
  existing: unknown,
  readField: (fieldName: string, ref: Reference | StoreObject) => unknown,
  id: string
): unknown {
  if (!Array.isArray(existing)) return existing
  return (existing as (Reference | StoreObject)[]).filter(
    ref => String(readField('id', ref)) !== id
  )
}

/**
 * Remove a deleted media from the Apollo cache without triggering a
 * cache-wide refetch.
 *
 * Why not `cache.evict` + `cache.gc`?
 * ----------------------------------
 * `gc()` prunes orphaned entities and marks every active query as
 * incomplete. Apollo then refetches the whole list, which (combined with
 * the thumbnail atlas query keyed on the full id list) blanks the entire
 * grid for a frame - the "full screen refresh" flash the user sees.
 *
 * Instead we surgically drop the media from every known list field with
 * `cache.modify` so the data transitions atomically, then evict just the
 * entity (without `gc`) so it cannot be resurrected by a stale reference.
 */
export function removeMediaFromCache(
  client: ApolloClient<NormalizedCacheObject> | ApolloClient<object>,
  mediaId: string
): void {
  const id = String(mediaId)
  // `useApolloClient()` is typed with a looser cache; the operations below
  // only rely on the standard cache API.
  const cache = client.cache as unknown as ApolloCache<NormalizedCacheObject>

  // 1. Root-level list queries (timeline, favorites, search, map marker
  //    lists, ...). Field modifiers are matched by field name, and a
  //    modifier for a field that is not in the cache is a no-op.
  cache.modify({
    fields: {
      myTimeline: (existing, { readField }) =>
        withoutMedia(existing, readField, id),
      myMedia: (existing, { readField }) =>
        withoutMedia(existing, readField, id),
      mediaList: (existing, { readField }) =>
        withoutMedia(existing, readField, id),
      filterMedia: (existing, { readField }) =>
        withoutMedia(existing, readField, id),
    },
  })

  // 2. Album media lists live under each cached Album entity, so they are
  //    not reachable from the root modifiers above.
  for (const key of Object.keys(cache.extract())) {
    if (!key.startsWith('Album:')) continue
    cache.modify({
      id: key,
      fields: {
        media: (existing, { readField }) =>
          withoutMedia(existing, readField, id),
      },
    })
  }

  // 3. Evict the entity itself. Deliberately NO `cache.gc()`: gc would
  //    cascade cache invalidation and refetch every active query.
  const mediaRef = cache.identify({ __typename: 'Media', id })
  if (mediaRef != null) {
    cache.evict({ id: mediaRef })
  }
}
