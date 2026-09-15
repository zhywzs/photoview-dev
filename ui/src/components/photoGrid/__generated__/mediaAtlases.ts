/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: mediaAtlases
// ====================================================

export interface mediaAtlases_mediaAtlases_entries {
  __typename: "MediaAtlasEntry";
  mediaId: string;
  /**
   * x position of the tile inside the atlas grid
   */
  x: number;
  /**
   * y position of the tile inside the atlas grid
   */
  y: number;
}

export interface mediaAtlases_mediaAtlases {
  __typename: "MediaAtlas";
  /**
   * URL of the sprite sheet image
   */
  url: string;
  /**
   * size of a single tile inside the atlas in px
   */
  tileSize: number;
  /**
   * number of tiles per atlas row/column
   */
  gridSize: number;
  entries: mediaAtlases_mediaAtlases_entries[];
}

export interface mediaAtlases {
  /**
   * Sprite sheets ("atlases") containing the given media, owned by the
   * logged in user. Dense gallery views (15/30 columns) request 128px
   * tiles, sparse views (3/5 columns) request 256px tiles - both load a
   * whole screen of photos in a few requests instead of one per photo.
   * Media that is not part of any atlas (videos, newly added photos) is
   * simply absent from the result and falls back to individual loading.
   */
  mediaAtlases: mediaAtlases_mediaAtlases[];
}

export interface mediaAtlasesVariables {
  ids: string[];
  tileSize?: number | null;
}
