import { gql } from '@apollo/client'
import { mediaAtlases, mediaAtlasesVariables } from './__generated__/mediaAtlases'

export const MEDIA_ATLASES_QUERY = gql`
  query mediaAtlases($ids: [ID!]!, $tileSize: Int) {
    mediaAtlases(ids: $ids, tileSize: $tileSize) {
      url
      tileSize
      gridSize
      entries {
        mediaId
        x
        y
      }
    }
  }
`

export type { mediaAtlases, mediaAtlasesVariables }

/** Tile placement of a single media inside an atlas sprite sheet. */
export type AtlasTile = {
  url: string
  x: number
  y: number
  /** px size of one tile inside the atlas (e.g. 128) */
  tileSize: number
  /** tiles per atlas row/column (e.g. 8) */
  gridSize: number
}

export type AtlasTileMap = Map<string, AtlasTile>

/** Build a mediaId -> tile lookup from the query result. */
export function buildAtlasMap(
  data: mediaAtlases | undefined
): AtlasTileMap {
  const map: AtlasTileMap = new Map()
  for (const atlas of data?.mediaAtlases ?? []) {
    for (const entry of atlas.entries) {
      map.set(entry.mediaId, {
        url: atlas.url,
        x: entry.x,
        y: entry.y,
        tileSize: atlas.tileSize,
        gridSize: atlas.gridSize,
      })
    }
  }
  return map
}
